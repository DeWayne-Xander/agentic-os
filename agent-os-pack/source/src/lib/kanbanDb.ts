// Direct read-only access to the Hermes kanban SQLite database.
// Shelling out to `hermes kanban list --json` costs ~2 seconds per call (Python cold start),
// and the board page used to do 4 of those calls in parallel — total ~8s render time.
// Reading the same data straight from SQLite is sub-50ms.
//
// Writes still go through `hermes kanban …` so we don't bypass event emission, the dispatcher
// notification path, or the gateway's runtime locks.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { GOALS_FILE } from "@/lib/vaultWriter";
import { HERMES_HOME as APP_HERMES_HOME, LEGACY_HERMES_HOME } from "@/lib/agentHomes";

// ─── node:sqlite type shim ──────────────────────────────────────────────────
// node:sqlite is available in Node >= 22 behind --experimental-sqlite.
// Since Next.js doesn't always enable it, we load the module at runtime
// and type it with a local interface so the build never fails.
interface SqliteDatabaseSync {
  prepare(sql: string): { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown };
  close(): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DatabaseSync: (new (p: string, opts: { readOnly: boolean }) => SqliteDatabaseSync) | null = null;
try {
  if (process.versions.node && parseInt(process.versions.node.split(".")[0]) >= 22) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const sqlite = require("node:sqlite") as any;
    if (sqlite?.DatabaseSync) DatabaseSync = sqlite.DatabaseSync;
  }
} catch {
  // node:sqlite unavailable — fall back to JSON-only mode
}

const HERMES_HOME_CANDIDATES = [APP_HERMES_HOME, LEGACY_HERMES_HOME];

export interface BoardEntry { slug: string; name: string; current: boolean; dbPath: string; }
export interface TaskRow {
  id: string; title: string; body: string | null; assignee: string | null;
  status: string; priority: number; tenant: string | null;
  workspace_kind: string; workspace_path: string | null;
  created_by: string | null; created_at: number;
  started_at: number | null; completed_at: number | null;
  result: string | null; skills: string[];
}
export interface CommentRow { id: number; body: string; author: string | null; created_at: number; }
export interface EventRow { id: number; kind: string; payload: Record<string, unknown> | null; created_at: number; run_id: number | null; }
export interface RunRow {
  id: number; profile: string | null; status: string;
  started_at: number; ended_at: number | null;
  outcome: string | null; summary: string | null;
  metadata: Record<string, unknown> | null; error: string | null;
}

// ─── DB path resolution ─────────────────────────────────────────────────────
export function listBoards(): BoardEntry[] {
  const out: BoardEntry[] = [];
  const defaultDb = HERMES_HOME_CANDIDATES
    .map((root) => path.join(root, "kanban.db"))
    .find((p) => existsSync(p)) ?? path.join(HERMES_HOME_CANDIDATES[0], "kanban.db");
  out.push({ slug: "default", name: "Default", current: false, dbPath: defaultDb });

  for (const root of HERMES_HOME_CANDIDATES) {
    const boardsRoot = path.join(root, "kanban", "boards");
    if (!existsSync(boardsRoot)) continue;
    try {
      for (const entry of readdirSync(boardsRoot)) {
        if (entry.startsWith("_")) continue; // skip _archived
        const full = path.join(boardsRoot, entry);
        try {
          if (!statSync(full).isDirectory()) continue;
        } catch { continue; }
        const dbPath = path.join(full, "kanban.db");
        if (!existsSync(dbPath)) continue;
        // Display name lives in board.json if present
        let name = entry;
        try {
          const metaPath = path.join(full, "board.json");
          if (existsSync(metaPath)) {
            const m = JSON.parse(readFileSync(metaPath, "utf8"));
            if (typeof m.name === "string") name = m.name;
          }
        } catch {}
        out.push({ slug: entry, name, current: false, dbPath });
      }
    } catch {}
  }

  // Current pointer
  let currentSlug = "default";
  for (const root of HERMES_HOME_CANDIDATES) {
    const currentFile = path.join(root, "kanban", "current");
    if (!existsSync(currentFile)) continue;
    try {
      currentSlug = readFileSync(currentFile, "utf8").trim() || "default";
      break;
    } catch {}
  }
  for (const b of out) b.current = b.slug === currentSlug;
  return out;
}

