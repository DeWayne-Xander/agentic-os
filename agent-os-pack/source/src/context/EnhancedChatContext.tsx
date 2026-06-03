"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { logChatTurn } from "@/lib/chatMemory";
import {
  loadConversationTree,
  saveConversationTree,
  appendConversationNode,
  getConversation,
  clearConversation,
  saveEngineContext,
  loadEngineContext,
  getOrCreateSessionId,
  loadSharedMissionControlState,
  saveSharedMissionControlState,
  type ConversationNode,
  type EngineContext,
} from "@/lib/state-manager";
import {
  classifyPrompt,
  resolveRoute,
  apiPathForAgent,
  type ModelTier,
  type RouteDecision,
} from "@/lib/model-router";
import { useChatContext, type ChatMessage } from "@/context/ChatContext";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface EnhancedStreamMetrics {
  startedAt: number;
  bytesReceived: number;
  chunks: number;
  lastChunkAt: number;
  wordsPerMinute: number;
  route: RouteDecision | null;
}

interface EnhancedStreamHandle {
  agent: string;
  controller: AbortController;
  msgId: string;
  text: string;
  listeners: Set<(chunk: string, done: boolean, metrics: EnhancedStreamMetrics) => void>;
  alive: boolean;
  metrics: EnhancedStreamMetrics;
}

interface EnhancedChatContextValue {
  // ── Enhanced streaming with routing ──
  startEnhancedStream: (agent: string, userText: string) => string | null;
  onEnhancedChunk: (agent: string, cb: (chunk: string, done: boolean, metrics: EnhancedStreamMetrics) => void) => () => void;
  getEnhancedMetrics: (agent: string) => EnhancedStreamMetrics | null;
  getEnhancedRoute: (agent: string) => RouteDecision | null;
  abortEnhancedStream: (agent: string) => void;

  // ── Persisted conversation ──
  getPersistedChat: (agent: string) => ConversationNode[];
  appendPersistedNode: (node: ConversationNode) => void;
  clearPersistedChat: (agent: string) => void;

  // ── Engine context ──
  engineContext: EngineContext | null;
  setEngineContext: (ctx: EngineContext) => void;

  // ── Model routing ──
  classifyPrompt: (prompt: string, agent?: string) => ModelTier;
  resolveRoute: (prompt: string, agent?: string) => RouteDecision;

  // ── Legacy passthrough ──
  legacy: ReturnType<typeof useChatContext>;
}

const EnhancedChatContext = createContext<EnhancedChatContextValue>({
  startEnhancedStream: () => null,
  onEnhancedChunk: () => () => {},
  getEnhancedMetrics: () => null,
  getEnhancedRoute: () => null,
  abortEnhancedStream: () => {},
  getPersistedChat: () => [],
  appendPersistedNode: () => {},
  clearPersistedChat: () => {},
  engineContext: null,
  setEngineContext: () => {},
  classifyPrompt: () => "light",
  resolveRoute: () => ({ tier: "light", model: "openrouter/owl-alpha", fallbacks: [], reason: "default", timeoutMs: 30000 }),
  legacy: {} as ReturnType<typeof useChatContext>,
});

