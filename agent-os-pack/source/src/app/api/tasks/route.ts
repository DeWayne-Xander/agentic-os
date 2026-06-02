import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { assigneesFor, listBoards, listTasks, statsFor } from "@/lib/kanbanDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const board = url.searchParams.get("board") ?? undefined;
  const slug = board && /^[a-z0-9_-]{1,64}$/.test(board) ? board : undefined;

  if (!config.hermes) {
    return NextResponse.json({
      ok: false,
      reason: "hermes-not-configured",
      tasks: [],
      boards: [],
      stats: {},
      assignees: [],
    }, { status: 200 });
  }

  try {
    const boards = listBoards();
    const activeSlug = slug ?? boards.find((b) => b.current)?.slug ?? "default";
    return NextResponse.json({
      ok: true,
      board: activeSlug,
      boards: boards.map(({ slug, name, current }) => ({ slug, name, current })),
      tasks: listTasks(activeSlug, true),
      stats: statsFor(activeSlug),
      assignees: assigneesFor(activeSlug),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      reason: "tasks-route-failed",
      error: String(error),
      tasks: [],
      boards: [],
      stats: {},
      assignees: [],
    }, { status: 200 });
  }
}
