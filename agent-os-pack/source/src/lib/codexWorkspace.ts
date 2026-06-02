// Codex CLI workspace browser.
//
// What Codex stores:
//   ~/.codex/session_index.jsonl     — one JSON object per past session
//   ~/.codex/sessions/YYYY/MM/DD/    — actual session transcript files (JSONL)
//   ~/.codex/archived_sessions/      — older sessions
//
// Plus we maintain our own scratch root for projects Codex creates during goals:
//   ~/codex-scratch/<project-name>/  — anything Codex writes during a Goal Mode run
//
// Mirror of antigravityWorkspace.ts shape — same WsProject / WsFile types so the
// existing preview iframe in AntigravityView can be reused.

import { readdir, readFile, stat, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { runCompilerGate } from "@/lib/daemon-ctl";
import { appendMemory, VAULT_ROOT } from "@/lib/vaultWriter";

const HOME = os.homedir();
export const CODEX_HOME = path.join(HOME, ".codex");
export const CODEX_SESSION_INDEX = path.join(CODEX_HOME, "session_index.jsonl");
export const CODEX_SESSIONS_ROOT = path.join(CODEX_HOME, "sessions");
export const CODEX_SCRATCH_ROOT = process.env.AGENTIC_OS_CODEX_SCRATCH
  ?? path.join(HOME, "codex-scratch");
export const CODEX_OBSIDIAN_ROOT = VAULT_ROOT || process.env.AGENTIC_OS_VAULT || path.join(HOME, ".config", "hermes", "vault");
export const CODEX_STATE_ROOT = path.join(HOME, ".agentic-os");
export const CODEX_GOALS_FILE = path.join(CODEX_STATE_ROOT, "codex-goals.json");
export const CODEX_GOAL_LOGS_ROOT = path.join(CODEX_STATE_ROOT, "codex-goal-logs");
export const CODEX_BUCKETS = [
  {
    id: "scratch",
    label: "Scratch",
    roots: [CODEX_SCRATCH_ROOT],
    description: "Codex working space and generated projects.",
  },
  {
    id: "state",
    label: "State",
    roots: [CODEX_STATE_ROOT],
    description: "Persistent goals, logs, and local runtime state.",
  },
  {
    id: "goals",
    label: "Goals",
    roots: [CODEX_GOALS_FILE, CODEX_GOAL_LOGS_ROOT],
    description: "Goal records and execution transcripts.",
  },
  {
    id: "obsidian",
    label: "Obsidian",
    roots: [CODEX_OBSIDIAN_ROOT],
    description: "Shared memory vault and daily notes.",
  },
  {
    id: "sessions",
    label: "Sessions",
    roots: [CODEX_HOME, CODEX_SESSIONS_ROOT],
    description: "Codex session index and transcript history.",
  },
] as const;
const CODEX_ALLOWED_ROOTS = CODEX_BUCKETS.flatMap((b) => b.roots).filter(Boolean) as string[];

export interface CodexSession {
  id: string;
  threadName: string;
  updatedAt: number;
}

export interface SessionTurn { role: "user" | "assistant" | "reasoning"; text: string; ts?: number; }
export interface SessionToolCall { name: string; args: string; output?: string; }
export interface SessionDetail {
  id: string;
  threadName: string;
  cwd: string;
  cwdExists: boolean;
  startedAt: number;
  model: string | null;
  turns: SessionTurn[];
  toolCalls: SessionToolCall[];
  referencedFiles: string[];
  cwdFiles: CdxFile[];
}

const SESSIONS_DIRS = [CODEX_SESSIONS_ROOT, path.join(HOME, ".codex", "archived_sessions")];

async function findSessionFile(id: string): Promise<string | null> {
  if (!/^[A-Za-z0-9-]+$/.test(id)) return null;
  for (const root of SESSIONS_DIRS) {
    if (!existsSync(root)) continue;
    async function walk(dir: string, depth: number): Promise<string | null> {
      if (depth > 4) return null;
      let items;
      try { items = await readdir(dir, { withFileTypes: true }); }
      catch { return null; }
      for (const it of items) {
        const full = path.join(dir, it.name);
        if (it.isDirectory()) {
          const found = await walk(full, depth + 1);
          if (found) return found;
        } else if (it.isFile() && it.name.includes(id) && it.name.endsWith(".jsonl")) {
          return full;
        }
      }
      return null;
    }
    const found = await walk(root, 0);
    if (found) return found;
  }
  return null;
}

const PATH_RE = /(\/[A-Za-z0-9._\-\/]+\.(?:png|jpg|jpeg|webp|gif|svg|avif|mp4|webm|mov|m4v|mp3|wav|m4a|ogg|pdf|html|htm|css|js|jsx|ts|tsx|json|md|txt|csv|py|sh))/g;
function extractPaths(s: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = PATH_RE.exec(s)) !== null) {
    if (m[1].length < 400) out.add(m[1]);
  }
  return Array.from(out);
}

