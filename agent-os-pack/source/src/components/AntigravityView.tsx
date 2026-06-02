"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Copy, Check, Trash2, RotateCcw, Zap } from "lucide-react";
import AgentAvatar from "./AgentAvatar";
import { useChatContext } from "@/context/ChatContext";

/* ─── Slash command definitions (Hermes v15) ─────────────────────── */
interface SlashDef {
  cmd: string;
  hint: string;
  icon: string;
  category: "session" | "context" | "engine" | "utility";
}

const SLASH_COMMANDS: SlashDef[] = [
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

/* ─── Client-side slash executor (v15) ───────────────────────────── */
async function executeClientSlash(
  raw: string,
  chatKey: string,
  appendMsg: (key: string, m: { id: string; role: "user" | "assistant"; text: string; ts: number }) => void,
  clearChat: (key: string) => void,
  messages: { id: string; role: string; text: string; ts: number }[],
  streaming: boolean,
  setStreaming: React.Dispatch<React.SetStateAction<boolean>>,
  ctrlRef: React.MutableRefObject<AbortController | null>,
  submitFn: () => Promise<void>,
): Promise<boolean> {
  const clean = raw.trim();
  if (!clean.startsWith("/")) return false;

  const parts = clean.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case "/clear":
    case "/reset":
      clearChat(chatKey);
      return true;

    case "/new":
      clearChat(chatKey);
      appendMsg(chatKey, {
        id: `sys_${Date.now()}`,
        role: "assistant",
        text: `✨ Conversation initialized for framework session: [ANTIGRAVITY]`,
        ts: Date.now(),
      });
      return true;

    case "/undo":
    case "/retry":
    case "/compress":
      // These need local message state manipulation — append a notice
      appendMsg(chatKey, {
        id: `sys_${Date.now()}`,
        role: "assistant",
        text: `[${cmd}] Client-side state modification requires local message store.`,
        ts: Date.now(),
      });
      return true;

    case "/stop":
      if (streaming) ctrlRef.current?.abort();
      return true;

    case "/goal": {
      const payload = `[GOAL RUNNER MODE ACTIVE] Objectives: ${args.join(" ")}`;
      appendMsg(chatKey, { id: `u_${Date.now()}`, role: "user", text: payload, ts: Date.now() });
      if (streaming) ctrlRef.current?.abort();
      setTimeout(() => submitFn(), 100);
      return true;
    }

    case "/status":
    case "/doctor":
    case "/vault":
    case "/usage":
    case "/reasoning":
      try {
        const r = await fetch("/api/slash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commandString: clean, agent: chatKey }),
        });
        const d = await r.json();
        const outText = d.text ?? d.error ?? "(ready)";
        appendMsg(chatKey, { id: `sys_${Date.now()}`, role: "assistant", text: outText, ts: Date.now() });
      } catch (e) {
        appendMsg(chatKey, { id: `sys_${Date.now()}`, role: "assistant", text: `[slash error] ${String(e)}`, ts: Date.now() });
      }
      return true;

    default:
      return false;
  }
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  COMPONENT                                                        */
/* ═══════════════════════════════════════════════════════════════════ */
export default function AntigravityView() {
  const accent = "#7c3aed";
  const accentDim = "rgba(124,58,237,0.12)";
  const { getChat, appendMessage, clearChat } = useChatContext();
  const chatKey = "antigravity";
  const messages = getChat(chatKey);

  const [mounted, setMounted] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [copyId, setCopyId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const startRef = useRef<number>(0);
  const ctrlRef = useRef<AbortController | null>(null);

  /* ─── Slash autocomplete ────────────────────────────────────────── */
  const [showSlash, setShowSlash] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, loading]);

  useEffect(() => {
    if (!loading) return;
    startRef.current = Date.now();
    const tick = setInterval(
      () => setElapsedMs(Date.now() - startRef.current),
      250
    );
    return () => {
      clearInterval(tick);
      setElapsedMs(0);
    };
  }, [loading]);

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
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setShowSlash(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSlash]);

  /* ─── INPUT UNLOCK: Submit handler (v15 slash-aware) ────────────── */
  const submit = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setInput("");

    // ── Slash command interceptor ──
    if (trimmed.startsWith("/")) {
      setShowSlash(false);
      // For client-side commands that need setMessages, we use appendMessage
      // and dispatch a global event to trigger re-render
      const handled = await executeClientSlash(
        trimmed, chatKey, appendMessage, clearChat,
        getChat(chatKey), loading, setLoading, ctrlRef, () => submit()
      );
      return;
    }

    // ── INPUT UNLOCK: abort active request, then dispatch ──
    if (loading && ctrlRef.current) {
      ctrlRef.current.abort();
      setLoading(false);
      await new Promise((r) => setTimeout(r, 50));
    }

    setLoading(true);
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;

    appendMessage(chatKey, {
      id: String(Date.now()) + "-u",
      role: "user",
      text: trimmed,
      ts: Date.now(),
    });

    try {
      const res = await fetch("/api/antigravity/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: trimmed }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        let detail = String(res.status);
        try {
          const j = await res.json();
          detail = j.error || detail;
        } catch {
          /* ignore */
        }
        appendMessage(chatKey, {
          id: String(Date.now()) + "-a",
          role: "assistant",
          text: `[error] Antigravity returned ${detail}`,
          ts: Date.now(),
        });
        setLoading(false);
        return;
      }

      // ─── STREAMING JSON TOKEN UNWRAP (v2) ─────────────────────────────
      // The native Go engine streams newline-delimited JSON tokens:
      //   {"type":"thinking","text":"..."}  → silently dropped
      //   {"type":"text","text":"..."}       → extract .text, append to UI
      //   {"type":"done","code":0}          → silently dropped
      //   {"type":"error","text":"..."}     → extract .text, show as error
      //
      // Defensive parsing:
      //   1. Regex pre-check rejects non-JSON lines before JSON.parse
      //   2. try/catch wraps every JSON.parse call
      //   3. Extracted .text is stripped of raw JSON artifacts before render
      //   4. Leftover buffer flushed after stream ends
      if (!res.body) {
        appendMessage(chatKey, {
          id: String(Date.now()) + "-a",
          role: "assistant",
          text: "(ready)",
          ts: Date.now(),
        });
        setLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let lineBuf = "";
      let assistantText = "";
      const assistantId = String(Date.now()) + "-a";

      // Strip any raw JSON telemetry artifacts from extracted text
      const stripJsonArtifacts = (raw: string): string => {
        // Remove lines that are raw JSON objects like {"type":"...","text":"..."}
        return raw
          .replace(/\{"type":"(?:text|thinking|done|error)"[^}]*\}/g, "")
          .replace(/\\{2}"type\\{2}":\\{2}"(?:text|thinking|done|error)\\{2}[^}]*}/g, "")
          .trim();
      };

      const processLine = (rawLine: string) => {
        const trimmed = rawLine.trim();
        if (!trimmed) return;

        // Fast reject: skip lines that don't start with '{' (not JSON objects)
        if (!trimmed.startsWith("{")) return;

        let token: { type?: string; text?: string; code?: number };
        try {
          token = JSON.parse(trimmed);
        } catch {
          // Not valid JSON — silently drop
          return;
        }

        if (!token || typeof token.type !== "string") return;

        switch (token.type) {
          case "text": {
            const cleanText = stripJsonArtifacts(token.text ?? "");
            if (!cleanText) return; // Don't append empty/whitespace-only content
            assistantText += cleanText;
            appendMessage(chatKey, {
              id: assistantId,
              role: "assistant",
              text: assistantText,
              ts: Date.now(),
            });
            break;
          }

          case "thinking":
            // Silently drop — internal telemetry, not for user display
            break;

          case "done":
            // Silently drop — stream complete signal
            break;

          case "error": {
            const errorText = stripJsonArtifacts(token.text ?? "unknown error");
            assistantText += `\n[error] ${errorText}`;
            appendMessage(chatKey, {
              id: assistantId,
              role: "assistant",
              text: assistantText,
              ts: Date.now(),
            });
            break;
          }

          default:
            // Unknown token type — drop silently
            break;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuf += decoder.decode(value, { stream: true });
        const lines = lineBuf.split("\n");
        lineBuf = lines.pop() ?? "";

        for (const line of lines) {
          processLine(line);
        }
      }

      // Flush any remaining partial line left in the buffer
      if (lineBuf.trim()) {
        processLine(lineBuf);
      }

    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // Intentional abort — don't show error
      } else {
        appendMessage(chatKey, {
          id: String(Date.now()) + "-e",
          role: "assistant",
          text: `[error] ${String(err)}`,
          ts: Date.now(),
        });
      }
    }

  setLoading(false);
  }, [input, loading, chatKey, appendMessage, clearChat, messages]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  /* ─── Slash popover selection ───────────────────────────────────── */
  const handleSlashSelect = (cmd: string) => {
    setInput(cmd + " ");
    setShowSlash(false);
    textareaRef.current?.focus();
  };

  const copyText = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopyId(id);
    setTimeout(() => setCopyId(null), 2000);
  };

  const clear = () => clearChat(chatKey);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AgentAvatar agent="antigravity" size={40} />
          <div>
            <h2 className="text-lg font-semibold" style={{ color: accent }}>
              Antigravity
            </h2>
            <p className="text-sm" style={{ color: "var(--fg-dim)" }}>
              Go-based, multi-agent harness. Plugins, async workflows,
              parallel dispatch.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-[11px] font-[var(--font-geist-mono)]"
              style={{ color: accent }}
            >
              <Zap size={11} className="inline mr-1" />
              {Math.floor(elapsedMs / 1000)}s
            </motion.span>
          )}
          <button
            onClick={clear}
            className="flex items-center gap-1.5 px-3 h-[34px] rounded-lg border text-[12px] transition hover:text-[var(--fg)]"
            style={{
              borderColor: "var(--line-soft)",
              color: "var(--cream-dim)",
            }}
            title="Clear chat history"
          >
            <Trash2 size={12} /> Clear
          </button>
        </div>
      </div>

      {/* Chat window */}
      <div
        className="panel flex flex-col"
        style={{
          height: "calc(100vh - 260px)",
          minHeight: "420px",
          borderColor: `${accent}25`,
        }}
      >
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll">
          {!mounted ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3 opacity-60">
              <div
                className="rounded-full"
                style={{ width: 56, height: 56, background: `${accentDim}` }}
              />
              <p className="text-sm font-medium" style={{ color: "var(--fg)" }}>
                Antigravity is getting ready.
              </p>
              <p className="text-xs" style={{ color: "var(--fg-dim)" }}>
                Multi-agent harness · Plugin system · Async workflows
              </p>
            </div>
          ) : messages.length === 0 && !loading ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3 opacity-60">
              <AgentAvatar agent="antigravity" size={56} />
              <p className="text-sm font-medium" style={{ color: "var(--fg)" }}>
                Send a message to start chatting with Antigravity.
              </p>
              <p className="text-xs" style={{ color: "var(--fg-dim)" }}>
                Multi-agent harness · Plugin system · Async workflows · Use{" "}
                <span className="text-violet-400">/commands</span> for system
                tools
              </p>
            </div>
          ) : null}

          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className={`flex gap-3 ${
                  msg.role === "user" ? "flex-row-reverse" : ""
                }`}
              >
                {msg.role === "assistant" && (
                  <div className="shrink-0 mt-1">
                    <AgentAvatar agent="antigravity" size={28} />
                  </div>
                )}
                <div
                  className={`group relative max-w-[80%] rounded-xl px-4 py-3 text-[14px] leading-relaxed ${
                    msg.role === "user" ? "text-white" : ""
                  }`}
                  style={{
                    background:
                      msg.role === "user" ? `${accent}cc` : "var(--bg-elev)",
                    color: msg.role === "user" ? "white" : "var(--fg)",
                    borderRadius:
                      msg.role === "user"
                        ? "16px 16px 4px 16px"
                        : "16px 16px 16px 4px",
                  }}
                >
                  <div className="whitespace-pre-wrap break-words">
                    {msg.text}
                  </div>

                  {msg.role === "assistant" && msg.text && (
                    <button
                      onClick={() => copyText(msg.text, msg.id)}
                      className="absolute -bottom-2.5 right-2 w-7 h-7 rounded-md border grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      style={{
                        background: "var(--bg-card)",
                        borderColor: "var(--line-soft)",
                        color:
                          copyId === msg.id
                            ? "var(--emerald)"
                            : "var(--cream-dim)",
                      }}
                      title="Copy to clipboard"
                    >
                      {copyId === msg.id ? (
                        <Check size={12} />
                      ) : (
                        <Copy size={12} />
                      )}
                    </button>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Loading indicator */}
          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 text-[13px]"
              style={{ color: "var(--fg-dim)" }}
            >
              <AgentAvatar agent="antigravity" size={24} />
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full animate-bounce"
                  style={{ background: accent, animationDelay: "0ms" }}
                />
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full animate-bounce"
                  style={{ background: accent, animationDelay: "150ms" }}
                />
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full animate-bounce"
                  style={{ background: accent, animationDelay: "300ms" }}
                />
                <span className="ml-1" style={{ color: accent }}>
                  Antigravity thinking
                  {elapsedMs > 2000 && (
                    <span className="ml-1 font-[var(--font-geist-mono)] text-[11px]">
                      {Math.floor(elapsedMs / 1000)}s
                    </span>
                  )}
                </span>
              </span>
            </motion.div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="p-3 border-t relative" style={{ borderColor: "var(--line-soft)" }}>
          <div
            className="flex items-end gap-2 rounded-xl border px-3 py-2 transition-colors"
            style={{
              borderColor: input.trim() ? accent : "var(--line-soft)",
              background: "var(--bg-elev)",
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Message Antigravity…  (type / for commands)"
              rows={1}
              className="flex-1 bg-transparent outline-none resize-none text-[14px] text-[var(--fg)] placeholder-[var(--cream-mute)] min-h-[24px] max-h-[120px] leading-relaxed"
              style={{ fontFamily: "'Manrope', sans-serif" }}
            />
            {/* Send button — NEVER disabled, always focusable */}
            <button
              onClick={submit}
              className="shrink-0 w-8 h-8 rounded-lg grid place-items-center transition cursor-pointer"
              style={{
                background: input.trim() ? accent : "var(--bg-card)",
                color: "white",
              }}
              title="Send (interrupts active request)"
              type="button"
            >
              {loading ? (
                <RotateCcw size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
            </button>
          </div>

          {/* Slash command autocomplete popover (grouped by category) */}
          {showSlash && (
            <div
              ref={popoverRef}
              className="absolute bottom-full left-3 mb-1 w-80 max-h-80 overflow-y-auto rounded-xl border border-white/10 bg-zinc-900/95 backdrop-blur-sm shadow-2xl z-40"
            >
              <div className="px-3 py-2 border-b border-white/5 text-[10px] uppercase tracking-widest text-zinc-400 font-semibold sticky top-0 bg-zinc-900/95">
                Slash Commands — {SLASH_COMMANDS.length} available
              </div>
              {(["session", "context", "engine", "utility"] as const).map((cat) => {
                const items = SLASH_COMMANDS.filter((s) => s.category === cat);
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
                        onMouseDown={(e) => { e.preventDefault(); handleSlashSelect(s.cmd); }}
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

          <div className="flex items-center justify-between mt-1.5 px-1">
            <span
              className="text-[10px] uppercase tracking-widest"
              style={{
                color: "var(--cream-mute)",
                fontFamily: "'Manrope', sans-serif",
              }}
            >
              Shift+Enter for newline · Enter to send
            </span>
            <span
              className="text-[10px]"
              style={{ color: "var(--cream-mute)" }}
            >
              Go-based multi-agent harness
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
