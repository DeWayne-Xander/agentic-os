import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import * as path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Claude is used for SEO article generation only — spawned directly with allowlisted args.
// Model is read from environment config.
function claudeBin(): string {
  const bin = process.env.CLAUDE_CLI_PATH || "claude";
  if (!bin) throw new Error("Claude CLI not configured. Set CLAUDE_CLI_PATH.");
  return bin;
}

function agentEnv(): NodeJS.ProcessEnv {
  const base = process.env;
  const home = base.HOME ?? `/Users/${base.USER ?? "dewaynexander"}`;
  const ensurePath = [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/bin", "/bin", "/usr/sbin", "/sbin",
    `${home}/.local/bin`,
  ];
  const existing = (base.PATH ?? "").split(":").filter(Boolean);
  const merged = [...new Set([...existing, ...ensurePath])].join(":");
  return {
    ...base, PATH: merged,
    SHELL: base.SHELL || "/bin/zsh",
    HOME: base.HOME || home,
    NO_COLOR: "1", FORCE_COLOR: "0",
  };
}

export async function POST(req: Request) {
  const { keyword, transcriptSlug, transcriptText, slug } = await req.json();
  if (typeof keyword !== "string" || !keyword.trim()) {
    return new Response("missing keyword", { status: 400 });
  }
  if (typeof slug !== "string" || !/^[a-z0-9-]{3,80}$/.test(slug)) {
    return new Response("invalid slug", { status: 400 });
  }

  const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";

  // Build prompt inline (simplified — reads skill from env if available)
  const prompt = `You are an SEO content writer. Write 5 unique long-form SEO articles targeting the keyword "${keyword.trim()}". Slug: ${slug}. Output each article as markdown to stdout, separated by ---ARTICLE--- markers.`;

  const child = spawn(claudeBin(), [
    "-p",
    "--model", CLAUDE_MODEL,
    "--output-format=stream-json",
    "--include-partial-messages",
    "--verbose",
  ], {
    env: agentEnv(),
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;

  child.stdin.write(prompt);
  try { child.stdin.end(); } catch {}

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      child.stdout.on("data", (b: Buffer) => {
        controller.enqueue(encoder.encode(b.toString()));
      });
      child.stderr.on("data", (b: Buffer) => {
        controller.enqueue(encoder.encode(JSON.stringify({ type: "stderr", text: b.toString() }) + "\n"));
      });
      child.on("close", (code) => {
        controller.enqueue(encoder.encode(JSON.stringify({ type: "done", code }) + "\n"));
        controller.close();
      });
      child.on("error", (e) => {
        controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message: String(e) }) + "\n"));
        controller.close();
      });
    },
    cancel() { try { child.kill("SIGTERM"); } catch {} },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