function dbPathForBoard(slug: string | undefined): string {
  if (!slug || slug === "default") {
    return HERMES_HOME_CANDIDATES
      .map((root) => path.join(root, "kanban.db"))
      .find((p) => existsSync(p)) ?? path.join(HERMES_HOME_CANDIDATES[0], "kanban.db");
  }
  if (!/^[a-z0-9_-]{1,64}$/.test(slug)) throw new Error("invalid board slug");
  for (const root of HERMES_HOME_CANDIDATES) {
    const p = path.join(root, "kanban", "boards", slug, "kanban.db");
    if (existsSync(p)) return p;
  }
  return path.join(HERMES_HOME_CANDIDATES[0], "kanban", "boards", slug, "kanban.db");
}

function openDb(slug?: string): SqliteDatabaseSync | null {
  if (!DatabaseSync) return null;
  const p = dbPathForBoard(slug);
  if (!existsSync(p)) return null;
  try {
    return new DatabaseSync(p, { readOnly: true });
  } catch {
    return null;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────
function guardDb<T>(slug: string | undefined, fn: (db: SqliteDatabaseSync) => T, fallback: T): T {
  const db = openDb(slug);
  if (!db) return fallback;
  try { return fn(db); } catch { return fallback; } finally { try { db.close(); } catch { /* noop */ } }
}

// ─── Queries ────────────────────────────────────────────────────────────────
function parseJsonField<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

function rowToTask(r: Record<string, unknown>): TaskRow {
  return {
    id: String(r.id),
    title: String(r.title ?? ""),
    body: (r.body as string | null) ?? null,
    assignee: (r.assignee as string | null) ?? null,
    status: String(r.status ?? "todo"),
    priority: Number(r.priority ?? 0),
    tenant: (r.tenant as string | null) ?? null,
    workspace_kind: String(r.workspace_kind ?? "scratch"),
    workspace_path: (r.workspace_path as string | null) ?? null,
    created_by: (r.created_by as string | null) ?? null,
    created_at: Number(r.created_at ?? 0),
    started_at: r.started_at == null ? null : Number(r.started_at),
    completed_at: r.completed_at == null ? null : Number(r.completed_at),
    result: (r.result as string | null) ?? null,
    skills: parseJsonField<string[]>(r.skills as string | null, []),
  };
}

const GOAL_LINE = /^- \[( |x|X)\]\s+(?:\(([^)]+)\)\s+)?(.+?)(?:\s+<!--\s+([^>]+)\s+-->)?$/;

function parseGoalMeta(meta: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of meta.split(/\s+/)) {
    const idx = token.indexOf(":");
    if (idx <= 0) continue;
    const key = token.slice(0, idx).trim();
    const value = token.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function inferGoalAssignee(title: string, category?: string): string {
  const hay = `${title} ${category ?? ""}`.toLowerCase();
  if (/(research|analy[sz]e|study|review|summar|summari[sz]e|investigat|reasoning|architecture|design|plan|memory|notebook)/.test(hay)) return "labyrinth";
  if (/(telegram|schedule|notify|monitor|runtime|daemon|health|ops|cron|gateway|session|status|orchestr|triage)/.test(hay)) return "chrono";
  if (/(code|build|fix|refactor|implement|debug|frontend|backend|api|typescript|workspace)/.test(hay)) return "codex";
  return "chrono";
}

function readGoalMirrorTasks(): TaskRow[] {
  if (!GOALS_FILE || !existsSync(GOALS_FILE)) return [];
  try {
    const content = readFileSync(GOALS_FILE, "utf8");
    const out: TaskRow[] = [];
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(GOAL_LINE);
      if (!m) continue;
      const meta = m[4] ? parseGoalMeta(m[4]) : {};
      const title = m[3].trim();
      const done = m[1].toLowerCase() === "x";
      const createdAt = meta.createdAt ? Date.parse(meta.createdAt) : Date.now();
      const assignee = meta.assignee || inferGoalAssignee(title, m[2] || undefined);
      const taskId = meta.taskId || `goal_${meta.id || Math.random().toString(36).slice(2, 10)}`;
      out.push({
        id: taskId,
        title,
        body: [
          `Mirrored from Agentic OS Goals`,
          meta.id ? `Goal ID: ${meta.id}` : null,
          meta.delegatedAt ? `Delegated: ${meta.delegatedAt}` : null,
          meta.assignee ? `Assignee: ${meta.assignee}` : null,
        ].filter(Boolean).join("\n"),
        assignee,
        status: done ? "done" : "triage",
        priority: 0,
        tenant: "agentic-os",
        workspace_kind: "goal",
        workspace_path: meta.id ? path.join(os.homedir(), "codex-scratch", meta.id) : null,
        created_by: "goals",
        created_at: Number.isNaN(createdAt) ? Math.floor(Date.now() / 1000) : Math.floor(createdAt / 1000),
        started_at: meta.delegatedAt ? Math.floor(Date.parse(meta.delegatedAt) / 1000) : null,
        completed_at: done ? Math.floor(Date.now() / 1000) : null,
        result: done ? "Completed from Goals page" : null,
        skills: [],
      });
    }
    return out;
  } catch {
    return [];
  }
}

function mergeTasks(primary: TaskRow[], mirror: TaskRow[]): TaskRow[] {
  const seen = new Set<string>();
  const out: TaskRow[] = [];
  for (const task of [...mirror, ...primary]) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    out.push(task);
  }
  return out.sort((a, b) => b.created_at - a.created_at);
}

