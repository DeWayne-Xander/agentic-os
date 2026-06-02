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

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  ts: number;
  pending?: boolean;
}

type ChatStore = Record<string, ChatMessage[]>;

/** Per-agent stream state kept in the global context */
interface StreamHandle {
  agent: string;
  controller: AbortController;
  msgId: string;
  /** All text chunks accumulated so far */
  text: string;
  /** Subscribed listener callbacks that push to UI */
  listeners: Set<(chunk: string, done: boolean) => void>;
  alive: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const SS_AVAILABLE =
  typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";

const LS_AVAILABLE =
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";

const LS_KEY = "chat:local:global";
const SS_KEY = "chat:global";

let idCounter = 0;
function uid(): string {
  idCounter += 1;
  return `m_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function dedupeMessages(msgs: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  const out: ChatMessage[] = [];
  for (const msg of msgs) {
    if (!msg?.id) continue;
    if (seen.has(msg.id)) continue;
    seen.add(msg.id);
    out.push(msg);
  }
  return out;
}

function normalizeStore(store: ChatStore): ChatStore {
  const next: ChatStore = {};
  for (const [key, msgs] of Object.entries(store)) {
    if (Array.isArray(msgs)) next[key] = dedupeMessages(msgs);
  }
  return next;
}

// ─── localStorage helpers (survives reboot, network drop, page refresh) ──

function loadFromLocal(): ChatStore {
  if (!LS_AVAILABLE) return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? normalizeStore(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function saveToLocal(store: ChatStore) {
  if (!LS_AVAILABLE) return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch {
    /* quota */
  }
}

function loadFromSession(): ChatStore {
  if (!SS_AVAILABLE) return {};
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    return raw ? normalizeStore(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function saveToSession(store: ChatStore) {
  if (!SS_AVAILABLE) return;
  try {
    sessionStorage.setItem(SS_KEY, JSON.stringify(store));
  } catch {
    /* quota */
  }
}

/** Merge strategy: localStorage (long-lived) + sessionStorage (hot/tab) */
function loadStore(): ChatStore {
  const legacy = loadFromLocal();
  const hot = loadFromSession();
  // hot session store wins for keys present in both (fresher data)
  const merged = normalizeStore({ ...legacy, ...hot });
  return merged;
}

function saveStore(store: ChatStore) {
  saveToSession(store);
  saveToLocal(store);
}

function emitEvent(name: string) {
  window.dispatchEvent(new CustomEvent(name));
}

/* ------------------------------------------------------------------ */
/*  Context value interface                                            */
/* ------------------------------------------------------------------ */

interface ChatContextValue {
  /* ---------- existing storage API ---------- */
  getChat: (key: string) => ChatMessage[];
  appendMessage: (key: string, msg: ChatMessage) => void;
  clearChat: (key: string) => void;

  /* ---------- streaming API ---------- */
  /** Start streaming from an agent. Returns the placeholder message id. */
  startStream: (agent: string, userText: string) => string | null;
  /** Subscribe to streaming chunks for an agent. Returns an unsubscribe fn. */
  onStreamChunk: (agent: string, cb: (chunk: string, done: boolean) => void) => () => void;
  /** Current streaming message id per agent (empty if none) */
  streamingId: (agent: string) => string | null;
  /** Abort an in-progress stream */
  abortStream: (agent: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

const ChatContext = createContext<ChatContextValue>({
  getChat: () => [],
  appendMessage: () => {},
  clearChat: () => {},
  startStream: () => null,
  onStreamChunk: () => () => {},
  streamingId: () => null,
  abortStream: () => {},
});

export function useChatContext() {
  return useContext(ChatContext);
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function ChatProvider({ children }: { children: ReactNode }) {
  const [, setTick] = useState(0);
  const storeRef = useRef<ChatStore>({});

  /* --- active streams map --- */
  const streamsRef = useRef<Map<string, StreamHandle>>(new Map());

  /* ================================================================ */
  /*  Existing sessionStorage-backed chat store (unchanged)            */
  /* ================================================================ */

  /** Hydrate from localStorage + sessionStorage on mount.
   *  Also migrates legacy ClaudePanel localStorage ("agentic-os-chat-v2:claude")
   *  into the global store so old chat history is never lost. */
  useEffect(() => {
    const local = loadFromLocal();
    const session = loadFromSession();
    // session (hot) wins over local (long-lived) for overlapping keys
    let store: ChatStore = { ...local, ...session };

    // ── Migrate legacy ClaudePanel localStorage ──
    if (LS_AVAILABLE) {
      try {
        const legacy = localStorage.getItem("agentic-os-chat-v2:claude");
        if (legacy) {
          const parsed = JSON.parse(legacy);
          if (Array.isArray(parsed) && parsed.length > 0 && !store["claude"]) {
            store["claude"] = parsed.map((m: { role: string; text: string; ts: number }) => ({
              id: `legacy_${m.ts}_${Math.random().toString(36).slice(2, 6)}`,
              role: m.role as "user" | "assistant",
              text: m.text,
              ts: m.ts,
            }));
          }
        }
      } catch {
        /* ignore */
      }
    }

    storeRef.current = store;
    saveStore(store); // persist merged back to both layers

    const handler = () => {
      storeRef.current = loadStore();
      setTick((t) => t + 1);
    };
    window.addEventListener("chat:update", handler);
    window.addEventListener("storage", handler);
    const agents = ["antigravity", "labyrinth", "claude", "codex", "openclaw", "chrono"];
    agents.forEach((a) => window.addEventListener(`chat:${a}`, handler));
    return () => {
      window.removeEventListener("chat:update", handler);
      window.removeEventListener("storage", handler);
      agents.forEach((a) => window.removeEventListener(`chat:${a}`, handler));
    };
  }, []);

  const getChat = useCallback(
    (key: string): ChatMessage[] => {
      const store = storeRef.current;
      const raw = store[key];
      if (raw) return dedupeMessages(raw);
      if (!SS_AVAILABLE) return [];
      try {
        const legacy = sessionStorage.getItem(`chat:${key}`);
        if (legacy) {
          const parsed = dedupeMessages(JSON.parse(legacy));
          store[key] = parsed;
          saveStore(store);
          return parsed;
        }
      } catch {
        /* ignore */
      }
      return [];
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    []
  );

  /* ================================================================ */
  /*  STREAMING ENGINE                                                  */
  /* ================================================================ */

  const onStreamChunk = useCallback(
    (agent: string, cb: (chunk: string, done: boolean) => void) => {
      const handle = streamsRef.current.get(agent);
      if (handle) {
        handle.listeners.add(cb);
        // Immediately replay current text so late subscribers don't miss anything
        if (handle.text) cb(handle.text, false);
      } else {
        // No active stream — register a placeholder so future streams find it
        streamsRef.current.set(agent, {
          agent,
          controller: new AbortController(),
          msgId: "",
          text: "",
          listeners: new Set([cb]),
          alive: false,
        });
      }
      return () => {
        const h = streamsRef.current.get(agent);
        if (h) h.listeners.delete(cb);
      };
    },
    []
  );

  const streamingId = useCallback((agent: string): string | null => {
    return streamsRef.current.get(agent)?.msgId ?? null;
  }, []);

  const abortStream = useCallback((agent: string) => {
    const handle = streamsRef.current.get(agent);
    if (handle) {
      handle.alive = false;
      try {
        handle.controller.abort();
      } catch {
        /* noop */
      }
      handle.listeners.forEach((cb) => {
        try {
          cb(handle.text, true);
        } catch {
          /* noop */
        }
      });
      handle.listeners.clear();
      streamsRef.current.delete(agent);
    }
  }, []);

  /** Append a message to the persistent chat store */
  const appendMessage = useCallback((key: string, msg: ChatMessage) => {
    const store = loadStore();
    if (!store[key]) store[key] = [];
    if (!store[key].some((m) => m.id === msg.id)) store[key].push(msg);
    store[key] = dedupeMessages(store[key]);
    saveStore(store);
    if (SS_AVAILABLE) {
      try {
        sessionStorage.setItem(`chat:${key}`, JSON.stringify(store[key]));
      } catch {
        /* quota */
      }
    }
    emitEvent("chat:update");
    emitEvent(`chat:${key}`);
  }, []);

  const clearChat = useCallback((key: string) => {
    const store = loadStore();
    store[key] = [];
    saveStore(store);
    if (SS_AVAILABLE) {
      try {
        sessionStorage.removeItem(`chat:${key}`);
      } catch {
        /* ignore */
      }
    }
    emitEvent("chat:update");
    emitEvent(`chat:${key}`);
  }, []);

  /**
   * Initiate a streaming agent request and spin the reader loop
   * entirely inside this provider (never in a component).
   */
  const startStream = useCallback(
    (agent: string, userText: string): string | null => {
      // Abort any existing stream for this agent
      abortStream(agent);

      const msgId = uid();
      const controller = new AbortController();

      const handle: StreamHandle = {
        agent,
        controller,
        msgId,
        text: "",
        listeners: new Set(),
        alive: true,
      };
      streamsRef.current.set(agent, handle);

      // Persist user message
      appendMessage(agent, {
        id: uid(),
        role: "user",
        text: userText,
        ts: Date.now(),
      });

      // Place a placeholder assistant message
      appendMessage(agent, {
        id: msgId,
        role: "assistant",
        text: "",
        ts: Date.now(),
        pending: true,
      });

      // Fire the fetch (infinite timeout — no runtime cap)
      fetch(`/api/${agent === "chrono" ? "hermes" : agent}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userText, agent }),
        signal: controller.signal,
      })
        .then(async (resp) => {
          if (!resp.ok || !resp.body) {
            throw new Error(`HTTP ${resp.status}`);
          }
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();

          // --- Async recursive read loop ---
          // Uses standard await/recursion — browsers do NOT throttle
          // ReadableStream .read() in modern engines.
          let buffer = "";

          const pump = async () => {
            if (!handle.alive) return;
            try {
              const { done, value } = await reader.read();
              if (done || !handle.alive) {
                // Flush any remaining buffer
                if (buffer) {
                  handle.text += buffer;
                  try {
                    appendMessage(agent, {
                      id: msgId,
                      role: "assistant",
                      text: handle.text,
                      ts: Date.now(),
                      pending: false,
                    });
                  } catch {
                    /* quota */
                  }
                  void logChatTurn({ agent, user: userText, reply: handle.text, source: "web" });
                  handle.listeners.forEach((cb) => {
                    try {
                      cb(buffer, true);
                    } catch {
                      /* noop */
                    }
                  });
                } else {
                  // Finalize with full text
                  void logChatTurn({ agent, user: userText, reply: handle.text, source: "web" });
                  handle.listeners.forEach((cb) => {
                    try {
                      cb("", true);
                    } catch {
                      /* noop */
                    }
                  });
                }
                // Remove pending flag
                finalizeMessage(agent, msgId, handle.text);
                handle.listeners.clear();
                streamsRef.current.delete(agent);
                return;
              }

              // ─── JSON UNWRAP ──────────────────────────────────────────
              // Routes return JSON: {"ok":true,"text":"...","empty":...}
              // Detect and extract just the .text field so the UI shows
              // clean prose instead of raw JSON boilerplate.
              const rawChunk = decoder.decode(value, { stream: true });
              let displayChunk = rawChunk;
              let consumed = false;

              // Try parsing the accumulated buffer + new chunk as JSON
              try {
                const parsed = JSON.parse(buffer + rawChunk);
                if (parsed && typeof parsed === "object" && typeof parsed.text === "string") {
                  displayChunk = parsed.text;
                  consumed = true;
                } else if (
                  parsed &&
                  typeof parsed === "object" &&
                  typeof (parsed as { item?: { type?: string; text?: string; aggregated_output?: string } }).item?.text === "string"
                ) {
                  displayChunk = (parsed as { item: { text: string } }).item.text;
                  consumed = true;
                }
              } catch {
                // Not valid JSON yet — try parsing just the new chunk alone
                try {
                  const parsed = JSON.parse(rawChunk);
                  if (parsed && typeof parsed === "object" && typeof parsed.text === "string") {
                    displayChunk = parsed.text;
                    consumed = true;
                  } else if (
                    parsed &&
                    typeof parsed === "object" &&
                    typeof (parsed as { item?: { type?: string; text?: string; aggregated_output?: string } }).item?.text === "string"
                  ) {
                    displayChunk = (parsed as { item: { text: string } }).item.text;
                    consumed = true;
                  }
                } catch {
                  // Plain text — use raw
                }
              }

              // Only accumulate raw buffer if we didn't consume it as JSON
              if (!consumed) {
                buffer += rawChunk;
              } else {
                buffer = "";
              }
              handle.text += displayChunk;

              // Push display-clean chunk to ALL listeners
              handle.listeners.forEach((cb) => {
                try {
                  cb(displayChunk, false);
                } catch {
                  /* noop */
                }
              });

              // Persist partial text to sessionStore periodically
              try {
                persistPartial(agent, msgId, handle.text);
              } catch {
                /* quota */
              }

              // Continue pumping (async recursion — tab-throttle safe)
              void pump();
            } catch (readErr) {
              if (handle.alive) {
                finalizeMessage(agent, msgId, handle.text);
                handle.listeners.forEach((cb) => {
                  try {
                    cb("", true);
                  } catch {
                    /* noop */
                  }
                });
                handle.listeners.clear();
                streamsRef.current.delete(agent);
              }
            }
          };

          void pump();
        })
        .catch((err) => {
          if (!handle.alive) return; // intentional abort
          const errMsg =
            err instanceof Error && err.name === "AbortError"
              ? "[stream aborted]"
              : err instanceof Error
                ? `[stream error: ${err.message}]`
                : "[stream failed]";
          handle.text += errMsg;
          finalizeMessage(agent, msgId, handle.text);
          handle.listeners.forEach((cb) => {
            try {
              cb(errMsg, true);
            } catch {
              /* noop */
            }
          });
          handle.listeners.clear();
          streamsRef.current.delete(agent);
        });

      return msgId;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [abortStream, appendMessage]
  );

  /** Finalize a message in the persistent store (remove pending flag) */
  const finalizeMessage = useCallback(
    (agent: string, msgId: string, fullText: string) => {
      const store = loadStore();
      const msgs = store[agent];
      if (!msgs) return;
      const idx = msgs.findIndex((m) => m.id === msgId);
      if (idx >= 0) {
        msgs[idx] = { ...msgs[idx], text: fullText || msgs[idx].text, pending: false };
        saveStore(store);
        try {
          sessionStorage.setItem(`chat:${agent}`, JSON.stringify(msgs));
        } catch {
          /* quota */
        }
        emitEvent(`chat:${agent}`);
        emitEvent("chat:update");
      }
    },
    []
  );

  /** Persist in-progress stream text to sessionStorage (for recovery) */
  const persistPartial = useCallback(
    (agent: string, msgId: string, text: string) => {
      if (!SS_AVAILABLE) return;
      sessionStorage.setItem(
        `chat:activeStream:${agent}`,
        JSON.stringify({ msgId, text, ts: Date.now() })
      );
    },
    []
  );

  return (
    <ChatContext.Provider
      value={{
        getChat,
        appendMessage,
        clearChat,
        startStream,
        onStreamChunk,
        streamingId,
        abortStream,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
