import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pending approvals store (in-memory, per-server-instance)
// In production this would be Redis/DB, but for a single-user dashboard
// in-memory is sufficient and avoids external dependencies.
const pendingApprovals = new Map<string, {
  runId: string;
  reason: string;
  agent: string;
  args: string;
  cwd: string;
  ts: number;
  resolve: (approved: boolean) => void;
}>();

// Max pending approvals to prevent memory leak
const MAX_PENDING = 50;

export async function POST(req: Request) {
  const body = await req.json();
  const { runId, reason, agent, args, cwd } = body;

  if (!runId) {
    return NextResponse.json({ error: "missing runId" }, { status: 400 });
  }

  // Evict oldest if over limit
  if (pendingApprovals.size >= MAX_PENDING) {
    const oldest = pendingApprovals.keys().next().value;
    if (oldest) {
      const old = pendingApprovals.get(oldest);
      old?.resolve(false); // auto-deny oldest
      pendingApprovals.delete(oldest);
    }
  }

  // Create a promise that resolves when the user approves/denies
  let resolveFn: (approved: boolean) => void;
  const promise = new Promise<boolean>((resolve) => { resolveFn = resolve; });

  pendingApprovals.set(runId, {
    runId,
    reason: reason || "execute_code script execution",
    agent: agent || "unknown",
    args: JSON.stringify(args || []),
    cwd: cwd || process.env.HOME || "/",
    ts: Date.now(),
    resolve: resolveFn!,
  });

  const approved = await promise;

  pendingApprovals.delete(runId);
  return NextResponse.json({ approved });
}

export async function GET() {
  // List pending approvals (for polling from frontend)
  const pending = Array.from(pendingApprovals.values()).map((a) => ({
    runId: a.runId,
    reason: a.reason,
    agent: a.agent,
    args: a.args,
    cwd: a.cwd,
    ts: a.ts,
  }));
  return NextResponse.json({ pending });
}
