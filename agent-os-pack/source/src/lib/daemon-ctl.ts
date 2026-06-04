/**
 * Daemon Control — Core OS Integration (Phase 5)
 *
 * Native daemon lifecycle manager. Replaces custom script patches with
 * programmatic control over launchd services, Next.js, and background processes.
 *
 * Ties directly to OpenClaw workspace file structures so ambient chat data
 * updates core markdown vaults in real-time.
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { OPENCLAW_HOME } from "@/lib/agentHomes";

// ─── Types ─────────────────────────────────────────────────────────

export interface DaemonSpec {
  id: string;
  label: string;
  type: "launchd" | "foreground" | "background";
  /** launchd service label (e.g. ai.hermes.gateway) */
  serviceLabel?: string;
  plistPath?: string;
  launchCommand?: string;
  workdir?: string;
  env?: Record<string, string>;
  port?: number;
  pidFile?: string;
}

export interface DaemonStatus {
  id: string;
  label: string;
  state: "running" | "stopped" | "error" | "not-loaded";
  pid: number | null;
  uptime: number | null;
  port: number | null;
  lastError?: string;
}

export interface VaultSyncEntry {
  source: string;
  target: string;
  lastSync: number;
  status: "synced" | "pending" | "error";
}

// ─── Known daemons ─────────────────────────────────────────────────

const AGENT_DIR = path.join(os.homedir(), "Projects", "agentic-os-source", "agent-os-pack", "source");
const VAULT_DIR = path.join(os.homedir(), ".config", "hermes", "vault");
const WORKSPACE_DIR = path.join(OPENCLAW_HOME, "workspace");
const PID_DIR = path.join(WORKSPACE_DIR, "pids");

const KNOWN_DAEMONS: DaemonSpec[] = [
  {
    id: "nextjs-primary",
    label: "Next.js (Agent OS UI)",
    type: "foreground",
    launchCommand: "npm run dev -- --port 3001",
    workdir: AGENT_DIR,
    port: 3001,
    pidFile: path.join(PID_DIR, "nextjs.pid"),
    env: {},
  },
  {
    id: "hermes-gateway",
    label: "Hermes Gateway",
    type: "launchd",
    serviceLabel: "ai.hermes.gateway",
    plistPath: path.join(os.homedir(), "Library", "LaunchAgents", "ai.hermes.gateway.plist"),
  },
  {
    id: "hermes-chrono",
    label: "Chrono Engine",
    type: "launchd",
    serviceLabel: "ai.hermes.gateway-chrono",
    plistPath: path.join(os.homedir(), "Library", "LaunchAgents", "ai.hermes.gateway-chrono.plist"),
  },
  {
    id: "openclaw-gateway",
    label: "OpenClaw Gateway",
    type: "launchd",
    serviceLabel: "ai.openclaw.gateway",
    plistPath: path.join(os.homedir(), "Library", "LaunchAgents", "ai.openclaw.gateway.plist"),
  },
  {
    id: "openclaw-cost-watcher",
    label: "OpenClaw Cost Watcher",
    type: "launchd",
    serviceLabel: "com.openclaw.cost-watcher",
  },
];

// ─── Daemon status checks ──────────────────────────────────────────

export function getDaemonStatus(id: string): DaemonStatus {
  const spec = KNOWN_DAEMONS.find((d) => d.id === id);
  if (!spec) return { id, label: id, state: "error", pid: null, uptime: null, port: null, lastError: "unknown daemon" };

  if (spec.type === "launchd") {
    return getLaunchdStatus(spec);
  }
  return getProcessStatus(spec);
}

