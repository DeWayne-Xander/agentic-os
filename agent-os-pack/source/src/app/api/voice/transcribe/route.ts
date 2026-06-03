import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CodexAuth {
  OPENAI_API_KEY?: string | null;
  tokens?: {
    access_token?: string;
  };
}

function readCodexAuth(): CodexAuth | null {
  try {
    const p = path.join(os.homedir(), ".codex", "auth.json");
    return JSON.parse(fs.readFileSync(p, "utf-8")) as CodexAuth;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File)) {
      return Response.json({ error: "Missing audio file" }, { status: 400 });
    }

    const auth = readCodexAuth();
    const bearer = auth?.tokens?.access_token || auth?.OPENAI_API_KEY || "";
    if (!bearer) {
      return Response.json(
        { error: "OpenAI voice transcription is not configured on this machine." },
        { status: 503 }
      );
    }

    const modelCandidates = [
      process.env.OPENAI_TRANSCRIBE_MODEL,
      "whisper-1",
      "gpt-4o-mini-transcribe",
      "gpt-4o-transcribe",
    ].filter((m): m is string => Boolean(m && m.trim()));

    let lastError = "";
    for (const model of modelCandidates) {
      const fd = new FormData();
      fd.append("model", model);
      fd.append("file", audio, audio.name || "voice.webm");

      const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
        },
        body: fd,
      });

      const text = await r.text();
      if (r.ok) {
        let parsed: { text?: string } = {};
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { text };
        }
        return Response.json({ text: String(parsed.text ?? "").trim(), model });
      }

      lastError = `Transcription failed (${r.status}) using ${model}: ${text.slice(0, 240)}`;
    }

    return Response.json({ error: lastError || "Transcription failed" }, { status: 502 });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
