import { NextRequest, NextResponse } from "next/server";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Types ─────────────────────────────────────────────────────────

interface EvalRequest {
  /** The generated payload to evaluate (code, JSON, etc.) */
  payload: string;
  /** Category bucket: api-routes | code-snippets | json-templates */
  category: string;
  /** Specific gold standard file to compare against (optional) */
  reference?: string;
  /** Agent that generated the payload */
  agent?: string;
}

interface EvalScores {
  correctness: number;
  safety: number;
  completeness: number;
  structure: number;
  performance: number;
}

interface EvalResult {
  scores: EvalScores;
  weighted_total: number;
  verdict: "excellent" | "acceptable" | "flawed" | "broken";
  feedback: string;
  reference_used: string;
  threshold: number;
  passed: boolean;
}

// ─── Constants ─────────────────────────────────────────────────────

const THRESHOLD = 0.70;
const GOLD_STANDARD_DIR = path.join(os.homedir(), ".config", "hermes", "vault", "System_Evals", "Gold_Standard");
const EVALS_LOG = path.join(GOLD_STANDARD_DIR, "evals-log.md");

const WEIGHTS: Record<keyof EvalScores, number> = {
  correctness: 0.30,
  safety: 0.25,
  completeness: 0.20,
  structure: 0.15,
  performance: 0.10,
};

const RUBRIC_PATH = path.join(GOLD_STANDARD_DIR, "judge-rubric.md");

// ─── Helpers ───────────────────────────────────────────────────────

function loadRubric(): string {
  if (existsSync(RUBRIC_PATH)) return readFileSync(RUBRIC_PATH, "utf8");
  return "Score 0.0–1.0 on correctness, safety, completeness, structure, performance. Threshold: 0.70.";
}

