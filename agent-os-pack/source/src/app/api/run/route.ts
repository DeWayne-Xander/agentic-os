import { NextResponse } from "next/server";
import { run, validateFlagArgs, type AgentName } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED: Partial<Record<AgentName, RegExp[]>> = {
  claude: [/^--version$/, /^--help$/, /^-p$/, /^--output-format=stream-json$/, /^--include-partial-messages$/, /^--verbose$/, /^--print$/, /^--continue$/, /^--effort$/],
  openclaw: [/^health$/, /^doctor$/, /^logs$/, /^memory$/, /^agents$/, /^list$/, /^status$/, /^cron$/, /^channels$/, /^gateway$/, /^chat$/, /^--help$/, /^--version$/],
  hermes: [/^status$/, /^doctor$/, /^sessions$/, /^insights$/, /^kanban$/, /^skills$/, /^plugins$/, /^list$/, /^logs$/, /^memory$/, /^--help$/, /^--version$/],
  labyrinth: [/^status$/, /^sessions$/, /^cron$/, /^skills$/, /^plugins$/, /^memory$/, /^--help$/, /^--version$/, /^chat$/, /^-q$/, /^--profile$/],
  antigravity: [/^--version$/, /^--help$/, /^status$/],
  codex: [/^--version$/, /^--help$/, /^exec$/, /^--json$/, /^--full-auto$/, /^--skip-git-repo-check$/, /^--last$/, /^resume$/, /^review$/, /^--model$/, /^-m$/],
};

function safe(agent: AgentName, args: string[]) {
  const filtered = validateFlagArgs(args);
  if (filtered.length !== args.length) return false;
  const patterns = ALLOWED[agent];
  return patterns ? args.every((a) => patterns.some((re) => re.test(a))) : false;
}

export async function POST(req: Request) {
  const body = await req.json();
  const agent = body.agent as AgentName;
  const args: string[] = Array.isArray(body.args) ? body.args : [];
  if (!safe(agent, args)) return NextResponse.json({ error: "command not allowlisted", agent, args }, { status: 403 });
  const out = await run(agent, args, { timeoutMs: 15000 });
  return NextResponse.json({ agent, args, ...out });
}
