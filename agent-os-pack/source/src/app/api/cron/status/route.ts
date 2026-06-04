import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CronStatus {
  label: string;
  color: string;
  icon: string;
}

interface EnrichedJob {
  job_id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  state: string;
  last_run_at: string | null;
  last_status: string | null;
  next_run_at: string | null;
  agent: string | null;
  has_script: boolean;
  status: CronStatus;
  lastRunDisplay: string;
  nextRunDisplay: string;
  isHealthy: boolean;
  isFailed: boolean;
  source: string;
}

function classifyAgent(name: string, prompt?: unknown): { agent: string; color: string; emoji: string } {
  const n = String(name || "").toLowerCase();
  const p =
    typeof prompt === "string"
      ? prompt.toLowerCase()
      : prompt && typeof prompt === "object"
        ? JSON.stringify(prompt).toLowerCase()
        : "";

  // Name is most reliable — check exact name prefixes/signals first
  if (n.startsWith("labyrinth") || n.includes("labyrinth-session-sync") || n.includes("labyrinth-nightly") || n.includes("labyrinth-weekly") || n.includes("dream-action-engine"))
    return { agent: "Labyrinth", color: "#00b894", emoji: "🧠" };
  if (n.startsWith("chrono") || n.includes("kanban-auto-dispatch"))
    return { agent: "Chrono", color: "#6c5ce7", emoji: "⏱️" };
  if (n.startsWith("kairos"))
    return { agent: "Kairos", color: "#f472b6", emoji: "🔧" };
  if (n.includes("intelligence-briefing") || n.includes("soccer-brief") || n.includes("evening-sitrep"))
    return { agent: "Labyrinth", color: "#00b894", emoji: "🧠" };

  // Prompt content fallback
  const lp = p.toLowerCase();
  if (lp.includes("you are labyrinth"))
    return { agent: "Labyrinth", color: "#00b894", emoji: "🧠" };
  if (lp.includes("you are chrono"))
    return { agent: "Chrono", color: "#6c5ce7", emoji: "⏱️" };

  // Script-only jobs → System
  return { agent: "System", color: "#a855f5", emoji: "⚙️" };
}

function statusIndicator(j: { enabled: boolean; last_status: string | null; state: string; last_run_at: string | null }): CronStatus {
  if (!j.enabled) return { label: "Paused", color: "#6b7280", icon: "⏸" };
  if (j.last_status === "ok") return { label: "Healthy", color: "#22c55e", icon: "✓" };
  if (j.last_status === "error" || j.last_status === "failed") return { label: "Failed", color: "#ef4444", icon: "✗" };
  if (j.state === "running") return { label: "Running", color: "#f59e0b", icon: "●" };
  if (!j.last_run_at) return { label: "Scheduled", color: "#a855f5", icon: "◎" };
  return { label: "OK", color: "#22c55e", icon: "✓" };
}

