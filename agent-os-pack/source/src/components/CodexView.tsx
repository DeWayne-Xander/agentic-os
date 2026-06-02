"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderTree, FileText, RefreshCw, ExternalLink, Image as ImageIcon, Film, Code2, FileQuestion, Target, TerminalSquare, Play, Square, RefreshCw as Reload } from "lucide-react";
import AgentAvatar from "./AgentAvatar";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";

const ACCENT = "#8b5cf6";

interface Project { name: string; root: string; mtime: number; fileCount: number; }
type FileKind = "text" | "image" | "video" | "audio" | "pdf" | "binary";
interface WsFile { name: string; relPath: string; bytes: number; mtime: number; isText: boolean; kind: FileKind; }
interface Goal { id: string; title: string; status: string; createdAt: number; pid?: number; cwd: string; lastOutput?: string; logFile?: string; startedAt?: number; finishedAt?: number; exitCode?: number | null; }
interface GoalDetail { goal: Goal; log: string; }

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
function fmtAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function kindIcon(k: FileKind) {
  if (k === "image") return <ImageIcon size={12} />;
  if (k === "video") return <Film size={12} />;
  if (k === "text") return <Code2 size={12} />;
  if (k === "binary") return <FileQuestion size={12} />;
  return <FileText size={12} />;
}

