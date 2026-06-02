import { spawnStream } from "@/lib/runner";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const { prompt } = await req.json();
  const codexPrompt = [
    "You are Asta, the Codex-native engineering execution layer for Agentic OS.",
    "Respond as a working agent, not a greeting assistant.",
    "Use concise, direct, action-oriented language.",
    "If the request is a task, perform the task mentally and then answer with the result or the next concrete step.",
    "",
    String(prompt ?? "").trim(),
  ].join("\n");
  const child = spawnStream(
    "codex",
    ["exec", "--model", "gpt-5.4-mini", "--json", "--sandbox", "workspace-write", "--skip-git-repo-check"],
    { input: codexPrompt, cwd: process.cwd() }
  );
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      child.stdout.on("data", (b: Buffer) => controller.enqueue(encoder.encode(b.toString())));
      child.stderr.on("data", (b: Buffer) => controller.enqueue(encoder.encode(JSON.stringify({ type: "stderr", text: b.toString() }) + "\n")));
      child.on("close", (code) => { controller.enqueue(encoder.encode(JSON.stringify({ type: "done", code }) + "\n")); controller.close(); });
      child.on("error", (e) => { controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message: String(e) }) + "\n")); controller.close(); });
    },
    cancel() { try { child.kill("SIGTERM"); } catch {} },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
