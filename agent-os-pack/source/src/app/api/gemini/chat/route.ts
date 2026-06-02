// Deprecated: /api/gemini/chat now proxies to /api/labyrinth/chat
// Labyrinth (Hermes deep reasoning profile) replaces Gemini as the research agent.
import { NextResponse } from "next/server";
import { spawnStream } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { prompt } = await req.json();
  const text = String(prompt ?? "").replace(/\r/g, "").trim();

  if (!text) {
    return NextResponse.json({ error: "missing prompt" }, { status: 400 });
  }

  // Proxy to Hermes Labyrinth profile (deep reasoning engine)
  try {
    const child = spawnStream(
      "hermes",
      ["chat", "-q", text, "--profile", "labyrinth"],
      { extraEnv: { ...process.env, HERMES_PROFILE: "labyrinth" } }
    );

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        let buffer = "";
        child.stdout.on("data", (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim()) {
              controller.enqueue(
                encoder.encode(JSON.stringify({ type: "text", text: line + "\n" }) + "\n")
              );
            }
          }
        });
        child.stderr.on("data", (_chunk: Buffer) => { /* swallow */ });
        child.on("close", (code) => {
          if (buffer.trim()) {
            controller.enqueue(
              encoder.encode(JSON.stringify({ type: "text", text: buffer }) + "\n")
            );
          }
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "done", code: code ?? 0 }) + "\n")
          );
          controller.close();
        });
        child.on("error", (err) => {
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "error", text: String(err) }) + "\n")
          );
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "done", code: 1 }) + "\n")
          );
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Labyrinth stream failed: ${String(err)}` },
      { status: 500 }
    );
  }
}
