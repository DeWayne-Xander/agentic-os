import dns from "node:dns";
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnStream } from "@/lib/runner";

dns.setDefaultResultOrder("ipv4first");

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Codex chat route — OpenAI subscription via ChatGPT OAuth.
 *
 * Preference order:
 *   1. ~/.codex/auth.json  (ChatGPT OAuth — access_token)
 *   2. Fallback: spawn `codex` CLI via runner
 *
 * Route path stays /api/claude/chat for frontend compat.
 */

interface CodexAuth {
  auth_mode: string;
  OPENAI_API_KEY?: string | null;
  tokens?: {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
}

function readCodexAuth(): CodexAuth | null {
  try {
    const p = path.join(os.homedir(), ".codex", "auth.json");
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw) as CodexAuth;
  } catch {
    return null;
  }
}

function makeNdjson(obj: unknown): string {
  return JSON.stringify(obj) + "\n";
}

function readOwlAlphaContext() {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const adminTelegramId = process.env.ADMIN_TELEGRAM_ID ?? "";
  const soulConfigPath = process.env.SOUL_CONFIG ?? "";
  const framework = process.env.OWL_ALPHA_FRAMEWORK ?? "Owl Alpha";
  return {
    telegramConfigured: telegramBotToken.length > 0,
    adminTelegramId,
    soulConfigPath,
    framework,
  };
}

export async function POST(req: Request) {
  const { prompt, ultracode } = await req.json();
  const safePrompt = String(prompt ?? "").slice(0, 8000);
  const auth = readCodexAuth();
  const owlAlpha = readOwlAlphaContext();

  // ── Strategy 1: OpenAI direct API call with OAuth access_token ──
  if (auth?.tokens?.access_token && auth.tokens.access_token.length > 10) {
    const model = "gpt-5.4-mini";
    const effort = ultracode ? "xhigh" : "medium";

    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content: safePrompt }],
      stream: true,
    };

    // Keep reasoning_effort out of the chat/completions payload for the lean tier.

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const r = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Authorization": "Bearer " + auth!.tokens!.access_token,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(600_000),
          });

          if (!r.ok) {
            const errText = await r.text();
            const errMsg = makeNdjson({
              type: "error",
              message: "OpenAI API " + r.status + ": " + errText.slice(0, 200),
            });
            controller.enqueue(encoder.encode(errMsg));
            controller.close();
            return;
          }

          if (!r.body) {
            controller.enqueue(
              encoder.encode(makeNdjson({ type: "error", message: "no response body" }))
            );
            controller.close();
            return;
          }

          const reader = r.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.trim()) continue;
              const data = line.startsWith("data: ") ? line.slice(6) : line;
              if (data === "[DONE]") {
                controller.enqueue(encoder.encode(makeNdjson({ type: "done", code: 0 })));
                controller.close();
                return;
              }
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta?.content;
                if (typeof delta === "string" && delta.length > 0) {
                  controller.enqueue(
                    encoder.encode(
                      makeNdjson({
                        type: "stream_event",
                        event: { delta: { text: delta } },
                      })
                    )
                  );
                }
              } catch {
                // skip non-JSON lines
              }
            }
          }

          controller.enqueue(encoder.encode(makeNdjson({ type: "done", code: 0 })));
          controller.close();
        } catch (e) {
          controller.enqueue(
            encoder.encode(makeNdjson({ type: "error", message: String(e) }))
          );
          controller.close();
        }
      },
      cancel() {
        // fetch is atomic — consumer cancelled
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Codex-Engine": "openai-subscription",
        "X-Owl-Alpha-Framework": owlAlpha.framework,
        "X-Owl-Alpha-Configured": owlAlpha.telegramConfigured ? "true" : "false",
      },
    });
  }

  // ── Strategy 2: Fallback — spawn `codex` CLI via runner ──
  const args = ["-p", "--output-format=stream-json", "--include-partial-messages", "--verbose"];
  if (ultracode) args.push("--effort", "xhigh");
  const child = spawnStream("codex", args, { input: safePrompt });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      child.stdout.on("data", (b: Buffer) => controller.enqueue(encoder.encode(b.toString())));
      child.stderr.on("data", (b: Buffer) =>
        controller.enqueue(
          encoder.encode(makeNdjson({ type: "stderr", text: b.toString() }))
        )
      );
      child.on("close", (code) => {
        controller.enqueue(encoder.encode(makeNdjson({ type: "done", code })));
        controller.close();
      });
      child.on("error", (e) => {
        controller.enqueue(
          encoder.encode(makeNdjson({ type: "error", message: String(e) }))
        );
        controller.close();
      });
    },
    cancel() {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Codex-Engine": "codex-cli-fallback",
      "X-Owl-Alpha-Framework": owlAlpha.framework,
      "X-Owl-Alpha-Configured": owlAlpha.telegramConfigured ? "true" : "false",
    },
  });
}
