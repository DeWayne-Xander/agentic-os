import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resolve an approval — called by the frontend when user clicks Allow/Deny
// This endpoint is a proxy that triggers the resolve function on the stored promise
// Since HTTP is stateless, we use a GET query parameter approach from the frontend.

// The actual resolution happens in-memory via the pending map.
// We need a way for the resolve endpoint to signal back. In the dashboard pattern,
// the approve/deny POST hits a separate /api/approval/resolve endpoint that
// sets a flag, and the pending POST polls/waits for it.

// Resolution flags (runId → resolution)
const resolutions = new Map<string, { approved: boolean; mode: string }>();

export async function POST(req: Request) {
  const body = await req.json();
  const { runId, approved, mode } = body;

  if (!runId || typeof approved !== "boolean") {
    return NextResponse.json({ error: "missing runId or approved" }, { status: 400 });
  }

  resolutions.set(runId, { approved, mode: mode || "once" });
  return NextResponse.json({ ok: true, runId, approved, mode });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const runId = url.searchParams.get("runId");
  if (!runId) return NextResponse.json({ error: "missing runId" }, { status: 400});

  const res = resolutions.get(runId);
  if (!res) return NextResponse.json({ pending: true });

  resolutions.delete(runId);
  return NextResponse.json(res);
}