export async function readSession(id: string): Promise<SessionDetail | null> {
  const file = await findSessionFile(id);
  if (!file) return null;

  const txt = await readFile(file, "utf8").catch(() => "");
  if (!txt) return null;

  let cwd = "";
  let model: string | null = null;
  let startedAt = 0;
  let threadName = id;
  const turns: SessionTurn[] = [];
  const toolCalls: SessionToolCall[] = [];
  const referenced = new Set<string>();

  try {
    const idx = await readFile(CODEX_SESSION_INDEX, "utf8");
    for (const line of idx.split(/\r?\n/)) {
      try { const j = JSON.parse(line); if (j?.id === id && j?.thread_name) { threadName = j.thread_name; break; } }
      catch {}
    }
  } catch {}

  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    const ts = j?.timestamp ? Date.parse(j.timestamp) : undefined;
    const t = j?.type;
    const p = j?.payload ?? {};
    if (t === "session_meta") {
      cwd = String(p.cwd ?? "");
      model = typeof p.model === "string" ? p.model : (p.model_provider ?? null);
      startedAt = p.timestamp ? Date.parse(p.timestamp) : (ts ?? 0);
    } else if (t === "event_msg") {
      const pt = p.type;
      if (pt === "user_message" && typeof p.message === "string") {
        if (!/^<environment_context>/.test(p.message)) turns.push({ role: "user", text: p.message, ts });
        for (const pth of extractPaths(p.message)) referenced.add(pth);
      } else if (pt === "agent_message" && typeof p.message === "string") {
        turns.push({ role: "assistant", text: p.message, ts });
        for (const pth of extractPaths(p.message)) referenced.add(pth);
      }
    } else if (t === "response_item") {
      const rt = p.type;
      if (rt === "function_call") {
        const name = String(p.name ?? p.tool_name ?? "tool");
        const args = typeof p.arguments === "string" ? p.arguments : JSON.stringify(p.arguments ?? {});
        toolCalls.push({ name, args: args.slice(0, 4000) });
        for (const pth of extractPaths(args)) referenced.add(pth);
      } else if (rt === "function_call_output") {
        const last = toolCalls[toolCalls.length - 1];
        const output = typeof p.output === "string" ? p.output : JSON.stringify(p.output ?? "");
        if (last) last.output = output.slice(0, 4000);
        for (const pth of extractPaths(output)) referenced.add(pth);
      } else if (rt === "reasoning") {
        const summary = Array.isArray(p.summary) ? p.summary.map((s: { text?: string } | string) => typeof s === "string" ? s : (s?.text ?? "")).join("\n") : "";
        if (summary.trim()) turns.push({ role: "reasoning", text: summary, ts });
      }
    }
  }

  let cwdFiles: CdxFile[] = [];
  let cwdExists = false;
  if (cwd && existsSync(cwd)) {
    cwdExists = true;
    async function walk(dir: string, depth: number, base: string) {
      if (cwdFiles.length >= 60 || depth > 3) return;
      let items;
      try { items = await readdir(dir, { withFileTypes: true }); }
      catch { return; }
      for (const it of items) {
        if (cwdFiles.length >= 60) break;
        if (SKIP_DIRS.has(it.name)) continue;
        const full = path.join(dir, it.name);
        if (it.isDirectory()) {
          await walk(full, depth + 1, base);
        } else if (it.isFile()) {
          const st = await safeStat(full);
          if (!st) continue;
          const kind = fileKind(it.name);
          cwdFiles.push({
            name: it.name,
            relPath: path.relative(base, full),
            bytes: st.size,
            mtime: st.mtimeMs,
            isText: kind === "text",
            kind,
          });
        }
      }
    }
    await walk(cwd, 0, cwd);
    cwdFiles.sort((a, b) => b.mtime - a.mtime);
  }

  return { id, threadName, cwd, cwdExists, startedAt, model, turns, toolCalls, referencedFiles: Array.from(referenced).slice(0, 60), cwdFiles };
}

