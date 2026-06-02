import { NextResponse } from "next/server";
import { run } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ANSI_STRIP =
  /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\]\d+;[^\x07\x1b]*(\x07|\x1b\\)/g;

const TIMEOUT_MS = 0; // no timeout — deep reasoning runs can take the time they need

export async function POST(req: Request) {
  const { prompt } = await req.json();
  const text = String(prompt ?? "").replace(/\r/g, "").trim();

  if (!text) {
    return NextResponse.json({ error: "missing prompt" }, { status: 400 });
  }

  const IDENTITY_PREFIX =
    "[SYSTEM: You are Labyrinth 🧠 — the deep reasoning and research engine for DeWayne's Agentic OS. " +
    "Stay in character as Labyrinth at all times. " +
    "You handle deep analysis, architecture reviews, debugging, and memory synthesis. " +
    "DeWayne is your operator.]\n\n";

  const out = await run(
    "hermes",
    ["-z", IDENTITY_PREFIX + text, "--yolo", "--accept-hooks"],
    { timeoutMs: TIMEOUT_MS }
  );

  const stdout = out.stdout.replace(ANSI_STRIP, "").trim();
  const stderr = out.stderr.replace(ANSI_STRIP, "").trim();

  let diagnostic: string | null = null;
  if (!stdout) {
    const seconds = (out.durationMs / 1000).toFixed(1);
    const lines: string[] = [];
    lines.push(
      out.durationMs >= TIMEOUT_MS - 2_000
        ? `⏱ Hermes was killed after ${seconds}s — the task likely needed longer than the budget.`
        : `⚠ Hermes finished in ${seconds}s with exit ${out.code} but no stdout.`
    );
    if (stderr) {
      lines.push("");
      lines.push("─── stderr ───");
      lines.push(stderr.length > 4000 ? stderr.slice(-4000) : stderr);
    } else {
      lines.push("");
      lines.push("(no stderr either) — blank output with no error is usually auth/provider config.");
      lines.push("Run `hermes status` and confirm the provider/API key are healthy.");
    }
    diagnostic = lines.join("\n");
  }

  return NextResponse.json({
    ok: out.ok && !!stdout,
    text: stdout || diagnostic || "(no response)",
    empty: !stdout,
    durationMs: out.durationMs,
    exitCode: out.code,
    timedOut: !stdout && out.durationMs >= TIMEOUT_MS - 2_000,
    stderr,
  });
}
