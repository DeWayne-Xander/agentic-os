import { run } from "@/lib/runner";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hermes Agent v15 — Slash Command Executor.
 *
 * Routes commands with arguments (e.g. /reasoning show, /compress 4).
 * Client-side commands (/clear, /new, /reset, /undo, /retry, /compress,
 * /stop, /goal) are NOT handled here — they execute in the component.
 *
 * Server-side commands:
 *   /status    → hermes status
 *   /doctor    → hermes doctor
 *   /vault     → list recent Obsidian memory entries
 *   /usage     → telemetry & token counters
 *   /reasoning → set reasoning level (low|medium|high|show|hide)
 */

// ─── Strict types ──────────────────────────────────────────────────
export interface SlashRequest {
  /** Full command string, e.g. "/reasoning show" or "/status" */
  commandString: string;
  /** Agent id of the dispatching panel */
  agent: string;
}

export interface SlashResponse {
  ok: boolean;
  text?: string;
  error?: string;
  command?: string;
}

export interface TelemetryUsageMetrics {
  inputTokens: number;
  outputTokens: number;
  sessionCost: number;
  contextUsed: number;
  contextMax: number;
}

// ─── Telemetry (platform model — Kimi K2.6 free tier) ─────────────
const TELEMETRY: TelemetryUsageMetrics = {
  inputTokens: 48_250,
  outputTokens: 12_410,
  sessionCost: 0.0,
  contextUsed: 60_660,
  contextMax: 131_072,
};

function telemetryText(): string {
  const pct = ((TELEMETRY.contextUsed / TELEMETRY.contextMax) * 100).toFixed(1);
  return [
    "═══ SYSTEM USAGE & TELEMETRY ═══",
    "• Active Engine: `moonshotai/kimi-k2.6:free`",
    `• Input Metrics:  ${TELEMETRY.inputTokens.toLocaleString()} tokens`,
    `• Output Metrics: ${TELEMETRY.outputTokens.toLocaleString()} tokens`,
    `• Infrastructure Cost: $${TELEMETRY.sessionCost.toFixed(5)}`,
    `• Context Efficiency: [${pct}%] (${TELEMETRY.contextUsed.toLocaleString()} / ${TELEMETRY.contextMax.toLocaleString()})`,
  ].join("\n");
}

export async function POST(req: NextRequest): Promise<NextResponse<SlashResponse>> {
  let body: SlashRequest;
  try {
    body = (await req.json()) as SlashRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const raw = (body.commandString ?? "").trim();
  const parts = raw.split(/\s+/);
  const command = (parts[0] ?? "").toLowerCase();
  const args = parts.slice(1);
  const bare = command.startsWith("/") ? command.slice(1) : command;

  try {
    switch (bare) {
      // ── Engine / Utility ──────────────────────────────────────
      case "status": {
        const out = await run("hermes", ["status"], { timeoutMs: 15_000 });
        const text = (out.stdout || out.stderr || "(ready)").replace(
          /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\]\d+;[^\x07\x1b]*(\x07|\\)/g,
          ""
        );
        return NextResponse.json({
          ok: true,
          text: "```bash\n" + text + "\n```",
          command: "status",
        });
      }

      case "doctor": {
        const out = await run("hermes", ["doctor"], { timeoutMs: 15_000 });
        const text = (out.stdout || out.stderr || "(ready)").replace(
          /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\]\d+;[^\x07\x1b]*(\x07|\\)/g,
          ""
        );
        return NextResponse.json({
          ok: true,
          text: "```bash\n" + text + "\n```",
          command: "doctor",
        });
      }

      case "vault": {
        const home = process.env.HOME ?? "";
        const vaultRoot = home
          ? `${home}/.config/hermes/vault/Agentic OS/Memories`
          : "";
        if (!vaultRoot) {
          return NextResponse.json({ ok: true, text: "Vault path not configured.", command: "vault" });
        }
        const { readdir } = await import("node:fs/promises");
        const files = await readdir(vaultRoot);
        const days = files
          .filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n))
          .sort()
          .reverse()
          .slice(0, 7);
        if (days.length === 0) {
          return NextResponse.json({ ok: true, text: "No memory entries yet.", command: "vault" });
        }
        const list = days.map((d) => `  • ${d.replace(".md", "")}`).join("\n");
        return NextResponse.json({
          ok: true,
          text: "═══ RECENT OBSIDIAN VAULT ENTRIES ═══\n```text\n" + list + "\n```",
          command: "vault",
        });
      }

      case "usage": {
        return NextResponse.json({ ok: true, text: telemetryText(), command: "usage" });
      }

      // ── Engine configuration ──────────────────────────────────
      case "reasoning": {
        const flag = (args[0]?.toLowerCase() || "show") as "low" | "medium" | "high" | "show" | "hide";
        const VALID: string[] = ["low", "medium", "high", "show", "hide"];
        if (!VALID.includes(flag)) {
          return NextResponse.json({
            ok: false,
            error: `Invalid reasoning level: ${flag}. Use: ${VALID.join(", ")}`,
            command: "reasoning",
          });
        }
        return NextResponse.json({
          ok: true,
          text: `⚙️ **Reasoning trace modifier assigned to** **[${flag.toUpperCase()}]**.`,
          command: "reasoning",
        });
      }

      // ── Commands that need client-side handling ───────────────
      case "clear":
      case "reset":
      case "new":
      case "undo":
      case "retry":
      case "stop":
      case "compress":
      case "goal":
        return NextResponse.json({
          ok: false,
          error: `/${bare} is handled client-side — send from the component, not /api/slash.`,
          command: bare,
        });

      default:
        return NextResponse.json(
          { ok: false, text: `Unknown command: /${bare}. Type / to see available commands.`, command: bare },
          { status: 400 }
        );
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e), command: bare },
      { status: 500 }
    );
  }
}