export function isPathUnderHome(absPath: string): boolean {
  const resolved = path.resolve(absPath);
  return resolved === HOME || resolved.startsWith(HOME + path.sep);
}

export function isPathUnderCodexAllowedRoot(absPath: string): boolean {
  const resolved = path.resolve(absPath);
  return CODEX_ALLOWED_ROOTS.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

export function resolveCodexAllowedRoot(absPath: string): string | null {
  const resolved = path.resolve(absPath);
  for (const root of CODEX_ALLOWED_ROOTS) {
    if (resolved === root || resolved.startsWith(root + path.sep)) return root;
  }
  return null;
}

export interface CdxProject { name: string; root: string; mtime: number; fileCount: number; }
export type CdxFileKind = "text" | "image" | "video" | "audio" | "pdf" | "binary";
export interface CdxFile { name: string; relPath: string; bytes: number; mtime: number; isText: boolean; kind: CdxFileKind; }

const TEXT_EXTS = new Set([
  ".md", ".markdown", ".txt", ".json", ".yaml", ".yml", ".html", ".htm",
  ".css", ".js", ".ts", ".tsx", ".jsx", ".py", ".sh", ".log", ".csv", ".tsv",
  ".xml", ".toml", ".env", ".svg", ".rs", ".go", ".rb", ".java", ".c", ".cpp", ".h",
]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov", ".m4v"]);
const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".ogg", ".aac", ".flac"]);

function fileKind(name: string): CdxFileKind {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (ext === ".pdf") return "pdf";
  if (TEXT_EXTS.has(ext)) return "text";
  return "binary";
}

const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "__pycache__", ".next", "dist", "build"]);

async function safeStat(p: string) {
  try { return await stat(p); } catch { return null; }
}

async function countFiles(dir: string, depth = 4): Promise<number> {
  if (depth < 0) return 0;
  let n = 0;
  try {
    const items = await readdir(dir, { withFileTypes: true });
    for (const it of items) {
      if (SKIP_DIRS.has(it.name)) continue;
      const full = path.join(dir, it.name);
      if (it.isFile()) n++;
      else if (it.isDirectory()) n += await countFiles(full, depth - 1);
    }
  } catch { /* ignore */ }
  return n;
}

