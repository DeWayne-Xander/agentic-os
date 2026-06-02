import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { assigneesFor, listBoards, statsFor } from "@/lib/kanbanDb";

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
      agents: [],
      board: null,
      stats: {},
    }, { status: 200 });
  }

  try {
    const boards = listBoards();
    const activeSlug = slug ?? boards.find((b) => b.current)?.slug ?? "default";
    const agents = assigneesFor(activeSlug).map((a) => ({
      name: a.name,
      on_disk: a.on_disk,
      counts: a.counts,
      active: Object.values(a.counts).some((n) => n > 0),
    }));

    return NextResponse.json({
      ok: true,
      board: activeSlug,
      agents,
      stats: statsFor(activeSlug),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      reason: "agents-route-failed",
      error: String(error),
      agents: [],
      board: null,
      stats: {},
    }, { status: 200 });
  }
}
