/**
 * Chrono Engine — Event-Driven Test Runner (Phase 5)
 *
 * Replaces standard cron interval checking with a native event-driven listener
 * that intercepts process limits, memory ceilings, and code pipeline changes.
 *
 * On code modification → triggers regression test suite against Gold Standard
 * → computes score delta → sends Telegram approval alert if metrics degrade.
 */

import { execSync, exec, type ChildProcess } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import os from "node:os";

// ─── Types ─────────────────────────────────────────────────────────

export interface ChronoEvent {
  type: "file-change" | "process-limit" | "memory-ceiling" | "port-down" | "eval-failure" | "manual";
  source: string;
  timestamp: number;
  details: Record<string, unknown>;
}

export interface RegressionResult {
  testId: string;
  goldStandardRef: string;
  previousScore: number;
  currentScore: number;
  delta: number;
  passed: boolean;
  feedback: string;
}

export interface ChronoAlert {
  severity: "info" | "warning" | "critical";
  event: ChronoEvent;
  regression?: RegressionResult;
  message: string;
  requiresApproval: boolean;
}

export interface WatchedPath {
  path: string;
  pattern: RegExp;
  category: "api-routes" | "components" | "lib" | "context" | "hooks";
  lastMtime: number;
}

// ─── Configuration ─────────────────────────────────────────────────

const AGENT_DIR = path.join(os.homedir(), "Projects", "agentic-os-source", "agent-os-pack", "source");
const GOLD_STANDARD_DIR = path.join(os.homedir(), ".config", "hermes", "vault", "System_Evals", "Gold_Standard");
const CHRONO_LOG = path.join(os.homedir(), ".openclaw", "workspace", "logs", "chrono-events.log");
const SCORE_HISTORY = path.join(os.homedir(), ".openclaw", "workspace", "logs", "chrono-scores.json");

const WATCHED_PATHS: WatchedPath[] = [
  { path: path.join(AGENT_DIR, "src", "app", "api"), pattern: /route\.ts$/, category: "api-routes", lastMtime: 0 },
  { path: path.join(AGENT_DIR, "src", "components"), pattern: /\.tsx$/, category: "components", lastMtime: 0 },
  { path: path.join(AGENT_DIR, "src", "lib"), pattern: /\.ts$/, category: "lib", lastMtime: 0 },
  { path: path.join(AGENT_DIR, "src", "context"), pattern: /\.tsx$/, category: "context", lastMtime: 0 },
  { path: path.join(AGENT_DIR, "src", "hooks"), pattern: /\.ts$/, category: "hooks", lastMtime: 0 },
];

// Process/memory ceiling thresholds
const PROCESS_CPU_CEILING = 80;    // percent
const PROCESS_MEM_CEILING = 500;   // MB
const SCORE_DEGRADATION_THRESHOLD = -0.10; // 10% drop triggers alert

// ─── State ─────────────────────────────────────────────────────────

let watchers: FSWatcher[] = [];
let eventQueue: ChronoEvent[] = [];
let scoreHistory: Record<string, number> = {};
let isRunning = false;

// ─── Helpers ───────────────────────────────────────────────────────

function ensureLogDir() {
  const dir = path.dirname(CHRONO_LOG);
  if (!existsSync(dir)) execSync(`mkdir -p "${dir}"`);
}

function logEvent(msg: string) {
  ensureLogDir();
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { appendFileSync(CHRONO_LOG, line); } catch { /* non-critical */ }
}

function loadScoreHistory(): Record<string, number> {
  if (existsSync(SCORE_HISTORY)) {
    try { return JSON.parse(readFileSync(SCORE_HISTORY, "utf8")); } catch { /* ignore */ }
  }
  return {};
}

function saveScoreHistory(history: Record<string, number>) {
  try { writeFileSync(SCORE_HISTORY, JSON.stringify(history, null, 2)); } catch { /* non-critical */ }
}

// ─── Event handlers ────────────────────────────────────────────────

