import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { config } from "./config";

export type AgentName = "claude" | "openclaw" | "hermes" | "labyrinth" | "antigravity" | "fcc" | "codex";

function binFor(agent: AgentName): string {
  const key = agent === "fcc" ? "claude" : agent;
  const bin = (config as any)[key];
  if (!bin) throw new Error(`${agent} is not installed or not configured.`);
  return bin;
}

function agentEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const base = process.env;
  const home = base.HOME ?? `/Users/${base.USER ?? "dewaynexander"}`;
  const ensurePath = [
    "/usr/local/bin", "/opt/homebrew/bin", "/opt/homebrew/sbin",
    "/usr/bin", "/bin", "/usr/sbin", "/sbin",
    `${home}/.local/bin`, `${home}/local/node/bin`,
  ];
  const existing = (base.PATH ?? "").split(":").filter(Boolean);
  const merged = [...new Set([...existing, ...ensurePath])].join(":");
  return { ...base, PATH: merged, SHELL: base.SHELL || "/bin/zsh", HOME: base.HOME || home, NO_COLOR: "1", FORCE_COLOR: "0", ...extra };
}

const FLAG_PATTERN = /^[A-Za-z0-9_\-./:=,@+%]+$/;
const MAX_ARG_LEN = 32_000;

export function validateFlagArgs(args: readonly string[]): string[] {
  return args.filter((a) => typeof a === "string" && a.length < MAX_ARG_LEN && FLAG_PATTERN.test(a));
}

function safeArg(a: unknown): string | null {
  if (typeof a !== "string") return null;
  if (a.length === 0 || a.length > MAX_ARG_LEN) return null;
  if (a.includes("\0")) return null;
  return a;
}

export interface RunResult { ok: boolean; code: number | null; stdout: string; stderr: string; durationMs: number; }

const NO_TIMEOUT = 0;

// ─── APPROVAL GATE ──────────────────────────────────────────────────
// When requireApproval is true, the runner emits a JSON approval request
// to stdout and waits for the frontend to resolve it before proceeding.
// This is used by the execute_code tool to gate dangerous operations.

export interface ApprovalRequest {
  type: "require_approval";
  run_id: string;
  reason: string;
  agent: string;
  args: string[];
  cwd: string;
}

export interface RunOptions {
  timeoutMs?: number;
  cwd?: string;
  input?: string;
  /** If true, emit an approval gate before executing */
  requireApproval?: boolean;
  /** Callback to emit approval request (for streaming to frontend) */
  onApproval?: (req: ApprovalRequest) => Promise<boolean>;
}

export async function run(agent: AgentName, args: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
  const cleanArgs = args.map(safeArg).filter((a): a is string => a !== null);
  const started = Date.now();
  let bin: string;
  try { bin = binFor(agent); }
  catch (e) { return { ok: false, code: -1, stdout: "", stderr: String(e), durationMs: 0 }; }

  // Approval gate
  if (opts.requireApproval && opts.onApproval) {
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const req: ApprovalRequest = {
      type: "require_approval",
      run_id: runId,
      reason: `${agent} execution: ${cleanArgs.slice(0, 3).join(" ")}${cleanArgs.length > 3 ? "..." : ""}`,
      agent,
      args: cleanArgs,
      cwd: opts.cwd ?? process.env.HOME ?? "/",
    };
    const approved = await opts.onApproval(req);
    if (!approved) {
      return { ok: false, code: -1, stdout: "", stderr: `[denied] User rejected execution of ${agent}`, durationMs: Date.now() - started };
    }
  }

  return new Promise<RunResult>((resolve) => {
    const child = spawn(bin, cleanArgs, { cwd: opts.cwd ?? process.env.HOME, env: agentEnv() });
    let stdout = ""; let stderr = "";
    const ms = opts.timeoutMs ?? NO_TIMEOUT;
    const timeout = ms > 0 ? setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, ms) : null;
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("close", (code) => { if (timeout) clearTimeout(timeout); resolve({ ok: code === 0, code, stdout, stderr, durationMs: Date.now() - started }); });
    child.on("error", (e) => { if (timeout) clearTimeout(timeout); resolve({ ok: false, code: -1, stdout, stderr: String(e), durationMs: Date.now() - started }); });
    if (opts.input) child.stdin.write(opts.input);
    try { child.stdin.end(); } catch {}
  });
}

export function spawnStream(agent: AgentName, args: readonly string[], opts: { cwd?: string; input?: string; extraEnv?: Record<string, string> } = {}): ChildProcessWithoutNullStreams {
  const bin = binFor(agent);
  const cleanArgs = args.map(safeArg).filter((a): a is string => a !== null);
  const child = spawn(bin, cleanArgs, { cwd: opts.cwd ?? process.env.HOME, env: agentEnv(opts.extraEnv ?? {}), stdio: ["pipe", "pipe", "pipe"] }) as ChildProcessWithoutNullStreams;
  if (typeof opts.input === "string" && opts.input.length > 0) { child.stdin.write(opts.input); }
  try { child.stdin.end(); } catch {}
  return child;
}