export default function CodexView() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [files, setFiles] = useState<WsFile[]>([]);
  const [openFile, setOpenFile] = useState<WsFile | null>(null);
  const [fileText, setFileText] = useState<string>("");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [goalDetail, setGoalDetail] = useState<GoalDetail | null>(null);
  const [goalLogLoading, setGoalLogLoading] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      const r = await fetch("/api/codex/workspace", { cache: "no-store" });
      const j = await r.json();
      const ps: Project[] = j.projects ?? [];
      setProjects(ps);
      setActiveProject((cur) => cur ?? (ps[0]?.name ?? null));
    } catch { /* ignore */ }
  }, []);

  const loadGoals = useCallback(async () => {
    try {
      const r = await fetch("/api/codex/goals", { cache: "no-store" });
      const j = await r.json();
      setGoals(j.goals ?? []);
    } catch { /* ignore */ }
  }, []);

  usePollWhileVisible(loadProjects, 8000);
  usePollWhileVisible(loadGoals, 8000);

  useEffect(() => {
    if (!activeProject) { setFiles([]); return; }
    let stop = false;
    (async () => {
      try {
        const r = await fetch(`/api/codex/workspace?project=${encodeURIComponent(activeProject)}`, { cache: "no-store" });
        const j = await r.json();
        if (!stop) setFiles(j.files ?? []);
      } catch { /* ignore */ }
    })();
    return () => { stop = true; };
  }, [activeProject]);

  const selectedGoal = useMemo(() => goals.find((g) => g.id === selectedGoalId) ?? null, [goals, selectedGoalId]);

  const refreshSelectedGoal = useCallback(async (goalId: string) => {
    setGoalLogLoading(true);
    try {
      const r = await fetch(`/api/codex/goals?id=${encodeURIComponent(goalId)}`, { cache: "no-store" });
      const j = await r.json();
      setGoalDetail(j.goal ? { goal: j.goal, log: j.log ?? "" } : null);
    } catch {
      setGoalDetail(null);
    } finally {
      setGoalLogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedGoalId) {
      setGoalDetail(null);
      return;
    }
    let stop = false;
    (async () => {
      await refreshSelectedGoal(selectedGoalId);
    })();
    return () => { stop = true; };
  }, [selectedGoalId, goals.length, refreshSelectedGoal]);

  useEffect(() => {
    if (!selectedGoalId && goals.length > 0) setSelectedGoalId(goals[0].id);
    if (selectedGoalId && !goals.some((g) => g.id === selectedGoalId)) setSelectedGoalId(goals[0]?.id ?? null);
  }, [goals, selectedGoalId]);

  async function openIt(f: WsFile) {
    setOpenFile(f);
    if (f.isText && activeProject) {
      try {
        const r = await fetch(`/api/codex/workspace/file?project=${encodeURIComponent(activeProject)}&path=${encodeURIComponent(f.relPath)}`, { cache: "no-store" });
        const j = await r.json();
        setFileText(j.content ?? "(empty)");
      } catch { setFileText("(failed to load)"); }
    } else {
      setFileText("");
    }
  }

  const previewUrl = openFile && activeProject
    ? `/api/codex/preview/project/${encodeURIComponent(activeProject)}/${openFile.relPath.split("/").map(encodeURIComponent).join("/")}`
    : null;
  const isHtml = openFile && (openFile.relPath.endsWith(".html") || openFile.relPath.endsWith(".htm"));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <AgentAvatar agent="codex" size={40} />
        <div>
          <h2 className="text-lg font-semibold" style={{ color: ACCENT }}>Codex Workspace</h2>
          <p className="text-sm" style={{ color: "var(--fg-dim)" }}>Active Codex workspace and goal tracking environment with sandboxed project browsing and preview access.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[260px_260px_1fr] gap-3" style={{ minHeight: "72vh" }}>
        <div className="panel p-2 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold flex items-center gap-1.5">
              <FolderTree size={12} /> Projects
            </div>
            <button onClick={loadProjects} title="Refresh" className="text-[var(--cream-mute)] hover:text-[var(--cream)]"><RefreshCw size={12} /></button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto scroll space-y-1">
            {projects.length === 0 && (
              <div className="px-2 py-3 text-[11px] text-[var(--cream-mute)] leading-snug">
                No Codex projects yet. Goals will write into <code>~/codex-scratch/&lt;project-name&gt;/</code>.
              </div>
            )}
            {projects.map((p) => (
              <button key={p.name}
                onClick={() => { setActiveProject(p.name); setOpenFile(null); }}
                className="block w-full text-left px-2.5 py-2 rounded-md border transition"
                style={{
                  borderColor: activeProject === p.name ? `${ACCENT}66` : "var(--line-soft)",
                  background: activeProject === p.name ? `${ACCENT}12` : "transparent",
                }}>
                <div className="text-[12px] text-[var(--cream)] truncate font-medium">{p.name}</div>
                <div className="text-[10px] text-[var(--cream-mute)] mono mt-0.5">{p.fileCount} files · {fmtAgo(p.mtime)}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="panel p-2 flex flex-col min-h-0">
        <div className="px-2 py-1.5 text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold">
            Goal Tracking {goals.length > 0 && `· ${goals.length}`}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto scroll space-y-1">
            {goals.length === 0 && (
              <div className="px-2 py-3 text-[11px] text-[var(--cream-mute)]">No active goals yet.</div>
            )}
            {goals.map((g) => (
              <button
                key={g.id}
                onClick={() => setSelectedGoalId(g.id)}
                className="w-full text-left rounded-md border px-2.5 py-2 transition"
                style={{
                  borderColor: selectedGoalId === g.id ? `${ACCENT}66` : "var(--line-soft)",
                  background: selectedGoalId === g.id ? `${ACCENT}10` : "rgba(255,255,255,0.02)",
                }}
              >
                <div className="flex items-center gap-1.5 text-[12px] text-[var(--cream)] font-medium">
                  <Target size={12} style={{ color: ACCENT }} /> {g.title}
                </div>
                <div className="text-[10px] text-[var(--cream-mute)] mono mt-0.5">{g.status} · {fmtAgo(g.createdAt)}</div>
                {g.lastOutput && <div className="text-[10.5px] text-[var(--cream-dim)] mt-2 line-clamp-3">{g.lastOutput}</div>}
              </button>
            ))}
          </div>
        </div>

        <div className="panel p-0 flex flex-col min-h-0 overflow-hidden">
          {!openFile ? (
            <div className="flex-1 grid place-items-center text-center p-6">
              <div>
                <FolderTree size={22} style={{ color: ACCENT }} className="mx-auto mb-2 opacity-60" />
                <div className="text-[12.5px] text-[var(--cream)] mb-1">Pick a file to preview</div>
                <div className="text-[11px] text-[var(--cream-mute)]">Project files render live · text shows source · sandbox stays under `~/codex-scratch`</div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--line-soft)" }}>
                <div className="text-[12px] text-[var(--cream)] truncate mono">{openFile.relPath}</div>
                {previewUrl && (
                  <a href={previewUrl} target="_blank" rel="noopener noreferrer" title="Open in new tab"
                    className="text-[var(--cream-mute)] hover:text-[var(--cream)]"><ExternalLink size={13} /></a>
                )}
              </div>
              <div className="flex-1 min-h-0 overflow-auto bg-[#0a070d]">
                {openFile.kind === "image" && previewUrl && (
                  <div className="grid place-items-center h-full p-4"><img src={previewUrl} alt={openFile.name} className="max-w-full max-h-full object-contain" /></div>
                )}
                {openFile.kind === "video" && previewUrl && (
                  <div className="grid place-items-center h-full p-4"><video src={previewUrl} controls className="max-w-full max-h-full" /></div>
                )}
                {openFile.kind === "audio" && previewUrl && (
                  <div className="grid place-items-center h-full p-6"><audio src={previewUrl} controls /></div>
                )}
                {isHtml && previewUrl && (
                  <iframe src={previewUrl} className="w-full h-full border-0 bg-white" title={openFile.name} sandbox="allow-scripts allow-same-origin" />
                )}
                {openFile.isText && !isHtml && (
                  <pre className="text-[11.5px] mono text-[var(--cream)] p-4 whitespace-pre-wrap leading-relaxed">{fileText}</pre>
                )}
                {openFile.kind === "binary" && (
                  <div className="grid place-items-center h-full text-[12px] text-[var(--cream-mute)]">Binary file</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="panel p-0 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--line-soft)" }}>
          <div className="flex items-center gap-2">
            <TerminalSquare size={14} style={{ color: ACCENT }} />
            <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold">Goal Control Room</div>
          </div>
          <div className="flex items-center gap-2">
            {selectedGoal && (
              <button
                className="text-[11px] px-2 py-1 rounded-md border"
                style={{ borderColor: `${ACCENT}55`, color: ACCENT, background: `${ACCENT}10` }}
                onClick={() => refreshSelectedGoal(selectedGoal.id)}
              >
                <Reload size={11} className="inline-block mr-1" /> Refresh
              </button>
            )}
          </div>
        </div>
        {!selectedGoal ? (
          <div className="p-6 text-[12px] text-[var(--cream-mute)]">Pick a goal to inspect PID, logs, and its live execution status.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] min-h-[300px]">
            <div className="p-3 border-b lg:border-b-0 lg:border-r" style={{ borderColor: "var(--line-soft)" }}>
              <div className="text-[13px] font-semibold text-[var(--cream)]">{selectedGoal.title}</div>
              <div className="mt-1 text-[11px] text-[var(--cream-mute)] mono">ID {selectedGoal.id}</div>
              <div className="mt-3 space-y-2 text-[11px]">
                <div className="flex justify-between gap-3"><span className="text-[var(--cream-mute)]">Status</span><span className="text-[var(--cream)]">{goalDetail?.goal.status ?? selectedGoal.status}</span></div>
                <div className="flex justify-between gap-3"><span className="text-[var(--cream-mute)]">PID</span><span className="text-[var(--cream)]">{goalDetail?.goal.pid ?? selectedGoal.pid ?? "—"}</span></div>
                <div className="flex justify-between gap-3"><span className="text-[var(--cream-mute)]">CWD</span><span className="text-[var(--cream)] mono text-right break-all">{goalDetail?.goal.cwd ?? selectedGoal.cwd}</span></div>
                <div className="flex justify-between gap-3"><span className="text-[var(--cream-mute)]">Started</span><span className="text-[var(--cream)]">{goalDetail?.goal.startedAt ? fmtAgo(goalDetail.goal.startedAt) : "—"}</span></div>
                <div className="flex justify-between gap-3"><span className="text-[var(--cream-mute)]">Finished</span><span className="text-[var(--cream)]">{goalDetail?.goal.finishedAt ? fmtAgo(goalDetail.goal.finishedAt) : "—"}</span></div>
                <div className="flex justify-between gap-3"><span className="text-[var(--cream-mute)]">Exit</span><span className="text-[var(--cream)]">{goalDetail?.goal.exitCode ?? "—"}</span></div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <button
                  className="px-2.5 py-1.5 rounded-md border text-[11px] opacity-60"
                  style={{ borderColor: `${ACCENT}55`, color: ACCENT, background: `${ACCENT}10` }}
                  title={selectedGoal.status === "running" ? "Goal is already running" : "Start this goal now"}
                  disabled={selectedGoal.status === "running"}
                  onClick={() => {
                    fetch("/api/codex/goals", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: "spawn",
                        id: selectedGoal.id,
                      }),
                    }).then(() => Promise.all([loadGoals(), refreshSelectedGoal(selectedGoal.id)])).catch(() => {});
                  }}
                >
                  <Play size={11} className="inline-block mr-1" /> Start
                </button>
                <button
                  className="px-2.5 py-1.5 rounded-md border text-[11px]"
                  style={{ borderColor: "rgba(248,113,113,0.45)", color: "#fca5a5", background: "rgba(248,113,113,0.08)" }}
                  onClick={() => {
                    const id = selectedGoal.id;
                    fetch("/api/codex/goals", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "stop", id }),
                    }).then(() => Promise.all([loadGoals(), refreshSelectedGoal(id)])).catch(() => {});
                  }}
                >
                  <Square size={11} className="inline-block mr-1" /> Stop
                </button>
              </div>
            </div>
            <div className="p-3 min-h-[300px]">
              <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold mb-2">Live Log</div>
              <div className="rounded-md border bg-[#0a070d] p-3 text-[11px] mono min-h-[260px] whitespace-pre-wrap leading-relaxed" style={{ borderColor: "var(--line-soft)" }}>
                {goalLogLoading ? "Loading log…" : (goalDetail?.log || "No log yet.")}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="panel p-2">
        <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--cream-mute)] font-semibold flex items-center gap-1.5">
          <Code2 size={12} /> Codex workspace and goal plane are live
        </div>
        <div className="text-[11px] text-[var(--cream-mute)] mt-1">
          Workspace API: `/api/codex/workspace` · Goals API: `/api/codex/goals` · Preview API: `/api/codex/preview`
        </div>
      </div>
    </div>
  );
}
