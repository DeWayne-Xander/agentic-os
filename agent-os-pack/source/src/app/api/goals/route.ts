import { NextResponse } from "next/server";
import { readGoals, writeGoals, type Goal } from "@/lib/vaultWriter";
import { run } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function inferAssignee(goal: Goal): string {
  const hay = `${goal.text} ${goal.category ?? ""}`.toLowerCase();
  if (/(research|researching|analy[sz]e|study|review|summar|summari[sz]e|deep reasoning|investigat|architecture|design|plan|memory|notebook)/.test(hay)) return "labyrinth";
  if (/(telegram|schedule|notify|monitor|runtime|daemon|health|ops|cron|gateway|session|status|orchestr|triage)/.test(hay)) return "chrono";
  if (/(code|build|fix|refactor|implement|debug|ui|frontend|backend|api|next|typescript|workspace)/.test(hay)) return "codex";
  return "chrono";
}

async function mirrorToKanban(goal: Goal): Promise<Goal> {
  const taskId = `goal_${goal.id}`;
  const assignee = inferAssignee(goal);
  const body = [
    `Mirrored from Goals.md`,
    `Goal ID: ${goal.id}`,
    `Goal text: ${goal.text}`,
    goal.category ? `Category: ${goal.category}` : null,
    `This task should be triaged and delegated automatically.`,
  ].filter(Boolean).join("\n");

  try {
    const created = await run("hermes", [
      "kanban",
      "create",
      goal.text.slice(0, 160),
      "--json",
      "--triage",
      "--assignee",
      assignee,
      "--body",
      body.slice(0, 8000),
    ], { timeoutMs: 30_000 });
    void created;
    try {
      await run("hermes", ["kanban", "dispatch", "--max", "10", "--json"], { timeoutMs: 30_000 });
    } catch {
      // Best-effort delegation; the goal still exists even if dispatch is busy.
    }
  } catch {
    // If Hermes isn't ready, we still keep the goal in Obsidian.
  }

  return {
    ...goal,
    taskId,
    assignee,
    delegatedAt: new Date().toISOString(),
  };
}

function newId(): string { return Math.random().toString(36).slice(2, 10); }

export async function GET() {
  const goals = await readGoals();
  return NextResponse.json({ goals });
}

export async function POST(req: Request) {
  const body = await req.json();
  const text = String(body.text ?? "").slice(0, 500).trim();
  const category = body.category ? String(body.category).slice(0, 30).trim() : undefined;
  if (!text) return NextResponse.json({ error: "empty text" }, { status: 400 });
  const goals = await readGoals();
  const goal: Goal = {
    id: newId(),
    text, category,
    done: false,
    createdAt: new Date().toISOString(),
  };
  goals.unshift(goal);
  const mirrored = await mirrorToKanban(goal);
  goals[0] = mirrored;
  await writeGoals(goals);
  return NextResponse.json({ goal: mirrored, total: goals.length });
}

export async function PATCH(req: Request) {
  const body = await req.json();
  const id = String(body.id ?? "");
  const goals = await readGoals();
  const g = goals.find((x) => x.id === id);
  if (!g) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (typeof body.done === "boolean") g.done = body.done;
  if (typeof body.text === "string" && body.text.trim()) g.text = body.text.slice(0, 500).trim();
  if (typeof body.category === "string") g.category = body.category.slice(0, 30).trim() || undefined;
  if (body.done === true && g.taskId && !g.taskId.startsWith("goal_")) {
    try {
      await run("hermes", [
        "kanban",
        "complete",
        g.taskId,
        "--result",
        "Completed from Goals page",
      ], { timeoutMs: 30_000 });
    } catch {
      // Keep the goal update even if kanban is temporarily unavailable.
    }
  }
  await writeGoals(goals);
  return NextResponse.json({ goal: g });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const goals = await readGoals();
  const next = goals.filter((g) => g.id !== id);
  await writeGoals(next);
  return NextResponse.json({ ok: true, total: next.length });
}
