/**
 * Global State Persistence — Kairos Phase 4
 *
 * Manages chat history, conversation tree, and engine context persistence
 * across browser tab switches and page refreshes.
 *
 * Strategy:
 *   - localStorage: Long-term conversation history (survives refresh, reboot)
 *   - sessionStorage: Active stream state, UI state (survives refresh via bfcache)
 *   - In-memory: Real-time streaming text (refreshed from storage on mount)
 *
 * Key design decisions:
 *   1. Every message append writes to both sessionStorage + localStorage
 *   2. Stream recovery entries saved every 5 chunks + on completion
 *   3. Conversation tree indexed by agent for fast lookup
 *   4. Engine context (model tier, route decision) persisted per-session
 */

// ─── Storage keys ──────────────────────────────────────────────────
const CHAT_LS_KEY = "chat:local:global";
const CHAT_SS_KEY = "chat:session";
const CONTEXT_LS_KEY = "engine:context:global";
const CONTEXT_SS_KEY = "engine:context:session";

// ─── Types ─────────────────────────────────────────────────────────
export interface ConversationNode {
  agent: string;
  msgId: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
  /** Engine context at time of this message */
  engineContext?: {
    tier: "heavy" | "light";
    model: string;
  };
}

export interface ConversationTree {
  [agent: string]: ConversationNode[];
}

export interface EngineContext {
  activeModel: string;
  activeTier: "heavy" | "light";
  sessionId: string;
  startedAt: number;
}

export interface SharedMissionControlState {
  tree?: ConversationTree;
  context?: EngineContext | null;
  sessionId?: string;
  updatedAt?: number;
}

// ─── Helpers ───────────────────────────────────────────────────────

function isClient(): boolean {
  return typeof window !== "undefined";
}

function lsGet(key: string): string | null {
  if (!isClient()) return null;
  try { return localStorage.getItem(key); } catch { return null; }
}

function lsSet(key: string, value: string) {
  if (!isClient()) return;
  try { localStorage.setItem(key, value); } catch { /* quota */ }
}