function getLaunchdStatus(spec: DaemonSpec): DaemonStatus {
  try {
    const label = spec.serviceLabel ?? spec.label;
    const out = execSync(`launchctl list ${label}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const lines = out.trim().split("\n");
    const lastLine = lines[lines.length - 1];
    const parts = lastLine.split("\t");

    // launchctl list format: PID\tExitStatus\tLabel
    const pidStr = parts[0]?.trim();
    const pid = pidStr && pidStr !== "-" ? parseInt(pidStr, 10) : null;
    const exitCode = parts[1]?.trim();

    return {
      id: spec.id,
      label: spec.label,
      state: pid ? "running" : (exitCode === "0" ? "stopped" : "not-loaded"),
      pid,
      uptime: null,
      port: spec.port ?? null,
    };
  } catch {
    return { id: spec.id, label: spec.label, state: "not-loaded", pid: null, uptime: null, port: spec.port ?? null };
  }
}

function getProcessStatus(spec: DaemonSpec): DaemonStatus {
  // Check port first
  if (spec.port) {
    try {
      const out = execSync(`lsof -i :${spec.port} -sTCP:LISTEN -t 2>/dev/null`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      const pid = parseInt(out.trim().split("\n")[0], 10);
      if (pid) {
        // Get uptime
        let uptime: number | null = null;
        try {
          const etime = execSync(`ps -o etime= -p ${pid} 2>/dev/null`, { encoding: "utf8" }).trim();
          uptime = parseEtime(etime);
        } catch { /* ignore */ }
        return { id: spec.id, label: spec.label, state: "running", pid, uptime, port: spec.port };
      }
    } catch { /* port not listening */ }
  }

  // Check PID file
  if (spec.pidFile && existsSync(spec.pidFile)) {
    try {
      const pid = parseInt(readFileSync(spec.pidFile, "utf8").trim(), 10);
      if (pid && kill(pid, 0)) {
        let uptime: number | null = null;
        try {
          const etime = execSync(`ps -o etime= -p ${pid} 2>/dev/null`, { encoding: "utf8" }).trim();
          uptime = parseEtime(etime);
        } catch { /* ignore */ }
        return { id: spec.id, label: spec.label, state: "running", pid, uptime, port: spec.port ?? null };
      }
    } catch { /* stale pid file */ }
  }

  return { id: spec.id, label: spec.label, state: "stopped", pid: null, uptime: null, port: spec.port ?? null };
}

// Lightweight kill check (signal 0)
function kill(pid: number, sig: number): boolean {
  try {
    return process.kill(pid, 0);
  } catch {
    return false;
  }
}

function parseEtime(etime: string): number {
  // Format: [[DD-]HH:]MM:SS
  const parts = etime.split(":").map(Number);
  if (parts.length === 3) {
    const [dd_hh, mm, ss] = parts;
    if (dd_hh > 23) {
      const days = Math.floor(dd_hh / 24);
      const hours = dd_hh % 24;
      return days * 86400 + hours * 3600 + mm * 60 + ss;
    }
    return dd_hh * 3600 + mm * 60 + ss;
  }
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

// ─── Daemon lifecycle operations ───────────────────────────────────

export function startDaemon(id: string): { ok: boolean; pid?: number; error?: string } {
  const spec = KNOWN_DAEMONS.find((d) => d.id === id);
  if (!spec) return { ok: false, error: `unknown daemon: ${id}` };

  const current = getDaemonStatus(id);
  if (current.state === "running") return { ok: true, pid: current.pid! };

  try {
    if (spec.type === "launchd") {
      execSync(`launchctl bootstrap gui/$(id -u) ${spec.plistPath}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { ok: true };
    }

    if (spec.launchCommand) {
      const [cmd, ...args] = spec.launchCommand.split(" ");
      const child = spawn(cmd, args, {
        cwd: spec.workdir || process.cwd(),
        detached: true,
        stdio: "ignore",
        env: { ...process.env, ...spec.env },
      });
      child.unref();

      if (spec.pidFile) {
        writeFileSync(spec.pidFile, String(child.pid));
      }
      return { ok: true, pid: child.pid };
    }

    return { ok: false, error: "no launch method" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function stopDaemon(id: string): { ok: boolean; error?: string } {
  const spec = KNOWN_DAEMONS.find((d) => d.id === id);
  if (!spec) return { ok: false, error: `unknown daemon: ${id}` };

  try {
    if (spec.type === "launchd") {
      execSync(`launchctl bootout gui/$(id -u) ${spec.plistPath}`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { ok: true };
    }

    const status = getDaemonStatus(id);
    if (status.pid) {
      process.kill(status.pid, "SIGTERM");
      return { ok: true };
    }

    return { ok: false, error: "not running" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function restartDaemon(id: string): { ok: boolean; pid?: number; error?: string } {
  stopDaemon(id);
  // Wait for graceful shutdown
  return new Promise<{ ok: boolean; pid?: number; error?: string }>((resolve) => {
    setTimeout(() => {
      const result = startDaemon(id);
      resolve(result);
    }, 2000);
  }) as any;
}

// ─── Bulk operations ───────────────────────────────────────────────

export function getAllDaemonStatuses(): DaemonStatus[] {
  return KNOWN_DAEMONS.map((d) => getDaemonStatus(d.id));
}

export function getRunningDaemons(): DaemonStatus[] {
  return getAllDaemonStatuses().filter((d) => d.state === "running");
}

export function getStoppedDaemons(): DaemonStatus[] {
  return getAllDaemonStatuses().filter((d) => d.state !== "running");
}

// ─── Vault sync integration ────────────────────────────────────────

export function syncToVault(source: string, target: string): VaultSyncEntry {
  const entry: VaultSyncEntry = {
    source,
    target,
    lastSync: Date.now(),
    status: "pending",
  };

  try {
    if (!existsSync(source)) {
      entry.status = "error";
      return entry;
    }
    const content = readFileSync(source, "utf8");
    const dir = path.dirname(target);
    if (!existsSync(dir)) execSync(`mkdir -p "${dir}"`);
    writeFileSync(target, content);
    entry.status = "synced";
  } catch {
    entry.status = "error";
  }

  return entry;
}

export function syncAllMemoryToVault(): VaultSyncEntry[] {
  const results: VaultSyncEntry[] = [];
  const memoryDir = path.join(WORKSPACE_DIR, "memory");
  const vaultMemories = path.join(VAULT_DIR, "Agentic OS", "Memories");

  if (!existsSync(memoryDir)) return results;

  const files = execSync(`ls ${memoryDir}/*.md 2>/dev/null`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  for (const file of files) {
    const basename = path.basename(file);
    const target = path.join(vaultMemories, basename);
    results.push(syncToVault(file, target));
  }

  return results;
}

// ─── Compiler gate for scratch work ───────────────────────────────

export interface CompilerGateResult {
  ok: boolean;
  cwd: string;
  command: string;
  output: string;
}

export function runCompilerGate(cwd: string): CompilerGateResult {
  const gate: CompilerGateResult = {
    ok: false,
    cwd,
    command: "",
    output: "",
  };

  try {
    const pkgJson = path.join(cwd, "package.json");
    const tsconfig = path.join(cwd, "tsconfig.json");
    if (existsSync(tsconfig)) {
      gate.command = "npx tsc --noEmit --skipLibCheck";
      gate.output = execSync(gate.command, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      gate.ok = true;
      return gate;
    }
    if (existsSync(pkgJson)) {
      gate.command = "npm run build";
      gate.output = execSync(gate.command, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      gate.ok = true;
      return gate;
    }
    gate.command = "npx tsc --noEmit --skipLibCheck";
    gate.output = execSync(gate.command, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    gate.ok = true;
    return gate;
  } catch (err) {
    gate.output = err instanceof Error ? err.message : String(err);
    return gate;
  }
}
