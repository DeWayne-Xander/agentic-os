import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── In-memory process references (server-side only) ───────────────
// For foreground processes we spawn from the API
const childProcesses = new Map<string, { pid: number; startedAt: number }>();

import { execSync, exec, execFile, type ChildProcess } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const PID_DIR = path.join(os.homedir(), ".openclaw", "workspace", "pids");

function ensurePidDir() {
  if (!existsSync(PID_DIR)) execSync(`mkdir -p "${PID_DIR}"`);
}

function checkPort(port: number): { listening: boolean; pid: number | null } {
  try {
    const out = execSync(`lsof -i :${port} -sTCP:LISTEN -t 2>/dev/null`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const pid = parseInt(out.trim().split("\n")[0], 10);
    return { listening: true, pid: pid || null };
  } catch { return { listening: false, pid: null }; }
}

function checkLaunchd(label: string): { loaded: boolean; pid: number | null } {
  try {
    const out = execSync(`launchctl list "${label}" 2>/dev/null`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const parts = out.trim().split("\n").pop()?.split("\t") ?? [];
    const pid = parts[0]?.trim();
    return { loaded: pid !== "-" && pid !== undefined, pid: pid && pid !== "-" ? parseInt(pid, 10) : null };
  } catch { return { loaded: false, pid: null }; }
}

const DAEMON_MAP: Record<string, {
  type: "launchd" | "foreground";
  label?: string;
  plist?: string;
  launchCmd?: string;
  workdir?: string;
  port?: number;
}> = {
  "nextjs-primary": {
    type: "foreground",
    launchCmd: "npm run dev -- --port 3001",
    workdir: path.join(os.homedir(), "Projects", "agentic-os-source", "agent-os-pack", "source"),
    port: 3001,
  },
  "hermes-gateway": {
    type: "launchd",
    label: "ai.hermes.gateway",
    plist: path.join(os.homedir(), "Library", "LaunchAgents", "ai.hermes.gateway.plist"),
  },
  "hermes-chrono": {
    type: "launchd",
    label: "ai.hermes.gateway-chrono",
    plist: path.join(os.homedir(), "Library", "LaunchAgents", "ai.hermes.gateway-chrono.plist"),
  },
  "openclaw-gateway": {
    type: "launchd",
    label: "ai.openclaw.gateway",
    plist: path.join(os.homedir(), "Library", "LaunchAgents", "ai.openclaw.gateway.plist"),
  },
  "openclaw-cost-watcher": {
    type: "launchd",
    label: "com.openclaw.cost-watcher",
    plist: path.join(os.homedir(), "Library", "LaunchAgents", "com.openclaw.cost-watcher.plist"),
  },
};

// GET — status of all daemons or a specific one
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  const ids = id ? [id] : Object.keys(DAEMON_MAP);
  const results = ids.map((daemonId) => {
    const spec = DAEMON_MAP[daemonId];
    if (!spec) return { id: daemonId, error: "unknown daemon" };

    if (spec.type === "launchd" && spec.label) {
      const { loaded, pid } = checkLaunchd(spec.label);
      return { id: daemonId, type: "launchd", label: spec.label, state: loaded ? "running" : "stopped", pid };
    }

    if (spec.type === "foreground" && spec.port) {
      const { listening, pid } = checkPort(spec.port);
      const childInfo = childProcesses.get(daemonId);
      return {
        id: daemonId,
        type: "foreground",
        state: listening ? "running" : "stopped",
        pid: pid ?? childInfo?.pid ?? null,
        port: spec.port,
        startedAt: childInfo?.startedAt ?? null,
      };
    }

    return { id: daemonId, state: "unknown" };
  });

  return NextResponse.json(id ? results[0] : { daemons: results });
}

// POST — start/stop/restart a daemon
export async function POST(req: Request) {
  const body = await req.json();
  const { action, id } = body as { action: "start" | "stop" | "restart"; id: string };

  if (!action || !id) return NextResponse.json({ error: "missing action or id" }, { status: 400 });

  const spec = DAEMON_MAP[id];
  if (!spec) return NextResponse.json({ error: `unknown daemon: ${id}` }, { status: 404 });

  try {
    if (spec.type === "launchd" && spec.label && spec.plist) {
      if (action === "start") {
        execSync(`launchctl bootstrap gui/$(id -u) "${spec.plist}" 2>&1`, { encoding: "utf8" });
        return NextResponse.json({ ok: true, id, action, type: "launchd" });
      }
      if (action === "stop") {
        execSync(`launchctl bootout gui/$(id -u)/ai.hermes.gateway 2>/dev/null || launchctl bootout gui/$(id -u) "${spec.plist}" 2>/dev/null || true`, { encoding: "utf8" });
        return NextResponse.json({ ok: true, id, action, type: "launchd" });
      }
      if (action === "restart") {
        try { execSync(`launchctl bootout gui/$(id -u) "${spec.plist}" 2>/dev/null || true`, { encoding: "utf8" }); } catch { /* ignore */ }
        execSync(`launchctl bootstrap gui/$(id -u) "${spec.plist}" 2>&1`, { encoding: "utf8" });
        return NextResponse.json({ ok: true, id, action, type: "launchd" });
      }
    }

    if (spec.type === "foreground" && spec.launchCmd && spec.workdir) {
      if (action === "start") {
        const parts = spec.launchCmd.split(" ");
        const child = execFile(parts[0], parts.slice(1), {
          cwd: spec.workdir,
          env: { ...process.env },
        });
        child.unref();
        ensurePidDir();
        if (child.pid) {
          writeFileSync(path.join(PID_DIR, `${id}.pid`), String(child.pid));
          childProcesses.set(id, { pid: child.pid, startedAt: Date.now() });
        }
        return NextResponse.json({ ok: true, id, action, pid: child.pid, type: "foreground" });
      }
      if (action === "stop") {
        const info = childProcesses.get(id);
        if (info?.pid) {
          try { process.kill(info.pid, "SIGTERM"); } catch { /* already dead */ }
          childProcesses.delete(id);
        }
        if (spec.port) {
          try { execSync(`kill $(lsof -i :${spec.port} -sTCP:LISTEN -t) 2>/dev/null || true`); } catch { /* ignore */ }
        }
        return NextResponse.json({ ok: true, id, action, type: "foreground" });
      }
      if (action === "restart") {
        // Stop then start
        const info = childProcesses.get(id);
        if (info?.pid) {
          try { process.kill(info.pid, "SIGTERM"); } catch { /* ignore */ }
          childProcesses.delete(id);
        }
        await new Promise((r) => setTimeout(r, 2000));
        const parts = spec.launchCmd!.split(" ");
        const child = execFile(parts[0], parts.slice(1), {
          cwd: spec.workdir,
          env: { ...process.env },
        });
        child.unref();
        ensurePidDir();
        if (child.pid) {
          writeFileSync(path.join(PID_DIR, `${id}.pid`), String(child.pid));
          childProcesses.set(id, { pid: child.pid, startedAt: Date.now() });
        }
        return NextResponse.json({ ok: true, id, action, pid: child.pid, type: "foreground" });
      }
    }

    return NextResponse.json({ error: "unhandled spec" }, { status: 500 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}