function onFileChange(event: ChronoEvent) {
  logEvent(`FILE_CHANGE: ${event.source} (${event.details["category"]})`);

  // Trigger regression test against Gold Standard
  const category = event.details["category"] as string;
  const filePath = event.source;

  // Find matching gold standard
  const goldDir = path.join(GOLD_STANDARD_DIR, category);
  if (!existsSync(goldDir)) {
    logEvent(`  No gold standard for category: ${category}`);
    return;
  }

  // Run eval against the modified file
  const result = runRegression(filePath, category);
  if (result) {
    const previousScore = scoreHistory[result.testId] ?? result.currentScore;
    const delta = result.currentScore - previousScore;

    scoreHistory[result.testId] = result.currentScore;
    saveScoreHistory(scoreHistory);

    if (delta <= SCORE_DEGRADATION_THRESHOLD) {
      const alert: ChronoAlert = {
        severity: "critical",
        event,
        regression: result,
        message: `Score degraded by ${Math.abs(delta).toFixed(2)} on ${path.basename(filePath)}. ` +
          `Previous: ${previousScore.toFixed(2)} → Current: ${result.currentScore.toFixed(2)}`,
        requiresApproval: true,
      };
      emitAlert(alert);
    } else if (delta > 0) {
      logEvent(`  Score improved: ${previousScore.toFixed(2)} → ${result.currentScore.toFixed(2)} (+${delta.toFixed(2)})`);
    }
  }
}

function onProcessLimit(event: ChronoEvent) {
  logEvent(`PROCESS_LIMIT: ${event.source} — CPU: ${event.details["cpu"]}%, MEM: ${event.details["mem"]}MB`);

  const alert: ChronoAlert = {
    severity: "warning",
    event,
    message: `Process ${event.source} exceeded limits — CPU: ${event.details["cpu"]}%, MEM: ${event.details["mem"]}MB`,
    requiresApproval: false,
  };
  emitAlert(alert);
}

function onMemoryCeiling(event: ChronoEvent) {
  logEvent(`MEMORY_CEILING: ${event.source} — ${event.details["usage"]}MB`);

  const alert: ChronoAlert = {
    severity: "critical",
    event,
    message: `Memory ceiling breached: ${event.source} at ${event.details["usage"]}MB`,
    requiresApproval: true,
  };
  emitAlert(alert);
}

function onPortDown(event: ChronoEvent) {
  logEvent(`PORT_DOWN: ${event.source} (port ${event.details["port"]})`);

  const alert: ChronoAlert = {
    severity: "warning",
    event,
    message: `Port ${event.details["port"]} (${event.source}) is down`,
    requiresApproval: false,
  };
  emitAlert(alert);
}

// ─── Regression testing ────────────────────────────────────────────