function loadGoldStandard(category: string, reference?: string): { content: string; filename: string } {
  const dir = path.join(GOLD_STANDARD_DIR, category);
  if (!existsSync(dir)) return { content: "", filename: "none" };

  if (reference) {
    const refPath = path.join(dir, reference);
    if (existsSync(refPath)) {
      return { content: readFileSync(refPath, "utf8"), filename: reference };
    }
  }

  // Pick the most recently modified file in the category
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".ts.md") || f.endsWith(".json.md") || f.endsWith(".md"))
    .filter((f) => f !== "README.md" && f !== "judge-rubric.md" && f !== "evals-log.md")
    .map((f) => ({
      name: f,
      mtime: (() => {
        try {
          return require("node:fs").statSync(path.join(dir, f)).mtimeMs;
        } catch { return 0; }
      })(),
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length === 0) return { content: "", filename: "none" };

  const best = files[0];
  return { content: readFileSync(path.join(dir, best.name), "utf8"), filename: best.name };
}

function scorePayload(goldContent: string, payload: string, rubric: string): EvalResult {
  // ── Heuristic scoring (deterministic pre-flight before LLM judge) ──
  // This provides a fast-path score. The full LLM-as-Judge is called
  // asynchronously via the eval/deep endpoint.

  const scores: EvalScores = {
    correctness: 0.0,
    safety: 0.0,
    completeness: 0.0,
    structure: 0.0,
    performance: 0.0,
  };

  if (!goldContent) {
    // No reference — use structural heuristics only
    const hasExports = /export\s+(default|async|function|const|class)/.test(payload);
    const hasTypes = /:\s*(string|number|boolean|Promise|NextResponse|Request)/.test(payload);
    const hasErrorHandling = /try\s*{|catch\s*\(|throw\s+new|\.catch\(|error\s*=/.test(payload);
    const hasValidation = /if\s*\(|validate|allowlist|safe|check|verify/.test(payload);
    const hasAsync = /async\s+function|await\s+|Promise/.test(payload);
    const hasImports = /^import\s+/m.test(payload);
    const hasReturn = /return\s+/.test(payload);
    const hasComments = /\/\/|\/\*\*|\*/.test(payload);
    const lineCount = payload.split("\n").length;

    scores.correctness = [hasExports, hasTypes, hasReturn, hasAsync].filter(Boolean).length / 4;
    scores.safety = [hasErrorHandling, hasValidation].filter(Boolean).length / 2;
    scores.completeness = [hasErrorHandling, hasReturn, hasTypes, hasComments].filter(Boolean).length / 4;
    scores.structure = [hasImports, hasExports, hasComments, lineCount > 10 && lineCount < 200].filter(Boolean).length / 4;
    scores.performance = [hasAsync, !payload.includes("any"), !payload.includes("var ")].filter(Boolean).length / 3;
  } else {
    // Compare against gold standard
    const goldLines = new Set(goldContent.split("\n").map((l) => l.trim()).filter(Boolean));
    const payloadLines = payload.split("\n").map((l) => l.trim()).filter(Boolean);

    // Line overlap ratio
    const overlap = payloadLines.filter((l) => goldLines.has(l)).length;
    const lineScore = goldLines.size > 0 ? Math.min(overlap / Math.min(goldLines.size, 30), 1.0) : 0.5;

    // Structural similarity
    const goldHasExport = /export\s+/.test(goldContent);
    const payloadHasExport = /export\s+/.test(payload);
    const exportMatch = goldHasExport === payloadHasExport ? 1.0 : 0.3;

    // Safety patterns
    const goldSafety = [/try\s*{/, /catch\s*\(/, /validate|allowlist|safe/].filter((re) => re.test(goldContent)).length;
    const payloadSafety = [/try\s*{/, /catch\s*\(/, /validate|allowlist|safe/].filter((re) => re.test(payload)).length;
    const safetyScore = goldSafety > 0 ? Math.min(payloadSafety / goldSafety, 1.0) : (payloadSafety > 0 ? 0.8 : 0.3);

    // Type safety
    const goldTypes = (goldContent.match(/:\s*\w+/g) || []).length;
    const payloadTypes = (payload.match(/:\s*\w+/g) || []).length;
    const typeScore = goldTypes > 0 ? Math.min(payloadTypes / goldTypes, 1.0) : (payloadTypes > 3 ? 0.7 : 0.3);

    scores.correctness = (lineScore * 0.6 + exportMatch * 0.4);
    scores.safety = safetyScore;
    scores.completeness = (lineScore * 0.5 + typeScore * 0.3 + exportMatch * 0.2);
    scores.structure = (exportMatch * 0.4 + typeScore * 0.3 + lineScore * 0.3);
    scores.performance = payload.includes("async") ? 0.8 : 0.5;
  }

  // Clamp all scores
  for (const key of Object.keys(scores) as (keyof EvalScores)[]) {
    scores[key] = Math.round(Math.min(Math.max(scores[key], 0), 1) * 100) / 100;
  }

  const weighted_total = Math.round(
    (scores.correctness * WEIGHTS.correctness +
      scores.safety * WEIGHTS.safety +
      scores.completeness * WEIGHTS.completeness +
      scores.structure * WEIGHTS.structure +
      scores.performance * WEIGHTS.performance) * 100
  ) / 100;

  const verdict: EvalResult["verdict"] =
    weighted_total >= 0.90 ? "excellent" :
    weighted_total >= 0.70 ? "acceptable" :
    weighted_total >= 0.50 ? "flawed" : "broken";

  const feedback = verdict === "excellent" ? "Gold-standard quality. Consider adding to Gold Standard library." :
    verdict === "acceptable" ? "Passes quality gate. Minor improvements possible." :
    verdict === "flawed" ?
      `Below threshold (${weighted_total.toFixed(2)} < ${THRESHOLD}). ` +
      `Weakest: ${Object.entries(scores).sort(([, a], [, b]) => a - b)[0][0]}. ` +
      `Review against Gold Standard and resubmit.` :
    `Critical quality failure (${weighted_total.toFixed(2)}). Full rewrite required.`;

  return {
    scores,
    weighted_total,
    verdict,
    feedback,
    reference_used: "",
    threshold: THRESHOLD,
    passed: weighted_total >= THRESHOLD,
  };
}

function logEval(result: EvalResult, category: string, agent?: string) {
  const entry = [
    `## Eval — ${new Date().toISOString()}`,
    `- **Agent:** ${agent ?? "unknown"}`,
    `- **Category:** ${category}`,
    `- **Score:** ${result.weighted_total.toFixed(2)}`,
    `- **Verdict:** ${result.verdict}`,
    `- **Passed:** ${result.passed}`,
    `- **Feedback:** ${result.feedback}`,
    "",
  ].join("\n");

  try {
    const existing = existsSync(EVALS_LOG) ? readFileSync(EVALS_LOG, "utf8") : "# Evals Log\n\n";
    // Prepend new entry
    const updated = existing.includes("# Evals Log")
      ? existing.replace("# Evals Log\n\n", `# Evals Log\n\n${entry}`)
      : `${existing}\n${entry}`;
    require("node:fs").writeFileSync(EVALS_LOG, updated);
  } catch { /* non-critical */ }
}

// ─── Route handler ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body: EvalRequest = await req.json();
  const { payload, category, reference, agent } = body;

  if (!payload || !category) {
    return NextResponse.json({ error: "missing payload or category" }, { status: 400 });
  }

  const { content: goldContent, filename: goldFile } = loadGoldStandard(category, reference);
  const rubric = loadRubric();

  const result = scorePayload(goldContent, payload, rubric);
  result.reference_used = goldFile;

  logEval(result, category, agent);

  return NextResponse.json(result);
}

export async function GET() {
  // Return eval system status
  const categories = ["api-routes", "code-snippets", "json-templates"];
  const status: Record<string, number> = {};
  for (const cat of categories) {
    const dir = path.join(GOLD_STANDARD_DIR, cat);
    if (!existsSync(dir)) { status[cat] = 0; continue; }
    status[cat] = readdirSync(dir).filter((f) => !f.startsWith("README") && !f.startsWith("judge") && !f.startsWith("evals")).length;
  }

  return NextResponse.json({
    gold_standard_counts: status,
    threshold: THRESHOLD,
    rubric_loaded: existsSync(RUBRIC_PATH),
    eval_log_exists: existsSync(EVALS_LOG),
  });
}
