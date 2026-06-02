import { NextResponse } from "next/server";
import { createGoal, deleteGoal, getGoal, launchGoal, listGoals, readGoalLog, stopGoal, updateGoal } from "@/lib/codexGoals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (id) {
    const goal = await getGoal(id);
    if (!goal) return NextResponse.json({ error: "not found" }, { status: 404 });
    const log = await readGoalLog(id);
    return NextResponse.json({ goal, log });
  }
  const goals = await listGoals();
  return NextResponse.json({ goals });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (String(body.action ?? "") === "stop") {
    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const goal = await stopGoal(id);
    if (!goal) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ goal });
  }
  if (String(body.action ?? "") === "spawn" && String(body.id ?? "")) {
    const id = String(body.id ?? "");
    const goal = await launchGoal(id);
    if (!goal) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ goal }, { status: 200 });
  }
  const title = String(body.title ?? "");
  const prompt = String(body.prompt ?? "");
  const cwd = typeof body.cwd === "string" ? String(body.cwd) : undefined;
  if (!title.trim() || !prompt.trim()) return NextResponse.json({ error: "title and prompt required" }, { status: 400 });
  const goal = await createGoal(title, prompt, cwd);
  const running = await launchGoal(goal.id);
  return NextResponse.json({ goal: running ?? goal }, { status: 201 });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const goal = await updateGoal(id, body);
  if (!goal) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ goal });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ok = await deleteGoal(id);
  return NextResponse.json({ ok });
}
