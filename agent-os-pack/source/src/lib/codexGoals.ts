// Codex Goal Mode — persistent goal tracking.
//
// Each goal has:
//   - id, title, prompt (the instructions Codex follows)
//   - status: queued | running | completed | failed | stopped
//   - createdAt / startedAt / finishedAt
//   - pid (when running, so we can stop it)
//   - cwd — where Codex runs (defaults to CODEX_SCRATCH_ROOT/<id>)
//   - lastOutput (last line of stdout/stderr, for live preview)
//   - logFile (path to streaming log for full transcript)
//
// Persisted to ~/.agentic-os/codex-goals.json.

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { CODEX_SCRATCH_ROOT } from "@/lib/codexWorkspace";
import { config } from "@/lib/config";

const HOME = os.homedir();
const STATE_DIR = path.join(HOME, ".agentic-os");
const STATE_FILE = path.join(STATE_DIR, "codex-goals.json");
export const GOAL_LOGS_DIR = path.join(STATE_DIR, "codex-goal-logs");

export type GoalStatus = "queued" | "running" | "completed" | "failed" | "stopped";

export interface CodexGoal {
  id: string;
  title: string;
  prompt: string;
  status: GoalStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  pid?: number;
  cwd: string;
  lastOutput?: string;
  logFile: string;
  exitCode?: number | null;
}

interface State { goals: CodexGoal[]; }

async function readState(): Promise<State> {
  if (!existsSync(STATE_FILE)) return { goals: [] };
  try {
    const txt = await readFile(STATE_FILE, "utf8");
    const j = JSON.parse(txt);
    return { goals: Array.isArray(j.goals) ? j.goals : [] };
  } catch { return { goals: [] }; }
}

let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeLock.then(() => fn(), () => fn());
  writeLock = next.then(() => undefined, () => undefined);
  return next;
}

async function writeState(s: State): Promise<void> {
  if (!existsSync(STATE_DIR)) await mkdir(STATE_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, JSON.stringify(s, null, 2));
  await rename(tmp, STATE_FILE);
}

async function mutate<T>(fn: (s: State) => Promise<T> | T): Promise<T> {
  return withLock(async () => {
    const s = await readState();
    const result = await fn(s);
    await writeState(s);
    return result;
  });
}

export async function listGoals(): Promise<CodexGoal[]> {
  return mutate(async (s) => {
    for (const g of s.goals) {
      if (g.status === "running" && g.pid) {
        try { process.kill(g.pid, 0); }
        catch {
          g.status = "stopped";
          g.finishedAt = g.finishedAt ?? Date.now();
          g.pid = undefined;
        }
      }
    }
    return s.goals.sort((a, b) => b.createdAt - a.createdAt);
  });
}

