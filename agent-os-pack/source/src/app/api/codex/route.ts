import { NextResponse } from "next/server";
import { listGoals } from "@/lib/codexGoals";
import { listProjects } from "@/lib/codexWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "status";

  if (action === "status") {
    const [goals, projects] = await Promise.all([listGoals(), listProjects()]);
    return NextResponse.json({
      action,
      ok: true,
      goals: goals.length,
      projects: projects.length,
      running: goals.filter((g) => g.status === "running").length,
    });
  }

  if (action === "workspace") {
    const projects = await listProjects();
    return NextResponse.json({
      action,
      ok: true,
      projects: projects.length,
      roots: projects.map((p) => p.root),
    });
  }

  if (action === "goals") {
    const goals = await listGoals();
    return NextResponse.json({
      action,
      ok: true,
      goals: goals.length,
      running: goals.filter((g) => g.status === "running").length,
    });
  }

  if (action === "sessions") {
    return NextResponse.json({
      action,
      ok: true,
      sessions: "tracked in ~/.codex/session_index.jsonl",
    });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