export async function listProjects(): Promise<CdxProject[]> {
  const out: CdxProject[] = [];
  if (!existsSync(CODEX_SCRATCH_ROOT)) return out;
  try {
    const items = await readdir(CODEX_SCRATCH_ROOT, { withFileTypes: true });
    for (const it of items) {
      if (!it.isDirectory()) continue;
      const full = path.join(CODEX_SCRATCH_ROOT, it.name);
      const st = await safeStat(full);
      if (!st) continue;
      const fileCount = await countFiles(full);
      if (fileCount === 0) continue;
      out.push({ name: it.name, root: full, mtime: st.mtimeMs, fileCount });
    }
  } catch { /* ignore */ }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

export async function listProjectFiles(project: string, maxFiles = 80): Promise<{ root: string; files: CdxFile[] } | null> {
  if (!/^[A-Za-z0-9_.-]+$/.test(project)) return null;
  const projectRoot = path.join(CODEX_SCRATCH_ROOT, project);
  if (!existsSync(projectRoot)) return null;

  const out: CdxFile[] = [];
  async function walk(dir: string, depth: number) {
    if (out.length >= maxFiles || depth > 4) return;
    let items;
    try { items = await readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const it of items) {
      if (out.length >= maxFiles) break;
      if (SKIP_DIRS.has(it.name)) continue;
      const full = path.join(dir, it.name);
      if (it.isDirectory()) {
        await walk(full, depth + 1);
      } else if (it.isFile()) {
        const st = await safeStat(full);
        if (!st) continue;
        const kind = fileKind(it.name);
        out.push({
          name: it.name,
          relPath: path.relative(projectRoot, full),
          bytes: st.size,
          mtime: st.mtimeMs,
          isText: kind === "text",
          kind,
        });
      }
    }
  }
  await walk(projectRoot, 0);
  out.sort((a, b) => b.mtime - a.mtime);
  return { root: projectRoot, files: out };
}

export async function readProjectFile(project: string, relPath: string): Promise<{ path: string; content: string; bytes: number; mtime: number; truncated: boolean } | null> {
  if (!/^[A-Za-z0-9_.-]+$/.test(project)) return null;
  const base = path.join(CODEX_SCRATCH_ROOT, project);
  const resolved = path.resolve(base, relPath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;

  const st = await safeStat(resolved);
  if (!st || !st.isFile()) return null;
  const MAX = 1_000_000;
  const truncated = st.size > MAX;
  const buf = await readFile(resolved);
  const trimmed = truncated ? buf.subarray(0, MAX) : buf;
  return { path: relPath, content: trimmed.toString("utf8"), bytes: st.size, mtime: st.mtimeMs, truncated };
}

export async function writeProjectFile(
  project: string,
  relPath: string,
  content: string,
  opts?: {
    goalId?: string;
    envChanges?: Record<string, unknown>;
    summary?: string;
  }
): Promise<{ path: string; bytes: number; compilerGate?: { ok: boolean; command: string; output: string } } | null> {
  if (!/^[A-Za-z0-9_.-]+$/.test(project)) return null;
  const base = path.join(CODEX_SCRATCH_ROOT, project);
  const resolved = path.resolve(base, relPath);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  await mkdir(path.dirname(resolved), { recursive: true });
  await import("node:fs/promises").then(({ writeFile }) => writeFile(resolved, content, "utf8"));
  const compilerGate = runCompilerGate(base);
  if (compilerGate.ok) {
    await appendMemory({
      agent: "codex",
      kind: "goal",
      text: [
        `### Codex clean-build sync`,
        `- Project: ${project}`,
        `- Goal ID: ${opts?.goalId ?? project}`,
        `- Mutated file: ${relPath}`,
        `- Compiler gate: ${compilerGate.command}`,
        `- Vault path: ${CODEX_OBSIDIAN_ROOT}`,
        opts?.summary ? `- Summary: ${opts.summary}` : "",
      ].join("\n"),
      meta: {
        source: "codex-scratch-sync",
        project,
        goal_id: opts?.goalId ?? project,
        mutated_files: [relPath],
        environment_changes: {
          codebase: "agentic-os",
          scratchRoot: CODEX_SCRATCH_ROOT,
          obsidianRoot: CODEX_OBSIDIAN_ROOT,
          ...(opts?.envChanges ?? {}),
        } satisfies Record<string, unknown>,
      },
    });
  }
  return { path: relPath, bytes: Buffer.byteLength(content, "utf8"), compilerGate };
}
