import { NextResponse } from "next/server";
import { appendMemory } from "@/lib/vaultWriter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_AGENTS = new Set([
  "claude", "openclaw", "hermes", "chrono", "labyrinth", "antigravity", "codex",
  "user", "system", "telegram",
]);
const ALLOWED_KINDS = new Set(["chat", "goal", "journal", "note", "telegram"]);

/**
 * Unified memory/vault write endpoint.
 * Called by:
 *  - Web dashboard (UnifiedChat) — source: "web"
 *  - Telegram bot bridge — source: "telegram"
 *  - Hermes cron jobs — source: "cron"
 *
 * All writes go to Agentic OS/Memories/YYYY-MM-DD.md in the Obsidian vault.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const agent = String(body.agent ?? "system");
  const kind = String(body.kind ?? "note");
  const user = body.user ? String(body.user).slice(0, 8000) : undefined;
  const reply = body.reply ? String(body.reply).slice(0, 16000) : undefined;
  const text = body.text ? String(body.text).slice(0, 8000) : undefined;
  const source = String(body.source ?? "web");
  const meta = body.meta ? { source, ...body.meta } : { source };

  if (!ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ error: "bad kind" }, { status: 0 });
  }
  // Accept any agent (including dynamic ones like "telegram:user") as long as kind is valid

  const res = await appendMemory({ agent: agent === "chrono" ? "hermes" : agent, kind, user, reply, text, meta });
  return NextResponse.json(res);
}