export function useEnhancedChat() {
  return useContext(EnhancedChatContext);
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function EnhancedChatProvider({ children }: { children: ReactNode }) {
  const legacy = useChatContext();
  const [, setTick] = useState(0);
  const streamsRef = useRef<Map<string, EnhancedStreamHandle>>(new Map());
  const [engineCtx, setEngineCtxState] = useState<EngineContext | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Initialize engine context
  useEffect(() => {
    let alive = true;
    const hydrate = async () => {
      const shared = await loadSharedMissionControlState();
      const remoteCtx = shared?.context ?? null;
      if (remoteCtx) {
        saveEngineContext(remoteCtx);
        if (alive) setEngineCtxState(remoteCtx);
      } else {
        const ctx = loadEngineContext();
        if (ctx) {
          if (alive) setEngineCtxState(ctx);
        } else {
          const fresh: EngineContext = {
            activeModel: "openrouter/owl-alpha",
            activeTier: "heavy",
            sessionId: getOrCreateSessionId(),
            startedAt: Date.now(),
          };
          saveEngineContext(fresh);
          void saveSharedMissionControlState({ context: fresh, sessionId: fresh.sessionId });
          if (alive) setEngineCtxState(fresh);
        }
      }
      if (alive) setHydrated(true);
    };

    void hydrate();

    const syncTimer = window.setInterval(async () => {
      const shared = await loadSharedMissionControlState();
      if (!alive || !shared) return;

      if (shared.context) {
        const current = loadEngineContext();
        if (JSON.stringify(current) !== JSON.stringify(shared.context)) {
          saveEngineContext(shared.context);
          if (alive) setEngineCtxState(shared.context);
        }
      }

      if (shared.tree) {
        const existingTree = loadConversationTree();
        if (JSON.stringify(existingTree) !== JSON.stringify(shared.tree)) {
          saveConversationTree(shared.tree);
          setTick((t) => t + 1);
        }
      }
    }, 2500);

    return () => {
      alive = false;
      window.clearInterval(syncTimer);
    };
  }, []);

  // ── Sync conversations from legacy ChatContext ──
  useEffect(() => {
    const syncFromLegacy = () => {
      const legacyStore = (legacy as any).storeRef?.current as Record<string, ChatMessage[]> | undefined;
      if (!legacyStore) return;
      const existingTree = loadConversationTree();
      let changed = false;
      for (const [agent, messages] of Object.entries(legacyStore)) {
        if (!existingTree[agent] || existingTree[agent].length < messages.length) {
          existingTree[agent] = messages.map((m) => ({
            agent,
            msgId: m.id,
            role: m.role,
            text: m.text,
            ts: m.ts,
          }));
          changed = true;
        }
      }
      if (changed) saveConversationTree(existingTree);
    };

    const iv = setInterval(syncFromLegacy, 2000);
    return () => clearInterval(iv);
  }, [legacy]);

  // ── Enhanced streaming ──

  const onEnhancedChunk = useCallback(
    (agent: string, cb: (chunk: string, done: boolean, metrics: EnhancedStreamMetrics) => void) => {
      const handle = streamsRef.current.get(agent);
      if (handle) {
        handle.listeners.add(cb);
        if (handle.text) cb(handle.text, false, handle.metrics);
      } else {
        const metrics: EnhancedStreamMetrics = {
          startedAt: 0, bytesReceived: 0, chunks: 0, lastChunkAt: 0,
          wordsPerMinute: 0, route: null,
        };
        streamsRef.current.set(agent, {
          agent,
          controller: new AbortController(),
          msgId: "",
          text: "",
          listeners: new Set([cb]),
          alive: false,
          metrics,
        });
      }
      return () => {
        const h = streamsRef.current.get(agent);
        if (h) h.listeners.delete(cb);
      };
    },
    []
  );

  const getEnhancedMetrics = useCallback((agent: string): EnhancedStreamMetrics | null => {
    return streamsRef.current.get(agent)?.metrics ?? null;
  }, []);

  const getEnhancedRoute = useCallback((agent: string): RouteDecision | null => {
    return streamsRef.current.get(agent)?.metrics.route ?? null;
  }, []);

  const abortEnhancedStream = useCallback((agent: string) => {
    const handle = streamsRef.current.get(agent);
    if (handle) {
      handle.alive = false;
      try { handle.controller.abort(); } catch { /* noop */ }
      handle.listeners.forEach((cb) => {
        try { cb(handle.text, true, handle.metrics); } catch { /* noop */ }
      });
      handle.listeners.clear();
      streamsRef.current.delete(agent);
    }
  }, []);

  const startEnhancedStream = useCallback(
    (agent: string, userText: string): string | null => {
      abortEnhancedStream(agent);

      const msgId = `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const controller = new AbortController();
      const route = resolveRoute(userText, agent);

      // Update engine context with current route
      const ctx: EngineContext = {
        activeModel: route.model,
        activeTier: route.tier,
        sessionId: getOrCreateSessionId(),
        startedAt: Date.now(),
      };
      saveEngineContext(ctx);
      void saveSharedMissionControlState({ context: ctx, sessionId: ctx.sessionId });
      setEngineCtxState(ctx);

      const metrics: EnhancedStreamMetrics = {
        startedAt: Date.now(),
        bytesReceived: 0,
        chunks: 0,
        lastChunkAt: 0,
        wordsPerMinute: 0,
        route,
      };

      const handle: EnhancedStreamHandle = {
        agent, controller, msgId, text: "",
        listeners: new Set(), alive: true, metrics,
      };
      streamsRef.current.set(agent, handle);

      // Persist user message
      appendConversationNode({ agent, msgId: `user_${msgId}`, role: "user", text: userText, ts: Date.now() });
      void saveSharedMissionControlState({ tree: loadConversationTree() });

      // Call legacy startStream so existing API routes still work
      const legacyMsgId = legacy.startStream(agent, userText);

      // Also pump our enhanced stream
      const apiTarget = agent === "chrono" ? "hermes" : agent;
      fetch(`/api/${apiTarget}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Model-Tier": route.tier,
          "X-Model-Id": route.model,
        },
        body: JSON.stringify({ prompt: userText, agent, modelTier: route.tier, model: route.model }),
        signal: controller.signal,
      })
        .then(async (resp) => {
          if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          const pump = async () => {
            if (!handle.alive) return;
            try {
              const { done, value } = await reader.read();
              if (done || !handle.alive) {
                // Finalize
                appendConversationNode({
                  agent, msgId, role: "assistant", text: handle.text, ts: Date.now(),
                  engineContext: { tier: route.tier, model: route.model },
                });
                void saveSharedMissionControlState({ tree: loadConversationTree() });
                void logChatTurn({ agent, user: userText, reply: handle.text, source: "enhanced" });
                handle.listeners.forEach((cb) => {
                  try { cb("", true, handle.metrics); } catch { /* noop */ }
                });
                handle.listeners.clear();
                streamsRef.current.delete(agent);
                setTick((t) => t + 1);
                return;
              }

              const rawChunk = decoder.decode(value, { stream: true });
              let displayChunk = rawChunk;
              let consumed = false;

              try {
                const parsed = JSON.parse(buffer + rawChunk);
                if (parsed && typeof parsed === "object" && typeof parsed.text === "string") {
                  displayChunk = parsed.text; consumed = true;
                }
              } catch {
                try {
                  const parsed = JSON.parse(rawChunk);
                  if (parsed && typeof parsed === "object" && typeof parsed.text === "string") {
                    displayChunk = parsed.text; consumed = true;
                  }
                } catch { /* plain text */ }
              }

              if (!consumed) buffer += rawChunk;
              else buffer = "";

              handle.text += displayChunk;
              handle.metrics.bytesReceived += rawChunk.length;
              handle.metrics.chunks += 1;
              handle.metrics.lastChunkAt = Date.now();

              // Calculate WPM
              const elapsed = (Date.now() - handle.metrics.startedAt) / 60000;
              if (elapsed > 0) {
                const wordCount = handle.text.trim().split(/\s+/).length;
                handle.metrics.wordsPerMinute = Math.round(wordCount / elapsed);
              }

              handle.listeners.forEach((cb) => {
                try { cb(displayChunk, false, handle.metrics); } catch { /* noop */ }
              });

              void pump();
            } catch (readErr) {
              if (handle.alive) {
                handle.listeners.forEach((cb) => {
                  try { cb("", true, handle.metrics); } catch { /* noop */ }
                });
                handle.listeners.clear();
                streamsRef.current.delete(agent);
                setTick((t) => t + 1);
              }
            }
          };

          void pump();
        })
        .catch((err) => {
          if (!handle.alive) return;
          const errMsg = err instanceof Error && err.name === "AbortError"
            ? "[stream aborted]"
            : `[stream error: ${err instanceof Error ? err.message : String(err)}]`;
          handle.text += errMsg;
          handle.listeners.forEach((cb) => {
            try { cb(errMsg, true, handle.metrics); } catch { /* noop */ }
          });
          handle.listeners.clear();
          streamsRef.current.delete(agent);
          setTick((t) => t + 1);
        });

      return msgId;
    },
    [abortEnhancedStream, legacy]
  );

  // ── Persisted conversation wrappers ──
  const getPersistedChat = useCallback((agent: string) => getConversation(agent), []);
  const appendNode = useCallback((node: ConversationNode) => {
    appendConversationNode(node);
    void saveSharedMissionControlState({ tree: loadConversationTree() });
    setTick((t) => t + 1);
  }, []);
  const clearAgent = useCallback((agent: string) => {
    clearConversation(agent);
    legacy.clearChat(agent);
    void saveSharedMissionControlState({ tree: loadConversationTree() });
    setTick((t) => t + 1);
  }, [legacy]);

  const value: EnhancedChatContextValue = {
    startEnhancedStream,
    onEnhancedChunk,
    getEnhancedMetrics,
    getEnhancedRoute,
    abortEnhancedStream,
    getPersistedChat,
    appendPersistedNode: appendNode,
    clearPersistedChat: clearAgent,
    engineContext: engineCtx,
    setEngineContext: setEngineCtxState,
    classifyPrompt,
    resolveRoute,
    legacy,
  };

  return (
    <EnhancedChatContext.Provider value={value}>
      {hydrated ? children : null}
    </EnhancedChatContext.Provider>
  );
}