function runRegression(filePath: string, category: string): RegressionResult | null {
  const goldDir = path.join(GOLD_STANDARD_DIR, category);
  if (!existsSync(goldDir)) return null;

  // Get the most recent gold standard file
  let goldFiles: string[] = [];
  try {
    goldFiles = execSync(`ls -t ${goldDir}/*.md 2>/dev/null`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  } catch { return null; }

  if (goldFiles.length === 0) return null;

  const goldFile = goldFiles[0];
  const testId = `${category}/${path.basename(filePath)}`;

  try {
    const payload = readFileSync(filePath, "utf8");
    const goldContent = readFileSync(goldFile, "utf8");

    // Quick heuristic score (same logic as eval/route.ts)
    const goldLines = new Set(goldContent.split("\n").map((l) => l.trim()).filter(Boolean));
    const payloadLines = payload.split("\n").map((l) => l.trim()).filter(Boolean);
    const overlap = payloadLines.filter((l) => goldLines.has(l)).length;
    const lineScore = goldLines.size > 0 ? Math.min(overlap / Math.min(goldLines.size, 30), 1.0) : 0.5;

    const hasExport = /export\s+/.test(payload);
    const hasTypes = /:\s*(string|number|boolean|Promise|NextResponse)/.test(payload);
    const hasError = /try\s*{|catch\s*\(/.test(payload);
    const hasValidation = /if\s*\(|validate|allowlist|safe/.test(payload);

    const currentScore = Math.round(
      (lineScore * 0.3 +
        (hasExport ? 0.2 : 0) +
        (hasTypes ? 0.2 : 0) +
        (hasError ? 0.15 : 0) +
        (hasValidation ? 0.15 : 0)) * 100
    ) / 100;

    const previousScore = scoreHistory[testId] ?? currentScore;
    const delta = currentScore - previousScore;

    return {
      testId,
      goldStandardRef: path.basename(goldFile),
      previousScore,
      currentScore,
      delta,
      passed: currentScore >= 0.70,
      feedback: delta < 0 ? `Score dropped ${Math.abs(delta).toFixed(2)} from previous run.` : "Score stable or improved.",
    };
  } catch (err) {
    logEvent(`  Regression error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ─── Alert emission ────────────────────────────────────────────────

function emitAlert(alert: ChronoAlert) {
  logEvent(`ALERT [${alert.severity.toUpperCase()}]: ${alert.message}`);

  // Write to pending alerts file for Telegram pickup
  const alertsFile = path.join(os.homedir(), ".openclaw", "workspace", "scripts", "chrono-alerts.json");
  let alerts: ChronoAlert[] = [];
  try {
    if (existsSync(alertsFile)) alerts = JSON.parse(readFileSync(alertsFile, "utf8"));
  } catch { alerts = []; }

  alerts.push(alert);
  // Keep max 50 alerts
  if (alerts.length > 50) alerts = alerts.slice(-50);

  try { writeFileSync(alertsFile, JSON.stringify(alerts, null, 2)); } catch { /* non-critical */ }
}

// ─── File watcher setup ────────────────────────────────────────────

function initWatchers(): FSWatcher[] {
  const active: FSWatcher[] = [];

  for (const wp of WATCHED_PATHS) {
    if (!existsSync(wp.path)) continue;

    try {
      const watcher = watch(wp.path, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        if (!wp.pattern.test(filename)) return;

        const fullPath = path.join(wp.path, filename);
        const chronoEvent: ChronoEvent = {
          type: "file-change",
          source: fullPath,
          timestamp: Date.now(),
          details: { category: wp.category, filename, eventType },
        };

        eventQueue.push(chronoEvent);
        // Debounce: process after 500ms
        setTimeout(() => processEvents(), 500);
      });

      active.push(watcher);
      logEvent(`WATCHER: ${wp.path} (${wp.category})`);
    } catch (err) {
      logEvent(`WATCHER_ERROR: ${wp.path} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return active;
}

function processEvents() {
  while (eventQueue.length > 0) {
    const event = eventQueue.shift()!;
    switch (event.type) {
      case "file-change":
        onFileChange(event);
        break;
      case "process-limit":
        onProcessLimit(event);
        break;
      case "memory-ceiling":
        onMemoryCeiling(event);
        break;
      case "port-down":
        onPortDown(event);
        break;
    }
  }
}

// ─── Process/memory ceiling monitor ────────────────────────────────

function checkProcessCeilings() {
  const processes = [
    { name: "node.*next", label: "Next.js" },
    { name: "hermes", label: "Hermes" },
    { name: "openclaw", label: "OpenClaw" },
  ];

  for (const proc of processes) {
    try {
      const pids = execSync(`pgrep -f "${proc.name}" 2>/dev/null`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
      for (const pid of pids) {
        const pidNum = parseInt(pid, 10);
        if (!pidNum) continue;

        // Check CPU
        const cpuOut = execSync(`ps -o %cpu= -p ${pidNum} 2>/dev/null`, { encoding: "utf8" }).trim();
        const cpu = parseFloat(cpuOut);

        // Check memory (RSS in KB → MB)
        const memOut = execSync(`ps -o rss= -p ${pidNum} 2>/dev/null`, { encoding: "utf8" }).trim();
        const memMB = parseInt(memOut, 10) / 1024;

        if (cpu > PROCESS_CPU_CEILING) {
          eventQueue.push({
            type: "process-limit",
            source: proc.label,
            timestamp: Date.now(),
            details: { cpu: cpu.toFixed(1), mem: memMB.toFixed(0), pid: pidNum },
          });
        }

        if (memMB > PROCESS_MEM_CEILING) {
          eventQueue.push({
            type: "memory-ceiling",
            source: proc.label,
            timestamp: Date.now(),
            details: { usage: memMB.toFixed(0), pid: pidNum },
          });
        }
      }
    } catch { /* process not running */ }
  }

  if (eventQueue.length > 0) processEvents();
}

// ─── Public API ────────────────────────────────────────────────────

export function startChronoEngine(): void {
  if (isRunning) return;
  isRunning = true;

  scoreHistory = loadScoreHistory();
  watchers = initWatchers();

  // Process ceiling check every 30s
  const ceilingInterval = setInterval(() => {
    if (!isRunning) { clearInterval(ceilingInterval); return; }
    checkProcessCeilings();
  }, 30000);

  logEvent("CHRONO_ENGINE: Started — event-driven mode active");
}

export function stopChronoEngine(): void {
  isRunning = false;
  for (const w of watchers) {
    try { w.close(); } catch { /* ignore */ }
  }
  watchers = [];
  logEvent("CHRONO_ENGINE: Stopped");
}

export function getChronoStatus(): { running: boolean; watchers: number; eventsQueued: number; scoreHistory: Record<string, number> } {
  return {
    running: isRunning,
    watchers: watchers.length,
    eventsQueued: eventQueue.length,
    scoreHistory: loadScoreHistory(),
  };
}

export function injectEvent(event: ChronoEvent): void {
  eventQueue.push(event);
  processEvents();
}
