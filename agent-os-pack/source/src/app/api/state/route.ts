import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
  pending?: boolean;
};

type ChatStore = Record<string, Message[]>;

type EngineContext = {
  activeModel: string;
  activeTier: "heavy" | "light";
  sessionId: string;
  startedAt: number;
};

type SharedMissionControlState = {
  tree: ChatStore;
  context: EngineContext | null;
  sessionId: string;
  updatedAt: number;
};

const STATE_FILE = process.env.AGENTIC_OS_STATE_FILE
  ? path.resolve(process.env.AGENTIC_OS_STATE_FILE)
  : path.join(process.cwd(), ".agentic-os", "shared-state.json");

function dedupeMessages(msgs: Message[]): Message[] {
  const seen = new Set<string>();
  const out: Message[] = [];
  for (const msg of msgs ?? []) {
    if (!msg?.id || seen.has(msg.id)) continue;
    seen.add(msg.id);
    out.push(msg);
  }
  return out;
}

function normalizeTree(tree: ChatStore): ChatStore {
  const next: ChatStore = {};
  for (const [agent, msgs] of Object.entries(tree ?? {})) {
    if (Array.isArray(msgs)) next[agent] = dedupeMessages(msgs);
  }
  return next;
}

async function readState(): Promise<SharedMissionControlState> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<SharedMissionControlState>;
    return {
      tree: normalizeTree((parsed.tree ?? {}) as ChatStore),
      context: parsed.context ?? null,
      sessionId: String(parsed.sessionId ?? ""),
      updatedAt: Number(parsed.updatedAt ?? Date.now()),
    };
  } catch {
    return {
      tree: {},
      context: null,
      sessionId: "",
      updatedAt: Date.now(),
    };
  }
}

async function writeState(next: SharedMissionControlState) {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(next, null, 2), "utf8");
}

export async function GET() {
  return NextResponse.json(await readState());
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<SharedMissionControlState>;
  const current = await readState();
  const next: SharedMissionControlState = {
    tree: body.tree ? normalizeTree(body.tree) : current.tree,
    context: body.context !== undefined ? body.context : current.context,
    sessionId: String(body.sessionId ?? current.sessionId ?? ""),
    updatedAt: Date.now(),
  };
  await writeState(next);
  return NextResponse.json(next);
}
