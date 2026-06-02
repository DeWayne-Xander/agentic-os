"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useChatContext, type ChatMessage } from "@/context/ChatContext";
import { useEnhancedChat } from "@/context/EnhancedChatContext";
import { useStreamContext } from "@/context/StreamContext";
import { ApprovalGate } from "./ApprovalGate";
import { modelDisplayName, type ModelTier, type RouteDecision } from "@/lib/model-router";

export interface UnifiedChatProps {
  agent: string;
  apiPath: string;
  accent: string;
}

/* ─── Types ──────────────────────────────────────────────────────── */
interface SlashDef {
  cmd: string;
  hint: string;
  icon: string;
  category: "session" | "context" | "engine" | "utility";
}

interface ComponentHooks {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  streaming: boolean;
  abortStream: (agent: string) => void;
  startStream: (agent: string, text: string) => string | null;
  clearChat: (key: string) => void;
  agent: string;
}

// ─── Full Hermes v15 catalog ───────────────────────────────────────
const SLASH_CATALOG: SlashDef[] = [
  { cmd: "/clear",      hint: "Wipes current UI session history state instantly",       category: "session",  icon: "🧹" },
  { cmd: "/new",        hint: "Starts a completely fresh chat session thread",          category: "session",  icon: "✨" },
  { cmd: "/reset",      hint: "Flushes all context layers and re-anchors identity",     category: "session",  icon: "🔄" },
  { cmd: "/undo",       hint: "Removes the last prompt-reply block from history",       category: "session",  icon: "↩️" },
  { cmd: "/retry",      hint: "Deletes the last response and forces a regeneration",    category: "session",  icon: "🔁" },
  { cmd: "/stop",       hint: "Force-kills executing local background subprocesses",    category: "context",  icon: "🛑" },
  { cmd: "/compress",   hint: "Summarizes deep message history to preserve tokens",     category: "context",  icon: "🗜️" },
  { cmd: "/goal",       hint: "Initializes a multi-step background runner thread",     category: "context",  icon: "🎯" },
  { cmd: "/reasoning",  hint: "Toggles visibility or level of internal thinking",       category: "engine",   icon: "🧠" },
  { cmd: "/status",     hint: "Triggers local shell status and telemetry metrics",      category: "utility",  icon: "📡" },
  { cmd: "/doctor",     hint: "Runs diagnostics on local server environments",          category: "utility",  icon: "🩺" },
  { cmd: "/vault",      hint: "Indexes and tracks recent entries in the Obsidian vault", category: "utility",  icon: "📚" },
  { cmd: "/usage",      hint: "Renders comprehensive API token counters and cost",      category: "utility",  icon: "📊" },
];

/**
 * Client-side slash command executor.
 * Returns true if the command was handled (pipeline should stop).
 */