function timeAgoMs(ms: number | null): string {
  if (!ms) return "Never";
  const diff = Date.now() - ms;
  if (diff < 0) return "Pending";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function timeUntilMs(ms: number | null): string {
  if (!ms) return "Unknown";
  const diff = ms - Date.now();
  if (diff < 0) return "Overdue";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Now";
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs}h ${mins % 60}m`;
  return `in ${Math.floor(hrs / 24)}d`;
}

function scheduleDisplay(s: any): string {
  if (!s) return "—";
  if (typeof s === "string") return s;
  if (s.display) return s.display;
  if (s.kind === "interval" && s.minutes) return `every ${s.minutes}m`;
  if (s.kind === "every" && s.everyMs) {
    const mins = Math.floor(s.everyMs / 60000);
    if (mins < 60) return `every ${mins}m`;
    return `every ${Math.floor(mins / 60)}h`;
  }
  if (s.kind === "cron" && s.expr) {
    const parts = s.expr.split(" ");
    if (parts.length >= 5) {
      const [min, hour, , , dayOfWeek] = parts;
      if (dayOfWeek && dayOfWeek !== "*") {
        const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        const d = parseInt(dayOfWeek);
        const dayName = days[d] || dayOfWeek;
        const h = parseInt(hour);
        const ampm = h >= 12 ? "PM" : "AM";
        const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
        return `Weekly ${dayName} ${h12} ${ampm}`;
      }
      // Handle */N intervals like "0 */6 * * *" = every 6 hours
      if (hour.startsWith("*/") && min !== "*") {
        const interval = parseInt(hour.slice(2));
        if (interval) return `Every ${interval}h`;
      }
      if (hour !== "*" && min !== "*") {
        const h = parseInt(hour);
        const m = parseInt(min);
        if (!isNaN(h) && !isNaN(m)) {
          const ampm = h >= 12 ? "PM" : "AM";
          const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
          return `Daily ${h12}:${String(m).padStart(2, "0")} ${ampm}`;
        }
      }
      return s.expr;
    }
    return s.expr;
  }
  return "—";
}

function enrichJob(j: any, source: string): EnrichedJob {
  const agent = classifyAgent(j.name || "", j.prompt_preview || j.prompt || "");
  const status = statusIndicator(j);
  return {
    job_id: j.id || j.job_id || "",
    name: j.name || "Untitled",
    schedule: scheduleDisplay(j.schedule),
    enabled: j.enabled !== false,
    state: j.state || "scheduled",
    last_run_at: j.last_run_at || null,
    last_status: j.last_status || null,
    next_run_at: j.next_run_at || null,
    agent: `${agent.emoji} ${agent.agent}`,
    has_script: !!j.script,
    status,
    lastRunDisplay: j.last_run_at ? timeAgoMs(new Date(j.last_run_at).getTime()) : "Never",
    nextRunDisplay: j.next_run_at ? timeUntilMs(new Date(j.next_run_at).getTime()) : "Unknown",
    isHealthy: j.last_status === "ok" || (!j.last_run_at && j.enabled),
    isFailed: j.last_status === "error" || j.last_status === "failed",
    source,
  };
}

function loadHermesJobs(homedir: string): any[] {
  const { readFileSync, existsSync } = require("node:fs");
  const { join } = require("node:path");
  const filePath = join(homedir, ".hermes", "cron", "jobs.json");
  if (!existsSync(filePath)) return [];
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    return data.jobs || data || [];
  } catch {
    return [];
  }
}

function loadOpenClawJobs(homedir: string): any[] {
  const { readFileSync, existsSync } = require("node:fs");
  const { join } = require("node:path");

  const jobs: any[] = [];

  // Load job definitions
  const jobsFile = join(homedir, ".openclaw", "cron", "jobs.json");
  if (!existsSync(jobsFile)) return jobs;

  let jobDefs: any[] = [];
  try {
    const data = JSON.parse(readFileSync(jobsFile, "utf-8"));
    jobDefs = data.jobs || [];
  } catch {
    return jobs;
  }

  // Load state (has last run times, status, next run)
  const stateFile = join(homedir, ".openclaw", "cron", "jobs-state.json");
  let stateData: any = {};
  if (existsSync(stateFile)) {
    try {
      const s = JSON.parse(readFileSync(stateFile, "utf-8"));
      stateData = s.jobs || {};
    } catch {
      // ignore
    }
  }

  for (const j of jobDefs) {
    const id = j.id || j.job_id || "";
    const st = stateData[id] || {};
    const scheduleIdentity = st.scheduleIdentity ? JSON.parse(st.scheduleIdentity) : {};
    const innerState = st.state || {};

    jobs.push({
      id,
      name: j.name || "Untitled",
      schedule: j.schedule || scheduleIdentity.schedule || {},
      enabled: j.enabled !== false,
      state: innerState.lastStatus === "running" ? "running" : "scheduled",
      last_run_at: innerState.lastRunAtMs ? new Date(innerState.lastRunAtMs).toISOString() : null,
      last_status: innerState.lastRunStatus || null,
      next_run_at: innerState.nextRunAtMs ? new Date(innerState.nextRunAtMs).toISOString() : null,
      prompt_preview: j.prompt || "",
      script: null,
    });
  }

  return jobs;
}

export async function GET() {
  const { homedir } = await import("node:os");
  const home = homedir();

  const hermesJobs = loadHermesJobs(home).map((j: any) => enrichJob(j, "hermes"));
  const openclawJobs = loadOpenClawJobs(home).map((j: any) => enrichJob(j, "openclaw"));

  const allJobs = [...hermesJobs, ...openclawJobs];

  // Sort: running first, then by next_run_at
  allJobs.sort((a, b) => {
    if (a.state === "running" && b.state !== "running") return -1;
    if (b.state === "running" && a.state !== "running") return 1;
    const aTime = a.next_run_at ? new Date(a.next_run_at).getTime() : Infinity;
    const bTime = b.next_run_at ? new Date(b.next_run_at).getTime() : Infinity;
    return aTime - bTime;
  });

  return NextResponse.json({
    jobs: allJobs,
    total: allJobs.length,
    healthy: allJobs.filter((j) => j.isHealthy).length,
    failed: allJobs.filter((j) => j.isFailed).length,
    paused: allJobs.filter((j) => !j.enabled).length,
    running: allJobs.filter((j) => j.state === "running").length,
    sources: {
      hermes: hermesJobs.length,
      openclaw: openclawJobs.length,
    },
    generated_at: new Date().toISOString(),
  });
}
