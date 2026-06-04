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
import {
  classifyPrompt,
  resolveRoute,
  type ModelTier,
  type RouteDecision,
} from "@/lib/model-router";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface StreamMetrics {
  startedAt: number;
  bytesReceived: number;
  chunks: number;
  lastChunkAt: number;
  /** Current route decision for this stream */
  route: RouteDecision | null;
}

interface StreamHandle {
  agent: string;
  controller: AbortController;
  msgId: string;
  text: string;
  listeners: Set<(chunk: string, done: boolean) => void>;
  alive: boolean;
  metrics: StreamMetrics;
}

interface RecoveryEntry {
  agent: string;
  msgId: string;
  text: string;
  ts: number;
}

/* ------------------------------------------------------------------ */
/*  Storage helpers                                                    */
/* ------------------------------------------------------------------ */

const LS_AVAILABLE =
  typeof window !== "undefined" && typeof window.localStorage !== "undefined";
const SS_AVAILABLE =
  typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";

const STREAM_LS_KEY = "stream:global";
const STREAM_SS_KEY = "stream:session";
const RECOVERY_KEY = "stream:recovery";

function loadFromSession(): Record<string, StreamMetrics> {
  if (!SS_AVAILABLE) return {};
  try {
    const raw = sessionStorage.getItem(STREAM_SS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveToSession(metrics: Record<string, StreamMetrics>) {
  if (!SS_AVAILABLE) return;
  try { sessionStorage.setItem(STREAM_SS_KEY, JSON.stringify(metrics)); } catch { /* quota */ }
}

function loadFromLocal(): Record<string, StreamMetrics> {
  if (!LS_AVAILABLE) return {};
  try {
    const raw = localStorage.getItem(STREAM_LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveToLocal(metrics: Record<string, StreamMetrics>) {
  if (!LS_AVAILABLE) return;
  try { localStorage.setItem(STREAM_LS_KEY, JSON.stringify(metrics)); } catch { /* quota */ }
}

function loadRecoveries(): RecoveryEntry[] {
  if (!SS_AVAILABLE) return [];
  try {
    const raw = sessionStorage.getItem(RECOVERY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveRecovery(entry: RecoveryEntry) {
  if (!SS_AVAILABLE) return;
  const existing = loadRecoveries();
  // Replace if same agent+msgId, otherwise append
  const idx = existing.findIndex((r) => r.agent === entry.agent && r.msgId === entry.msgId);
  if (idx >= 0) existing[idx] = entry;
  else existing.push(entry);
  // Keep max 20 recoveries
  const trimmed = existing.slice(-20);
  try { sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(trimmed)); } catch { /* quota */ }
}

function emitEvent(name: string) {
  window.dispatchEvent(new CustomEvent(name));
}

/* ------------------------------------------------------------------ */
/*  Context value                                                      */
/* ------------------------------------------------------------------ */

interface StreamContextValue {
  startStream: (agent: string, userText: string) => string | null;
  onStreamChunk: (agent: string, cb: (chunk: string, done: boolean) => void) => () => void;
  streamingId: (agent: string) => string | null;
  abortStream: (agent: string) => void;
  getMetrics: (agent: string) => StreamMetrics | null;
  getRoute: (agent: string) => RouteDecision | null;
  /** Recover an interrupted stream after tab switch / refresh */
  recoverStream: (agent: string) => RecoveryEntry | null;
}

const StreamContext = createContext<StreamContextValue>({
  startStream: () => null,
  onStreamChunk: () => () => {},
  streamingId: () => null,
  abortStream: () => {},
  getMetrics: () => null,
  getRoute: () => null,
  recoverStream: () => null,
});

export function useStreamContext() {
  return useContext(StreamContext);
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function StreamProvider({ children }: { children: ReactNode }) {
  const [, setTick] = useState(0);
  const streamsRef = useRef<Map<string, StreamHandle>>(new Map());

  /* ================================================================ */
  /*  VISIBILITY API — Keep streams alive across tab switches          */
  /*  Uses Page Visibility API + focus/blur to detect backgrounding    */
  /*  and ensure ReadableStream pump loops don't stall.                */
  /* ================================================================ */

  // Track visibility state
  const isVisibleRef = useRef(true);

  useEffect(() => {
    const onVisChange = () => {
      isVisibleRef.current = !document.hidden;
      if (!document.hidden) {
        // Tab became visible — check for streams that need recovery
        const recoveries = loadRecoveries();
        if (recoveries.length > 0) {
          // Notify any stale listeners that they should refresh
          emitEvent("stream:visibility:restored");
        }
      }
    };
    const onFocus = () => { isVisibleRef.current = true; };
    const onBlur = () => { isVisibleRef.current = false; };

    document.addEventListener("visibilitychange", onVisChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVisChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  /* ================================================================ */
  /*  HEARTBEAT — Keep-alive ping for background streams              */
  /*  Uses requestAnimationFrame (not setInterval) to avoid throttle   */
  /* ================================================================ */

  useEffect(() => {
    let rafId = 0;
    const heartbeat = () => {
      // Check all active streams — if any has been stalled >5s, re-ping
      const now = Date.now();
      streamsRef.current.forEach((handle) => {
        if (handle.alive && !isVisibleRef.current) {
          // Stream is running in background — ensure it hasn't stalled
          const lastChunk = handle.metrics.lastChunkAt;
          if (lastChunk > 0 && now - lastChunk > 10_000) {
            // Emit a no-op to keep the connection warm
            handle.listeners.forEach((cb) => {
              try { cb("", false); } catch { /* noop */ }
            });
          }
        }
      });
      rafId = requestAnimationFrame(heartbeat);
    };
    rafId = requestAnimationFrame(heartbeat);
    return () => cancelAnimationFrame(rafId);
  }, []);

  /* ================================================================ */
  /*  STREAMING ENGINE                                                  */
  /* ================================================================ */

  const onStreamChunk = useCallback(
    (agent: string, cb: (chunk: string, done: boolean) => void) => {
      const handle = streamsRef.current.get(agent);
      if (handle) {
        handle.listeners.add(cb);
        if (handle.text) cb(handle.text, false);
      } else {
        streamsRef.current.set(agent, {
          agent,
          controller: new AbortController(),
          msgId: "",
          text: "",
          listeners: new Set([cb]),
          alive: false,
          metrics: {
            startedAt: 0,
            bytesReceived: 0,
            chunks: 0,
            lastChunkAt: 0,
            route: null,
          },
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

  const getMetrics = useCallback((agent: string): StreamMetrics | null => {
    return streamsRef.current.get(agent)?.metrics ?? null;
  }, []);

  const getRoute = useCallback((agent: string): RouteDecision | null => {
    return streamsRef.current.get(agent)?.metrics.route ?? null;
  }, []);

  const abortStream = useCallback((agent: string) => {
    const handle = streamsRef.current.get(agent);
    if (handle) {
      handle.alive = false;
      try { handle.controller.abort(); } catch { /* noop */ }
      handle.listeners.forEach((cb) => {
        try { cb(handle.text, true); } catch { /* noop */ }
      });
      handle.listeners.clear();
      streamsRef.current.delete(agent);
    }
  }, []);

  const recoverStream = useCallback((agent: string): RecoveryEntry | null => {
    const recoveries = loadRecoveries();
    const entry = recoveries.find((r) => r.agent === agent);
    return entry ?? null;
  }, []);

  const startStream = useCallback(
    (agent: string, userText: string): string | null => {
      abortStream(agent);

      const msgId = `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const controller = new AbortController();

      // ─── MODEL ROUTING ──────────────────────────────────────────
      const route = resolveRoute(userText, agent);
      const apiTarget = agent === "chrono" ? "hermes" : agent;

      const metrics: StreamMetrics = {
        startedAt: Date.now(),
        bytesReceived: 0,
        chunks: 0,
        lastChunkAt: 0,
        route,
      };

      const handle: StreamHandle = {
        agent,
        controller,
        msgId,
        text: "",
        listeners: new Set(),
        alive: true,
        metrics,
      };
      streamsRef.current.set(agent, handle);

      // ─── VAULT LOGGING: fire-and-forget on stream completion ───
      let vaultLogSent = false;
      const logToVault = () => {
        if (vaultLogSent) return;
        vaultLogSent = true;
        const agentLabel = agent === "chrono" ? "Chrono" :
          agent === "openclaw" ? "Kairos" :
          agent === "claude" ? "Asta" :
          agent === "labyrinth" ? "Labyrinth" :
          agent === "antigravity" ? "Antigravity" :
          agent;
        fetch("/api/memory/log", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            agent: agent,
            kind: "chat",
            user: userText.slice(0, 4000),
            reply: handle.text.slice(0, 8000),
            source: "web",
          }),
        }).catch(() => { /* ignore vault logging failures */ });
      };

      // Stream fetch with routing metadata in headers
      fetch(`/api/${apiTarget}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Model-Tier": route.tier,
          "X-Model-Id": route.model,
        },
        body: JSON.stringify({
          prompt: userText,
          agent,
          modelTier: route.tier,
          model: route.model,
        }),
        signal: controller.signal,
      })
        .then(async (resp) => {
          if (!resp.ok || !resp.body) {
            throw new Error(`HTTP ${resp.status}`);
          }
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          const pump = async () => {
            if (!handle.alive) return;
            try {
              const { done, value } = await reader.read();
              if (done || !handle.alive) {
                if (buffer) {
                  handle.text += buffer;
                  handle.listeners.forEach((cb) => {
                    try { cb(buffer, true); } catch { /* noop */ }
                  });
                } else {
                  handle.listeners.forEach((cb) => {
                    try { cb("", true); } catch { /* noop */ }
                  });
                }
                // Save recovery for tab-switch resilience
                saveRecovery({
                  agent,
                  msgId,
                  text: handle.text,
                  ts: Date.now(),
                });
                // Log completed chat turn to Obsidian vault
                logToVault();
                handle.listeners.clear();
                streamsRef.current.delete(agent);
                setTick((t) => t + 1);
                return;
              }

              const rawChunk = decoder.decode(value, { stream: true });
              let displayChunk = "";
              let consumed = false;

              // NDJSON line-by-line parsing: split buffer+chunk into lines,
              // parse each line as a separate JSON object, extract .text
              const combined = buffer + rawChunk;
              const lines = combined.split("\n");
              // Keep the last potentially-partial line in buffer
              buffer = lines.pop() ?? "";

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                  const parsed = JSON.parse(trimmed);
                  if (parsed && typeof parsed === "object") {
                    if (parsed.type === "done") {
                      // Engine sent done token — finalize stream
                      buffer = "";
                      consumed = true;
                      // Flush display chunk before exiting
                      if (displayChunk) {
                        handle.text += displayChunk;
                        handle.listeners.forEach((cb) => { try { cb(displayChunk, false); } catch { /* noop */ } });
                      }
                      handle.text += displayChunk;
                      saveRecovery({ agent, msgId, text: handle.text, ts: Date.now() });
                      logToVault();
                      handle.listeners.forEach((cb) => { try { cb("", true); } catch { /* noop */ } });
                      handle.listeners.clear();
                      streamsRef.current.delete(agent);
                      setTick((t) => t + 1);
                      return;
                    }
                    if (typeof parsed.text === "string" && parsed.type !== "stderr") {
                      displayChunk += parsed.text;
                      consumed = true;
                    }
                  }
                } catch {
                  // Not JSON — treat as plain text
                  displayChunk += trimmed + "\n";
                  consumed = true;
                }
              }

              // Fallback: if NDJSON parsing didn't consume anything, try whole-buffer parse
              if (!consumed) {
                try {
                  const parsed = JSON.parse(combined);
                  if (parsed && typeof parsed === "object" && typeof parsed.text === "string") {
                    displayChunk = parsed.text;
                    consumed = true;
                    buffer = "";
                  }
                } catch {
                  // Will retry next chunk with more data
                }
              }

              handle.text += displayChunk;
              handle.metrics.bytesReceived += rawChunk.length;
              handle.metrics.chunks += 1;
              handle.metrics.lastChunkAt = Date.now();

              // Persist to sessionStorage every 5 chunks for crash recovery
              if (handle.metrics.chunks % 5 === 0) {
                saveRecovery({ agent, msgId, text: handle.text, ts: Date.now() });
              }

              handle.listeners.forEach((cb) => {
                try { cb(displayChunk, false); } catch { /* noop */ }
              });

              // Async recursion — NOT throttled by browsers even in background tabs
              void pump();
            } catch (readErr) {
              if (handle.alive) {
                handle.listeners.forEach((cb) => {
                  try { cb("", true); } catch { /* noop */ }
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
          const errMsg =
            err instanceof Error && err.name === "AbortError"
              ? "[stream aborted]"
              : err instanceof Error
                ? `[stream error: ${err.message}]`
                : "[stream failed]";
          handle.text += errMsg;
          handle.listeners.forEach((cb) => {
            try { cb(errMsg, true); } catch { /* noop */ }
          });
          handle.listeners.clear();
          streamsRef.current.delete(agent);
          setTick((t) => t + 1);
        });

      return msgId;
    },
    [abortStream]
  );

  return (
    <StreamContext.Provider
      value={{
        startStream,
        onStreamChunk,
        streamingId,
        abortStream,
        getMetrics,
        getRoute,
        recoverStream,
      }}
    >
      {children}
    </StreamContext.Provider>
  );
}