async function executeClientSlash(
  text: string,
  hooks: ComponentHooks
): Promise<boolean> {
  const clean = text.trim();
  if (!clean.startsWith("/")) return false;

  const parts = clean.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    // ── Session commands ────────────────────────────────────────
    case "/clear":
    case "/reset": {
      hooks.clearChat(hooks.agent);
      return true;
    }

    case "/new": {
      hooks.clearChat(hooks.agent);
      hooks.setMessages([
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `✨ Conversation initialized for framework session: [${hooks.agent.toUpperCase()}]`,
          ts: Date.now(),
        },
      ]);
      return true;
    }

    case "/undo": {
      if (hooks.messages.length >= 2) {
        hooks.setMessages((prev) => prev.slice(0, -2));
      }
      return true;
    }

    case "/retry": {
      if (hooks.messages.length >= 2) {
        const userMsgs = hooks.messages.filter((m) => m.role === "user");
        if (userMsgs.length > 0) {
          const lastPrompt = userMsgs[userMsgs.length - 1].text;
          hooks.setMessages((prev) => prev.slice(0, -2));
          if (hooks.streaming) hooks.abortStream(hooks.agent);
          setTimeout(() => hooks.startStream(hooks.agent, lastPrompt), 50);
        }
      }
      return true;
    }

    // ── Context commands ────────────────────────────────────────
    case "/stop": {
      if (hooks.streaming) hooks.abortStream(hooks.agent);
      return true;
    }

    case "/compress": {
      const keepCount = parseInt(args[0]) || 2;
      if (hooks.messages.length > keepCount * 2) {
        const recent = hooks.messages.slice(-keepCount * 2);
        const older = hooks.messages.slice(0, -keepCount * 2);
        const summary: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `[Context Compression Active]: Automated historical digestion compiled for ${older.length} underlying prompt matrices.`,
          ts: Date.now(),
        };
        hooks.setMessages([summary, ...recent]);
      }
      return true;
    }

    case "/goal": {
      if (hooks.agent === "codex") {
        const prompt = args.join(" ").trim();
        if (!prompt) return true;
        try {
          const title = prompt.split(/\s+/).slice(0, 8).join(" ").slice(0, 120) || "Codex goal";
          const r = await fetch("/api/codex/goals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title,
              prompt: `[GOAL RUNNER MODE ACTIVE]\n${prompt}\n\nYou are Asta running long-horizon Goal Mode. Decompose the mission into subtasks automatically. Coordinate with Chrono, Labyrinth, Kairos, and Codex as needed. Keep working until completion.`,
            }),
          });
          const d = await r.json().catch(() => ({}));
          const goal = d.goal;
          hooks.setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              text: goal
                ? `🎯 Goal started: ${goal.title}\nID: ${goal.id}\nWorking directory: ${goal.cwd}`
                : `🎯 Goal submitted.`,
              ts: Date.now(),
            },
          ]);
        } catch (err) {
          hooks.setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              text: `[goal error] ${String(err)}`,
              ts: Date.now(),
            },
          ]);
        }
        return true;
      }
      const goalPayload = `[GOAL RUNNER MODE ACTIVE] Objectives: ${args.join(" ")}`;
      if (hooks.streaming) hooks.abortStream(hooks.agent);
      setTimeout(() => hooks.startStream(hooks.agent, goalPayload), 50);
      return true;
    }

    // ── Engine / Utility → server-side ─────────────────────────
    case "/status":
    case "/doctor":
    case "/vault":
    case "/usage":
    case "/reasoning": {
      try {
        const r = await fetch("/api/slash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commandString: clean, agent: hooks.agent }),
        });
        const d = await r.json();
        const outText = d.text ?? d.error ?? "(ready)";
        hooks.setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: outText,
            ts: Date.now(),
          },
        ]);
      } catch (err) {
        hooks.setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: `[slash error] ${String(err)}`,
            ts: Date.now(),
          },
        ]);
      }
      return true;
    }

    default:
      return false;
  }
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  COMPONENT                                                        */
/* ═══════════════════════════════════════════════════════════════════ */
export default function UnifiedChat({ agent }: UnifiedChatProps) {
  const { getChat, clearChat, startStream, onStreamChunk, streamingId, abortStream } =
    useChatContext();
  const enhanced = useEnhancedChat();
  const streamCtx = useStreamContext();

  const [messages, setMessages] = useState<ChatMessage[]>(getChat(agent));
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [activeTier, setActiveTier] = useState<ModelTier | null>(null);
  const [activeRoute, setActiveRoute] = useState<RouteDecision | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showSlash, setShowSlash] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  /* --- Sync messages from global store --- */
  useEffect(() => { setMessages(getChat(agent)); }, [agent, getChat]);

  /* --- Cross-tab + custom events --- */
  useEffect(() => {
    const refresh = () => setMessages(getChat(agent));
    const evts = ["chat:update", `chat:${agent}`, "storage"];
    evts.forEach((e) => window.addEventListener(e, refresh));
    return () => evts.forEach((e) => window.removeEventListener(e, refresh));
  }, [agent, getChat]);

  /* --- Stream chunk subscription --- */
  useEffect(() => {
    const unsub = onStreamChunk(agent, (_chunk: string, done: boolean) => {
      setMessages(getChat(agent));
      if (done) setStreaming(false);
    });
    return unsub;
  }, [agent, onStreamChunk, getChat]);

  /* --- Track streaming state --- */
  useEffect(() => {
    setStreaming(streamingId(agent) !== null);
  }, [agent, streamingId, messages]);

  /* --- Stream recovery on mount (tab switch / refresh) --- */
  useEffect(() => {
    const recovery = streamCtx.recoverStream(agent);
    if (recovery && recovery.text) {
      // Rehydrate messages from recovery
      const recoveredMsg: ChatMessage = {
        id: `recovered_${recovery.ts}`,
        role: "assistant",
        text: recovery.text,
        ts: recovery.ts,
        pending: false,
      };
      setMessages((prev) => {
        // Only add if not already present
        if (prev.some((m) => m.text === recovery.text)) return prev;
        return [...prev, recoveredMsg];
      });
    }
  }, [agent, streamCtx]);

  /* --- Enhanced stream metrics --- */
  useEffect(() => {
    const unsub = streamCtx.onStreamChunk(agent, (_chunk: string, done: boolean) => {
      const metrics = streamCtx.getMetrics(agent);
      if (metrics?.route) {
        setActiveRoute(metrics.route);
        setActiveTier(metrics.route.tier);
      }
      if (done) setStreaming(false);
    });
    return unsub;
  }, [agent, streamCtx]);

  /* --- Auto-scroll --- */
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  /* --- Slash autocomplete visibility --- */
  useEffect(() => {
    setShowSlash(input === "/");
  }, [input]);

  /* --- Close popover on outside click --- */
  useEffect(() => {
    if (!showSlash) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSlash(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSlash]);

  /* ─── INPUT UNLOCK: Send handler ────────────────────────────────── */
  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");

    // ── Slash command interceptor ──
    if (text.startsWith("/")) {
      setShowSlash(false);
      const handled = await executeClientSlash(text, {
        messages,
        setMessages,
        streaming,
        abortStream,
        startStream,
        clearChat,
        agent,
      });
      if (handled) return;
      // Unknown slash — fall through to LLM
    }

    // ── Abort active stream, then dispatch new prompt ──
    if (streaming) {
      abortStream(agent);
      await new Promise((r) => setTimeout(r, 50));
    }
    setStreaming(true);
    startStream(agent, text);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSlashSelect = (cmd: string) => {
    setInput(cmd + " ");
    setShowSlash(false);
    inputRef.current?.focus();
  };

  const handleStop = () => {
    abortStream(agent);
    setStreaming(false);
  };

  const displayName =
    agent === "chrono" ? "Chrono" :
    agent === "openclaw" ? "Kairos" :
    agent;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/10 shrink-0">
        <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
        <span className="text-sm font-semibold text-zinc-200 tracking-wide uppercase">
          {displayName}
        </span>
        {activeTier && (
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
            activeTier === "heavy"
              ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
              : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
          }`}>
            {modelDisplayName(activeTier, activeRoute?.model ?? "")}
          </span>
        )}
        {streaming && (
          <span className="text-xs text-violet-300 ml-auto flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-ping" />
            Streaming…
          </span>
        )}
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {messages.length === 0 && (
          <p className="text-center text-zinc-500 text-sm mt-20">
            No messages yet. Type or use{" "}
            <span className="text-violet-400">/commands</span> to begin.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
              m.role === "user"
                ? "ml-auto bg-violet-600/20 text-violet-100 border border-violet-500/30"
                : "mr-auto bg-white/5 text-zinc-200 border border-white/10"
            }`}
          >
            <div className="whitespace-pre-wrap break-words">
              {m.text}
              {m.pending && (
                <span className="inline-block w-1.5 h-4 bg-violet-400 ml-1 animate-pulse align-middle" />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-white/10 p-4 relative">
        <div className="flex items-end gap-2 bg-white/5 rounded-xl border border-white/10 px-3 py-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${displayName}…  (type / for commands)`}
            rows={1}
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 resize-none outline-none py-1 max-h-32"
          />
          {streaming ? (
            <button
              onClick={handleStop}
              className="shrink-0 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-semibold px-3 py-1.5 hover:bg-red-500/30 transition-colors"
              type="button"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              className="shrink-0 rounded-lg bg-violet-600/30 border border-violet-500/40 text-violet-200 text-xs font-semibold px-3 py-1.5 hover:bg-violet-600/50 transition-colors"
              type="button"
            >
              Send
            </button>
          )}
        </div>

        {/* Slash command autocomplete popover */}
        {showSlash && (
          <div
            ref={popoverRef}
            className="absolute bottom-full left-4 mb-1 w-80 max-h-80 overflow-y-auto rounded-xl border border-white/10 bg-zinc-900/95 backdrop-blur-sm shadow-2xl z-40"
          >
            <div className="px-3 py-2 border-b border-white/5 text-[10px] uppercase tracking-widest text-zinc-400 font-semibold sticky top-0 bg-zinc-900/95">
              Slash Commands — {SLASH_CATALOG.length} available
            </div>
            {(["session", "context", "engine", "utility"] as const).map((cat) => {
              const items = SLASH_CATALOG.filter((s) => s.category === cat);
              if (items.length === 0) return null;
              return (
                <div key={cat}>
                  <div className="px-3 py-1 text-[9px] uppercase tracking-[0.15em] text-zinc-500 font-semibold bg-white/[0.02]">
                    {cat}
                  </div>
                  {items.map((s) => (
                    <button
                      key={s.cmd}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSlashSelect(s.cmd);
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-white/5 transition-colors"
                    >
                      <span className="text-base">{s.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-zinc-200">{s.cmd}</div>
                        <div className="text-[11px] text-zinc-400 truncate">{s.hint}</div>
                      </div>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ApprovalGate agent={agent} apiPath="" />
    </div>
  );
}
