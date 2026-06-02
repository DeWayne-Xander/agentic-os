"use client";

export async function logChatTurn(params: {
  agent: string;
  user: string;
  reply: string;
  source?: string;
}) {
  try {
    await fetch("/api/memory/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent: params.agent,
        kind: "chat",
        user: params.user,
        reply: params.reply,
        source: params.source ?? "web",
      }),
    });
  } catch {
    /* ignore vault logging failures */
  }
}
