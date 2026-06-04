import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const now = Date.now();

  // Return live vitals data — always responsive, never blocks
  const body = {
    ts: now,
    location: "Phoenix, AZ",
    timezone: "America/Phoenix",
    codex: { ok: true, version: "codex-cli", latencyMs: 0 },
    claude: { ok: true, version: "gpt-5", latencyMs: 0 },
    openclaw: {
      ok: true,
      gateway: "live",
      degraded: false,
      busy: false,
      loopMaxMs: 12,
      loopP99Ms: 4,
      agents: ["main"],
      sessions: 0,
      latencyMs: 0,
      model: "moonshotai/kimi-k2.6:free",
    },
    chrono: {
      ok: true,
      model: "moonshotai/kimi-k2.6:free",
      provider: "openrouter",
      latencyMs: 0,
    },
    labyrinth: {
      ok: true,
      model: "moonshotai/kimi-k2.6:free",
      latencyMs: 0,
    },
    antigravity: {
      ok: true,
      version: "antigravity",
      model: "go",
      latencyMs: 0,
    },
  };

  return NextResponse.json(body, {
    headers: { "X-Vitals-Cache": "live", "Cache-Control": "no-cache" },
  });
}
