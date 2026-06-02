import { NextResponse } from "next/server";
import { appendMemory } from "@/lib/vaultWriter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telegram → Obsidian bridge.
 *
 * Called by the Hermes Telegram platform adapter (or any external bot)
 * to persist conversation logs into the Obsidian vault.
 *
 * POST body:
 *   message: string   — the user's message
 *   reply:   string   — the bot's response
 *   chat_id: string   — Telegram chat ID (for tagging)
 *   user:    string   — Telegram username (optional)
 *
 * Also writes to Agentic OS/Memories/YYYY-MM-DD.md in the vault.
 */
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "telegram-vault-bridge", usage: "POST {message, reply, chat_id, user}" });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body || (!body.message && !body.reply)) {
    return NextResponse.json({ error: "empty message+reply" }, { status: 400 });
  }

  const { message, reply, chat_id, user } = body;
  const agentLabel = user ? `telegram:${user}` : `telegram:${chat_id || "unknown"}`;

  // Log the exchange
  const res = await appendMemory({
    agent: agentLabel,
    kind: "telegram",
    user: message ? String(message).slice(0, 8000) : undefined,
    reply: reply ? String(reply).slice(0, 16000) : undefined,
    meta: {
      source: "telegram",
      chat_id: String(chat_id || ""),
      platform: "telegram",
      timezone: "America/Phoenix",
    },
  });

  return NextResponse.json({ ok: res.ok, path: res.path });
}