export function listTasks(slug?: string, includeArchived = true): TaskRow[] {
  const dbTasks = guardDb(slug, (db) => {
    const sql = includeArchived
      ? "SELECT * FROM tasks ORDER BY created_at DESC"
      : "SELECT * FROM tasks WHERE status != 'archived' ORDER BY created_at DESC";
    const rows = db.prepare(sql).all() as Record<string, unknown>[];
    return rows.map(rowToTask);
  }, []);
  return mergeTasks(dbTasks, readGoalMirrorTasks());
}

export function statsFor(slug?: string): { by_status: Record<string, number>; by_assignee: Record<string, Record<string, number>>; oldest_ready_age_seconds: number | null; now: number } {
  const tasks = listTasks(slug, true);
  const byStatus: Record<string, number> = {};
  const byAssignee: Record<string, Record<string, number>> = {};
  let oldestReady: number | null = null;
  for (const task of tasks) {
    byStatus[task.status] = (byStatus[task.status] ?? 0) + 1;
    if (task.assignee) {
      const a = byAssignee[task.assignee] ?? (byAssignee[task.assignee] = {});
      a[task.status] = (a[task.status] ?? 0) + 1;
    }
    if (task.status === "ready") {
      oldestReady = oldestReady == null ? task.created_at : Math.min(oldestReady, task.created_at);
    }
  }
  const now = Math.floor(Date.now() / 1000);
  return {
    by_status: byStatus,
    by_assignee: byAssignee,
    oldest_ready_age_seconds: oldestReady ? now - oldestReady : null,
    now,
  };
}

