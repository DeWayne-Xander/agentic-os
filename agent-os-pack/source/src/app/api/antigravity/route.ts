import { NextResponse } from "next/server";
import { run } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMANDS: Record<string, string[]> = {
  status: ["status"],
  doctor: ["status"],
  sessions: ["--version"],
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "status";
  const args = COMMANDS[action];
  if (!args) return NextResponse.json({ error: "unknown action" }, { status: 400 });
  const out = await run("antigravity", args, { timeoutMs: 8000 });
  return NextResponse.json({ action, ...out });
}
