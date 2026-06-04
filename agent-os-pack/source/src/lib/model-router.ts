/**
 * Multi-Model Routing Matrix — Kairos Phase 4
 *
 * Dynamically routes tasks to the optimal model/engine based on request profile.
 *
 * Routing tiers:
 *   HEAVY  → moonshotai/kimi-k2.6:free (complex engineering, deep file analysis, automation)
 *   LIGHT  → moonshotai/kimi-k2.6:free (fast memory queries, UI state, conversational)
 *
 * Classification is done by keyword heuristics on the prompt + agent context.
 * The runner.ts run() function consults this router when no explicit model is set.
 */

export type ModelTier = "heavy" | "light";

export interface RouteDecision {
  tier: ModelTier;
  /** Primary model identifier */
  model: string;
  /** Fallback models in order */
  fallbacks: string[];
  /** Reason for the routing decision (for telemetry) */
  reason: string;
  /** Suggested timeout in ms */
  timeoutMs: number;
}

// ─── Model registry ────────────────────────────────────────────────
// Single platform-wide engine — Kimi K2.6 free tier.
export const PLATFORM_MODEL = "moonshotai/kimi-k2.6:free";
const HEAVY_PRIMARY = PLATFORM_MODEL;
const HEAVY_FALLBACKS = [PLATFORM_MODEL];

// Light / high-speed engines for rapid tasks — Kairos & quick operations
const LIGHT_MODELS: string[] = [PLATFORM_MODEL];

// ─── Classification keywords ────────────────────────────────────────
const HEAVY_KEYWORDS: RegExp[] = [
  /\b(refactor|rewrite|architect|design pattern|deep.?analysis|codebase|migration)\b/i,
  /\b(system\s*(admin|engineering)|infrastructure|daemon|cron|network|firewall)\b/i,
  /\b(debug|diagnose|profile|benchmark|optimize|performance)\b/i,
  /\b(script|automation|pipeline|deploy|build|compile)\b/i,
  /\b(file\s*(system|structure|governance)|filesystem)\b/i,
  /\b(multi.?step|complex|orchestrat|coordinat)\b/i,
  /\b(search.*code|grep.*pattern|regex.*across)\b/i,
];

const LIGHT_KEYWORDS: RegExp[] = [
  /\b(hi|hello|hey|greet|what'?s\s*up|yo)\b/i,
  /\b(status|health|ping|check|uptime)\b/i,
  /\b(remind|note|quick|brief|summary|tl;dr)\b/i,
  /\b(what\s*time|weather|date|today)\b/i,
  /\b(thank|thx|ty|great|nice|cool|awesome)\b/i,
  /\b(yes|no|ok|cancel|stop|abort)\b/i,
];

// ─── Agent-based routing overrides ─────────────────────────────────
// Labyrinth always gets heavy treatment — deep reasoning regardless of prompt
const HEAVY_AGENTS = new Set<string>(["labyrinth", "claude"]);
// Kairos always gets light treatment — fast ops, no deep reasoning needed
const LIGHT_AGENTS = new Set<string>(["openclaw", "kairos"]);

// ─── Main classifier ───────────────────────────────────────────────

export function classifyPrompt(prompt: string, agent?: string): ModelTier {
  // Agent override first
  if (agent && HEAVY_AGENTS.has(agent)) return "heavy";
  if (agent && LIGHT_AGENTS.has(agent)) return "light";

  // Check light keywords first (fast path for trivial inputs)
  for (const re of LIGHT_KEYWORDS) {
    if (re.test(prompt)) return "light";
  }

  // Check heavy keywords
  for (const re of HEAVY_KEYWORDS) {
    if (re.test(prompt)) return "heavy";
  }

  // Default: light for short prompts, heavy for long ones
  const wordCount = prompt.trim().split(/\s+/).length;
  return wordCount > 30 ? "heavy" : "light";
}

// ─── Route resolver ────────────────────────────────────────────────

export function resolveRoute(prompt: string, agent?: string): RouteDecision {
  const tier = classifyPrompt(prompt, agent);

  if (tier === "heavy") {
    return {
      tier: "heavy",
      model: HEAVY_PRIMARY,
      fallbacks: HEAVY_FALLBACKS,
      reason: `heavy: agent=${agent ?? "auto"} | words=${prompt.trim().split(/\s+/).length} | matched heavy keyword set`,
      timeoutMs: 120_000, // 2 min for complex tasks
    };
  }

  return {
    tier: "light",
    model: LIGHT_MODELS[0],
    fallbacks: LIGHT_MODELS.slice(1),
    reason: `light: agent=${agent ?? "auto"} | words=${prompt.trim().split(/\s+/).length} | matched light keyword or short prompt`,
    timeoutMs: 30_000, // 30s for quick responses
  };
}

// ─── ChatContext integration helpers ───────────────────────────────

/**
 * Given a prompt + agent, return the API path to hit.
 * This keeps routing logic centralized so components don't hardcode routes.
 */
export function apiPathForAgent(agent: string): string {
  switch (agent) {
    case "chrono":
      return "/api/hermes/chat";
    case "claude":
      return "/api/claude/chat";
    case "labyrinth":
      return "/api/labyrinth/chat";
    case "openclaw":
      return "/api/openclaw/chat";
    case "codex":
      return "/api/codex/chat";

    default:
      return `/api/${agent}/chat`;
  }
}

/**
 * Model selector for the UI — returns human-readable model name
 */
export function modelDisplayName(tier: ModelTier, model: string): string {
  if (tier === "heavy") return "🌙 Kimi K2.6 (Deep Reasoning)";
  return "⚡ Kimi K2.6 (High-Speed Ops)";
}