function basicAssignees(): { name: string; on_disk: boolean; counts: Record<string, number> }[] {
  const roots = [APP_HERMES_HOME, LEGACY_HERMES_HOME];
  const profiles = new Set<string>();
  for (const root of roots) {
    const profileRoot = path.join(root, "profiles");
    if (!existsSync(profileRoot)) continue;
    try {
      for (const p of readdirSync(profileRoot)) {
        try {
          if (statSync(path.join(profileRoot, p)).isDirectory()) profiles.add(p);
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
  return Array.from(profiles).sort().map((name) => ({ name, on_disk: true, counts: {} as Record<string, number> }));
}

export function assigneesFor(slug?: string): { name: string; on_disk: boolean; counts: Record<string, number> }[] {
  const tasks = listTasks(slug, true);
  const counts: Record<string, Record<string, number>> = {};
  for (const task of tasks) {
    if (!task.assignee) continue;
    const a = counts[task.assignee] ?? (counts[task.assignee] = {});
    a[task.status] = (a[task.status] ?? 0) + 1;
  }
  const profiles = new Set(Object.keys(counts));
  for (const root of [APP_HERMES_HOME, LEGACY_HERMES_HOME]) {
    const profileRoot = path.join(root, "profiles");
    if (!existsSync(profileRoot)) continue;
    try {
      for (const p of readdirSync(profileRoot)) {
        try {
          if (statSync(path.join(profileRoot, p)).isDirectory()) profiles.add(p);
        } catch {}
      }
    } catch {}
  }
  return Array.from(profiles).sort().map((name) => ({
    name,
    on_disk: existsSync(path.join(APP_HERMES_HOME, "profiles", name)) || existsSync(path.join(LEGACY_HERMES_HOME, "profiles", name)),
    counts: counts[name] ?? {},
  }));
}

export function showTask(taskId: string, slug?: string): {
  task: TaskRow;
  latest_summary: string | null;
  parents: TaskRow[];
  children: TaskRow[];
  comments: CommentRow[];
  events: EventRow[];
  runs: RunRow[];
} | null {
  if (!/^t_[a-z0-9_-]+$/i.test(taskId)) return null;
  return guardDb(slug, (db) => {
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Record<string, unknown> | undefined;
    if (!row) {
      const mirror = readGoalMirrorTasks();
      const task = mirror.find((t) => t.id === taskId);
      if (!task) return null;
      return {
        task,
        latest_summary: task.result ?? null,
        parents: [],
        children: [],
        comments: [],
        events: [],
        runs: [],
      };
    }
    const task = rowToTask(row);

    const parentRows = db.prepare(
      "SELECT t.* FROM task_links l JOIN tasks t ON t.id = l.parent_id WHERE l.child_id = ?"
    ).all(taskId) as Record<string, unknown>[];

    const childRows = db.prepare(
      "SELECT t.* FROM task_links l JOIN tasks t ON t.id = l.child_id WHERE l.parent_id = ?"
    ).all(taskId) as Record<string, unknown>[];

    const commentRows = db.prepare(
      "SELECT id, author, body, created_at FROM task_comments WHERE task_id = ? ORDER BY created_at ASC"
    ).all(taskId) as { id: number; author: string | null; body: string; created_at: number }[];

    const eventRows = db.prepare(
      "SELECT id, kind, payload, created_at, run_id FROM task_events WHERE task_id = ? ORDER BY id ASC"
    ).all(taskId) as { id: number; kind: string; payload: string | null; created_at: number; run_id: number | null }[];

    const runRows = db.prepare(
      "SELECT id, profile, status, started_at, ended_at, outcome, summary, metadata, error FROM task_runs WHERE task_id = ? ORDER BY started_at ASC"
    ).all(taskId) as { id: number; profile: string | null; status: string; started_at: number; ended_at: number | null; outcome: string | null; summary: string | null; metadata: string | null; error: string | null }[];

    let latest_summary: string | null = null;
    for (let i = runRows.length - 1; i >= 0; i--) {
      if (runRows[i].summary) { latest_summary = runRows[i].summary; break; }
    }

    return {
      task,
      latest_summary,
      parents: parentRows.map(rowToTask),
      children: childRows.map(rowToTask),
      comments: commentRows,
      events: eventRows.map((e) => ({
        id: e.id, kind: e.kind, run_id: e.run_id, created_at: e.created_at,
        payload: parseJsonField<Record<string, unknown> | null>(e.payload, null),
      })),
      runs: runRows.map((r) => ({
        id: r.id, profile: r.profile, status: r.status,
        started_at: r.started_at, ended_at: r.ended_at,
        outcome: r.outcome, summary: r.summary, error: r.error,
        metadata: parseJsonField<Record<string, unknown> | null>(r.metadata, null),
      })),
    };
  }, null);
}
