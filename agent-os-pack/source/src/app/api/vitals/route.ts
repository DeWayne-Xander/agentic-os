import { NextResponse } from "next/server";
import { run } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 5000;
let cached: { ts: number; body: unknown } | null = null;

async function computeVitals() {
  const [codex, openclaw, hermes, labyrinth, antigravity] = await Promise.all([
    run("codex", ["--version"], { timeoutMs: 6000 }),
    run("openclaw", ["health"], { timeoutMs: 6000 }),
    run("hermes", ["status"], { timeoutMs: 8000 }),
    run("labyrinth", ["--version"], { timeoutMs: 6000 }),
    run("antigravity", ["--version"], { timeoutMs: 6000 }),
  ]);
  return { codex, openclaw, hermes, labyrinth, antigravity };
}

export async function GET() {
  const now = Date.now();
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(cached.body, { headers: { "X-Vitals-Cache": "hit" } });
  }
  const { codex, openclaw, hermes, labyrinth, antigravity } = await computeVitals();

  const body = {
    ts: now,
    location: "Phoenix, AZ",
    timezone: "America/Phoenix",
    codex: { ok: codex.ok, version: codex.stdout.trim() || codex.stderr.trim(), latencyMs: codex.durationMs },
    claude: { ok: codex.ok, version: codex.stdout.trim() || codex.stderr.trim(), latencyMs: codex.durationMs },
    openclaw: (() => {
      const max = Number((openclaw.stdout.match(/max=(\d+)ms/) ?? [])[1] ?? 0);
      const p99 = Number((openclaw.stdout.match(/p99=(\d+)ms/) ?? [])[1] ?? 0);
      const reportedDegraded = /degraded/.test(openclaw.stdout);
      const trulyDegraded = reportedDegraded && (max > 100 || p99 > 50);
      const ocAgents = (() => { const m = openclaw.stdout.match(/Agents:\s*(.*)/); return m ? m[1].split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean) : []; })();
      return { ok: openclaw.ok, gateway: /Gateway event loop:/.test(openclaw.stdout) ? "live" : "down", degraded: trulyDegraded, busy: reportedDegraded && !trulyDegraded, loopMaxMs: max, loopP99Ms: p99, agents: ocAgents, sessions: Number((openclaw.stdout.match(/\((\d+)\s+entries\)/) ?? [])[1] ?? 0), latencyMs: openclaw.durationMs };
    })(),
    chrono: { ok: hermes.ok, model: (hermes.stdout.match(/Model:\s+(\S+)/) ?? [])[1] ?? "unknown", provider: (hermes.stdout.match(/Provider:\s+([^\n]+)/) ?? [])[1]?.trim() ?? "unknown", latencyMs: hermes.durationMs },
    labyrinth: { ok: labyrinth.ok, model: "openrouter/owl-alpha", latencyMs: labyrinth.durationMs },
    antigravity: { ok: antigravity.ok, version: antigravity.stdout.trim() || antigravity.stderr.trim(), latencyMs: antigravity.durationMs },
  };
  cached = { ts: now, body };
  return NextResponse.json(body, { headers: { "X-Vitals-Cache": "miss" } });
}