function lsDel(key: string) {
  if (!isClient()) return;
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

function ssGet(key: string): string | null {
  if (!isClient()) return null;
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function ssSet(key: string, value: string) {
  if (!isClient()) return;
  try { sessionStorage.setItem(key, value); } catch { /* quota */ }
}

function ssDel(key: string) {
  if (!isClient()) return;
  try { sessionStorage.removeItem(key); } catch { /* ignore */ }
}

const SHARED_STATE_ENDPOINT = "/api/state";

export async function loadSharedMissionControlState(): Promise<SharedMissionControlState | null> {
  if (!isClient()) return null;
  try {
    const resp = await fetch(SHARED_STATE_ENDPOINT, { cache: "no-store" });
    if (!resp.ok) return null;
    return (await resp.json()) as SharedMissionControlState;
  } catch {
    return null;
  }
}

export async function saveSharedMissionControlState(
  patch: Partial<SharedMissionControlState>
): Promise<SharedMissionControlState | null> {
  if (!isClient()) return null;
  try {
    const resp = await fetch(SHARED_STATE_ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!resp.ok) return null;
    return (await resp.json()) as SharedMissionControlState;
  } catch {
    return null;
  }
}

// ─── Conversation Tree CRUD ────────────────────────────────────────

export function loadConversationTree(): ConversationTree {
  const fromSS = ssGet(CHAT_SS_KEY);
  if (fromSS) {
    try { return JSON.parse(fromSS); } catch { /* fall through */ }
  }
  const fromLS = lsGet(CHAT_LS_KEY);
  if (fromLS) {
    try {
      const parsed = JSON.parse(fromLS);
      // Hydrate sessionStorage from localStorage
      ssSet(CHAT_SS_KEY, fromLS);
      return parsed;
    } catch { /* fall through */ }
  }
  return {};
}

export function saveConversationTree(tree: ConversationTree) {
  const json = JSON.stringify(tree);
  ssSet(CHAT_SS_KEY, json);
  lsSet(CHAT_LS_KEY, json);
}

export function appendConversationNode(node: ConversationNode) {
  const tree = loadConversationTree();
  if (!tree[node.agent]) tree[node.agent] = [];
  // Upsert by msgId
  const idx = tree[node.agent].findIndex((n) => n.msgId === node.msgId);
  if (idx >= 0) tree[node.agent][idx] = node;
  else tree[node.agent].push(node);
  saveConversationTree(tree);
  return tree;
}

export function getConversation(agent: string): ConversationNode[] {
  const tree = loadConversationTree();
  return tree[agent] ?? [];
}

export function clearConversation(agent: string) {
  const tree = loadConversationTree();
  delete tree[agent];
  saveConversationTree(tree);
}

export function getAllAgents(): string[] {
  const tree = loadConversationTree();
  return Object.keys(tree);
}

// ─── Engine Context ────────────────────────────────────────────────

export function saveEngineContext(ctx: EngineContext) {
  const json = JSON.stringify(ctx);
  ssSet(CONTEXT_SS_KEY, json);
  lsSet(CONTEXT_LS_KEY, json);
}

export function loadEngineContext(): EngineContext | null {
  const fromSS = ssGet(CONTEXT_SS_KEY);
  if (fromSS) {
    try { return JSON.parse(fromSS); } catch { /* fall through */ }
  }
  const fromLS = lsGet(CONTEXT_LS_KEY);
  if (fromLS) {
    try {
      const parsed = JSON.parse(fromLS);
      ssSet(CONTEXT_SS_KEY, fromLS);
      return parsed;
    } catch { /* fall through */ }
  }
  return null;
}

export function clearEngineContext() {
  ssDel(CONTEXT_SS_KEY);
  lsDel(CONTEXT_LS_KEY);
}

// ─── Session initialization ────────────────────────────────────────

const SESSION_ID_KEY = "engine:sessionId";

export function getOrCreateSessionId(): string {
  let id = ssGet(SESSION_ID_KEY);
  if (!id) {
    id = lsGet(SESSION_ID_KEY);
  }
  if (!id) {
    id = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
  ssSet(SESSION_ID_KEY, id);
  lsSet(SESSION_ID_KEY, id);
  return id;
}

// ─── Export / Import (for debugging / backup) ──────────────────────

export function exportAllState(): { tree: ConversationTree; context: EngineContext | null; sessionId: string } {
  return {
    tree: loadConversationTree(),
    context: loadEngineContext(),
    sessionId: getOrCreateSessionId(),
  };
}

export function importState(data: { tree?: ConversationTree; context?: EngineContext }) {
  if (data.tree) saveConversationTree(data.tree);
  if (data.context) saveEngineContext(data.context);
}

// ─── Format bridges (ChatMessage[] ↔ ConversationNode[]) ──────────

/** Convert a flat ChatStore (ChatMessage[]) to a ConversationTree (ConversationNode[]) */
export function chatStoreToTree(store: Record<string, Array<{ id: string; role: "user" | "assistant"; text: string; ts: number }>>): ConversationTree {
  const tree: ConversationTree = {};
  for (const [agent, messages] of Object.entries(store)) {
    tree[agent] = messages.map((m) => ({
      agent,
      msgId: m.id,
      role: m.role,
      text: m.text,
      ts: m.ts,
    }));
  }
  return tree;
}

/** Convert a ConversationTree (ConversationNode[]) to a flat ChatStore (ChatMessage[]) */
export function treeToChatStore(tree: ConversationTree): Record<string, Array<{ id: string; role: "user" | "assistant"; text: string; ts: number; pending?: boolean }>> {
  const store: Record<string, Array<{ id: string; role: "user" | "assistant"; text: string; ts: number; pending?: boolean }>> = {};
  for (const [agent, nodes] of Object.entries(tree)) {
    store[agent] = nodes.map((n) => ({
      id: n.msgId,
      role: n.role,
      text: n.text,
      ts: n.ts,
    }));
  }
  return store;
}
