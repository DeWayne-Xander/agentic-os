import { run } from "@/lib/runner";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ANSI_STRIP =
  /\x1B\[[0-?]*[ -\/]*[@-~]|\x1B\][^\x07\x1B]*(\x07|\x1B\\)|\x1B[@-_]/g;

function cleanText(text: string): string {
  return text.replace(ANSI_STRIP, "").replace(/\r/g, "").trim();
}

function extractReply(stdout: string, stderr: string): string {
  const raw = cleanText(stdout || stderr || "");
  if (!raw) return "(no response)";

  try {
    const parsed = JSON.parse(raw) as {
      payloads?: Array<{ text?: string }>;
      text?: string;
      reply?: string;
      message?: string;
    };
    const reply =
      parsed.payloads?.map((p) => p.text ?? "").filter(Boolean).join("\n").trim() ||
      parsed.text ||
      parsed.reply ||
      parsed.message ||
      "";
    if (reply) return cleanText(reply);
  } catch {
    // fall through to plain text cleanup
  }

  return raw;
}

export async function POST(req: Request) {
  const { prompt } = await req.json();
  const text = String(prompt ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "missing prompt" }, { status: 400 });
  }

  const out = await run(
    "openclaw",
    ["agent", "--local", "--agent", "main", "--message", text, "--thinking", "off", "--json", "--timeout", "30"],
    {}
  );

  return NextResponse.json({
    ok: out.ok,
    text: extractReply(out.stdout, out.stderr),
    stdout: cleanText(out.stdout),
    stderr: cleanText(out.stderr),
    code: out.code,
  });
}
