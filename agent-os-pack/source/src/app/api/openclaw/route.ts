import { run } from "@/lib/runner";
import { NextResponse } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const COMMANDS: Record<string, string[]> = {
  health: ["health"], doctor: ["doctor"], logs: ["logs"],
  agents: ["agents", "list"], sessions: ["sessions"], status: ["status"],
};
export async function GET(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "health";
  const args = COMMANDS[action] ?? ["health"];
  const out = await run("openclaw", args, { timeoutMs: 10000 });
  return NextResponse.json({ action, ...out });
}
