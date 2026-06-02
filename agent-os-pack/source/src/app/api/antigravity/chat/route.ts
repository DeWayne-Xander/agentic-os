import { spawn } from "node:child_process";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Spawns the native Antigravity Go binary and streams its
 * newline-delimited JSON tokens back to the client.
 *
 * Wire format from the Go engine (one JSON object per line):
 *   {"type":"thinking","text":"..."}
 *   {"type":"text","text":"the actual prose..."}
 *   {"type":"done","code":0}
 */
export async function POST(req: Request) {
  const { prompt } = await req.json();
  const safePrompt = String(prompt ?? "").slice(0, 16_000);

  // Resolve the binary path
  const bin =
    process.env.AGENTIC_OS_ANTIGRAVITY_BIN ??
    (config as unknown as Record<string, string | null>).antigravity ??
    "/Users/dewaynexander/.gemini/antigravity-cli/agy";

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      try {
        const child = spawn(bin, ["--prompt", safePrompt], {
          cwd: process.env.HOME ?? "/",
          env: {
            ...process.env,
            NO_COLOR: "1",
            FORCE_COLOR: "0",
          } as NodeJS.ProcessEnv,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stderrBuf = "";
        let lineBuf = "";

        const emitLine = (raw: string) => {
          controller.enqueue(encoder.encode(raw + "\n"));
        };

        // Validate and forward a JSON token, or wrap raw text
        const forwardToken = (trimmed: string) => {
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed.type === "string") {
              emitLine(trimmed);
              return;
            }
          } catch {
            // Not JSON — fall through
          }
          emitLine(JSON.stringify({ type: "text", text: trimmed }));
        };

        let gotDoneFromEngine = false;

        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
          lineBuf += chunk;
          const lines = lineBuf.split("\n");
          lineBuf = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
              // Track if the engine sent its own done token
              try {
                const p = JSON.parse(trimmed);
                if (p && p.type === "done") gotDoneFromEngine = true;
              } catch { /* not JSON */ }
              forwardToken(trimmed);
            }
          }
        });

        child.stderr?.on("data", (d: Buffer) => {
          stderrBuf += d.toString();
        });

        child.on("close", (code) => {
          // Flush remaining partial line
          const trimmed = lineBuf.trim();
          if (trimmed) forwardToken(trimmed);

          if (code !== 0) {
            emitLine(
              JSON.stringify({
                type: "error",
                text: `Engine exited with code ${code}${
                  stderrBuf ? ": " + stderrBuf.slice(0, 200) : ""
                }`,
              })
            );
          }
          // Only emit our own done if the engine didn't send one
          if (!gotDoneFromEngine) {
            emitLine(JSON.stringify({ type: "done", code: code ?? 0 }));
          }
          controller.close();
        });

        child.on("error", (err) => {
          emitLine(
            JSON.stringify({
              type: "error",
              text: `Failed to spawn Antigravity engine: ${err.message}`,
            })
          );
          emitLine(JSON.stringify({ type: "done", code: 1 }));
          controller.close();
        });
      } catch (err) {
        const msg = JSON.stringify({ type: "error", text: String(err) }) + "\n";
        controller.enqueue(encoder.encode(msg));
        controller.enqueue(
          encoder.encode(JSON.stringify({ type: "done", code: 1 }) + "\n")
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "Transfer-Encoding": "chunked",
      "X-Antigravity-Engine": "native-go",
    },
  });
}