export async function createGoal(title: string, prompt: string, cwd?: string): Promise<CodexGoal> {
  if (!existsSync(GOAL_LOGS_DIR)) await mkdir(GOAL_LOGS_DIR, { recursive: true });
  return mutate(async (s) => {
    const id = `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const defaultCwd = path.join(CODEX_SCRATCH_ROOT, id);
    const resolvedCwd = cwd ? path.resolve(cwd) : defaultCwd;
    const safeCwd = (resolvedCwd === CODEX_SCRATCH_ROOT || resolvedCwd.startsWith(CODEX_SCRATCH_ROOT + path.sep))
      ? resolvedCwd
      : defaultCwd;
    const goal: CodexGoal = {
      id,
      title: title.trim().slice(0, 120) || "Untitled goal",
      prompt: prompt.trim(),
      status: "queued",
      createdAt: Date.now(),
      cwd: safeCwd,
      logFile: path.join(GOAL_LOGS_DIR, `${id}.log`),
    };
    if (!existsSync(goal.cwd)) await mkdir(goal.cwd, { recursive: true });
    s.goals.push(goal);
    return goal;
  });
}

export async function updateGoal(id: string, patch: Partial<CodexGoal>): Promise<CodexGoal | null> {
  return mutate(async (s) => {
    const idx = s.goals.findIndex((g) => g.id === id);
    if (idx < 0) return null;
    s.goals[idx] = { ...s.goals[idx], ...patch };
    return s.goals[idx];
  });
}

export async function deleteGoal(id: string): Promise<boolean> {
  return mutate(async (s) => {
    const before = s.goals.length;
    s.goals = s.goals.filter((g) => g.id !== id);
    return s.goals.length !== before;
  });
}

export async function stopGoal(id: string): Promise<CodexGoal | null> {
  return mutate(async (s) => {
    const goal = s.goals.find((g) => g.id === id);
    if (!goal) return null;
    if (goal.status === "running" && goal.pid) {
      try { process.kill(goal.pid, "SIGTERM"); }
      catch { /* already dead */ }
    }
    goal.status = "stopped";
    goal.finishedAt = Date.now();
    goal.pid = undefined;
    return goal;
  });
}

export async function getGoal(id: string): Promise<CodexGoal | null> {
  const s = await readState();
  return s.goals.find((g) => g.id === id) ?? null;
}

export async function readGoalLog(id: string, maxBytes = 200_000): Promise<string> {
  const goal = await getGoal(id);
  if (!goal) return "";
  if (!existsSync(goal.logFile)) return "";
  try {
    const buf = await readFile(goal.logFile);
    if (buf.length <= maxBytes) return buf.toString("utf8");
    return "…[truncated]…\n" + buf.subarray(buf.length - maxBytes).toString("utf8");
  } catch { return ""; }
}

function goalPlan(goal: CodexGoal): string {
  return [
    `# Goal ${goal.id}`,
    ``,
    `Title: ${goal.title}`,
    `Created: ${new Date(goal.createdAt).toISOString()}`,
    `Working directory: ${goal.cwd}`,
    ``,
    `## Mission`,
    goal.prompt,
    ``,
    `## Autonomy rules`,
    `- Decompose the work into subtasks automatically.`,
    `- Coordinate with Chrono, Labyrinth, Kairos, and Codex as needed.`,
    `- Keep a running checklist in this directory.`,
    `- Stay inside the sandbox and goal cwd.`,
  ].join("\n");
}

function launchArgs(prompt: string): string[] {
  return [
    "--dangerously-bypass-approvals-and-sandbox",
    "exec",
    "--model",
    "gpt-5.4-mini",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    prompt,
  ];
}

export async function launchGoal(id: string): Promise<CodexGoal | null> {
  if (!config.codex) return null;
  const goal = await getGoal(id);
  if (!goal) return null;
  if (!existsSync(GOAL_LOGS_DIR)) await mkdir(GOAL_LOGS_DIR, { recursive: true });
  if (!existsSync(goal.cwd)) await mkdir(goal.cwd, { recursive: true });
  await writeFile(path.join(goal.cwd, "GOAL.md"), goalPlan(goal), "utf8");
  const log = createWriteStream(goal.logFile, { flags: "a" });
  log.write(`\n=== START ${new Date().toISOString()} · ${goal.id} ===\n${goal.prompt}\n\n`);
  const child = spawn(config.codex, launchArgs([
    `You are Asta running Codex Goal Mode for Agentic OS.`,
    `Goal title: ${goal.title}`,
    `Primary mission: ${goal.prompt}`,
    `Work autonomously until complete.`,
    `Decompose into subtasks automatically.`,
    `Coordinate with Chrono, Labyrinth, Kairos, and Codex as needed.`,
    `Keep progress in the goal workspace and report concise state updates.`,
    `Never stop early unless the task is complete or you hit a real blocker.`,
  ].join("\n\n")), {
    cwd: goal.cwd,
    env: {
      ...process.env,
      PATH: process.env.PATH ?? "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin",
      HOME: process.env.HOME ?? "",
      SHELL: process.env.SHELL ?? "/bin/zsh",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (b: Buffer) => {
    log.write(b);
    const line = b.toString().split("\n").filter((l) => l.trim()).pop();
    if (line) updateGoal(goal.id, { lastOutput: line.slice(0, 200) }).catch(() => {});
  });
  child.stderr.on("data", (b: Buffer) => {
    log.write(`[stderr] ${b}`);
  });
  child.on("close", (code) => {
    log.write(`\n=== END ${new Date().toISOString()} · exit ${code} ===\n`);
    log.end();
    updateGoal(goal.id, {
      status: code === 0 ? "completed" : "failed",
      finishedAt: Date.now(),
      pid: undefined,
      exitCode: code,
    }).catch(() => {});
  });
  child.unref();
  await updateGoal(id, { status: "running", startedAt: Date.now(), pid: child.pid, exitCode: null });
  return { ...goal, status: "running", pid: child.pid, startedAt: Date.now(), exitCode: null };
}
