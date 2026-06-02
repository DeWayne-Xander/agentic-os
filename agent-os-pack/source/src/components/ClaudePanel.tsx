"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, Zap, AlertTriangle, BookOpen } from "lucide-react";
import Link from "next/link";
import AgentAvatar from "./AgentAvatar";
import type { AgentKey } from "./AgentAvatar";
import VoiceButton from "./VoiceButton";

/* ─── Types ──────────────────────────────────────────────────────── */
interface Msg {
  role: "user" | "assistant";
  text: string;
  ts: number;
}

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

const STORAGE_KEY = "agentic-os-chat-v2:codex";

function logToVault(user: string, reply: string) {
  fetch("/api/memory/log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent: "codex", kind: "chat", user, reply }),
  }).catch(() => {});
}

/* ─── Client-side slash executor (v15 spec) ─────────────────────── */
async function executeClientSlash(
  raw: string,
  msgs: Msg[],
  setMsgs: React.Dispatch<React.SetStateAction<Msg[]>>,
  streaming: boolean,
  setStreaming: React.Dispatch<React.SetStateAction<boolean>>,
  ctrlRef: React.MutableRefObject<AbortController | null>,
  streamFn: (prompt: string) => Promise<string>,
): Promise<boolean> {
  const clean = raw.trim();
  if (!clean.startsWith("/")) return false;

  const parts = clean.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case "/clear":
    case "/reset": {
      setMsgs([]);
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* */ }
      return true;
    }

    case "/new": {
    setMsgs([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* */ }
    setMsgs([{
      role: "assistant",
      text: `✨ Conversation initialized for framework session: [CODEX]`,
      ts: Date.now(),
    }]);
    return true;
    }

    case "/undo": {
      if (msgs.length >= 2) setMsgs((prev) => prev.slice(0, -2));
      return true;
    }

    case "/retry": {
      if (msgs.length >= 2) {
        const userMsgs = msgs.filter((m) => m.role === "user");
        if (userMsgs.length > 0) {
          const lastPrompt = userMsgs[userMsgs.length - 1].text;
          setMsgs((prev) => prev.slice(0, -2));
          if (streaming) {
            ctrlRef.current?.abort();
            setStreaming(false);
          }
          setTimeout(async () => {
            setStreaming(true);
            let reply = "";
            try { reply = await streamFn(lastPrompt); } catch (e) { reply = `[error: ${String(e)}]`; }
            setMsgs((m) => [...m, { role: "user", text: lastPrompt, ts: Date.now() }, { role: "assistant", text: reply, ts: Date.now() }]);
            setStreaming(false);
          }, 50);
        }
      }
      return true;
    }

    case "/stop": {
      if (streaming) {
        ctrlRef.current?.abort();
        setStreaming(false);
      }
      return true;
    }

    case "/compress": {
      const keep = parseInt(args[0]) || 2;
      if (msgs.length > keep * 2) {
        const recent = msgs.slice(-keep * 2);
        const older = msgs.slice(0, -keep * 2);
        setMsgs([
          { role: "assistant", text: `[Context Compression]: Digested ${older.length} messages into summary.`, ts: Date.now() },
          ...recent,
        ]);
      }
      return true;
    }

    case "/goal": {
      const payload = `[GOAL RUNNER MODE ACTIVE] Objectives: ${args.join(" ")}`;
      if (streaming) ctrlRef.current?.abort();
      setMsgs((m) => [...m, { role: "user", text: payload, ts: Date.now() }]);
      setTimeout(async () => {
        setStreaming(true);
        let reply = "";
        try { reply = await streamFn(payload); } catch (e) { reply = `[error: ${String(e)}]`; }
        setMsgs((m) => [...m, { role: "assistant", text: reply, ts: Date.now() }]);
        setStreaming(false);
      }, 50);
      return true;
    }

    // Server-side commands
    case "/status":
    case "/doctor":
    case "/vault":
    case "/usage":
    case "/reasoning": {
      try {
        const r = await fetch("/api/slash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commandString: clean, agent: "codex" }),
        });
        const d = await r.json();
        const outText = d.text ?? d.error ?? "(ready)";
        setMsgs((m) => [...m, { role: "assistant", text: outText, ts: Date.now() }]);
      } catch (e) {
        setMsgs((m) => [...m, { role: "assistant", text: `[slash error] ${String(e)}`, ts: Date.now() }]);
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
export default function CodexPanel() {
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState("");
  const [ultracode, setUltracode] = useState(false);
  const [lastLogged, setLastLogged] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const interimRef = useRef<string>("");

  /* ─── Slash autocomplete ────────────────────────────────────────── */
  const [showSlash, setShowSlash] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  /* --- Load persisted messages (global store → legacy fallback) --- */
  useEffect(() => {
    setLoaded(false);
    try {
      // Primary: global localStorage store (hydrated by ChatProvider)
      let raw = localStorage.getItem("chat:local:global");
      if (raw) {
        const global = JSON.parse(raw);
        if (global["codex"] && global["codex"].length > 0) {
          setMsgs(global["codex"]);
          queueMicrotask(() => setLoaded(true));
          return;
        }
        if (global["claude"] && global["claude"].length > 0) {
          setMsgs(global["claude"]);
          queueMicrotask(() => setLoaded(true));
          return;
        }
      }
      // Fallback: legacy panel localStorage
      raw = localStorage.getItem(STORAGE_KEY);
      setMsgs(raw ? JSON.parse(raw) : []);
    } catch {
      setMsgs([]);
    }
    queueMicrotask(() => setLoaded(true));
  }, []);

  /* --- Persist to global store + legacy key on every mutation --- */
  useEffect(() => {
    if (!loaded) return;
    try {
      // Write to legacy key (backward compat)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-50)));
      // Sync to global store so other consumers (UnifiedChat, AntigravityView) see it
      const global = JSON.parse(localStorage.getItem("chat:local:global") || "{}");
      global["codex"] = msgs;
      global["claude"] = msgs;
      localStorage.setItem("chat:local:global", JSON.stringify(global));
    } catch {
      /* quota */
    }
  }, [msgs, loaded]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [msgs, partial]);

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
        taRef.current &&
        !taRef.current.contains(e.target as Node)
      ) {
        setShowSlash(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSlash]);

  /* ─── Stream reader (Codex NDJSON) ─────────────────────────────── */
  async function streamCodex(prompt: string): Promise<string> {
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    let acc = "";
    const r = await fetch("/api/codex/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, ultracode }),
      signal: ctrl.signal,
    });
    if (!r.body) throw new Error("no body");
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.type === "stream_event" && evt.event?.delta?.text) {
            acc += evt.event.delta.text;
            setPartial(acc);
          } else if (evt.type === "result" && typeof evt.result === "string") {
            if (!acc) {
              acc = evt.result;
              setPartial(acc);
            }
          }
        } catch {
          /* skip */
        }
      }
    }
    return acc;
  }

  /* ─── INPUT UNLOCK: Send handler ────────────────────────────────── */
  const send = async () => {
    const prompt = input.trim();
    if (!prompt) return;
    setInput("");

    // ── Slash command interceptor ──
    if (prompt.startsWith("/")) {
      setShowSlash(false);
      const handled = await executeClientSlash(prompt, msgs, setMsgs, streaming, setStreaming, ctrlRef, streamCodex);
      if (handled) return;
    }

    // ── INPUT UNLOCK: abort active stream, then dispatch ──
    if (streaming) {
      ctrlRef.current?.abort();
      setStreaming(false);
      setPartial("");
      // Brief pause for abort to propagate
      await new Promise((r) => setTimeout(r, 50));
    }

    const userMsg: Msg = { role: "user", text: prompt, ts: Date.now() };
    setMsgs((m) => [...m, userMsg]);
    setPartial("");
    setStreaming(true);
    interimRef.current = "";
    let reply = "";
    try {
      reply = await streamCodex(prompt);
    } catch (e) {
      reply = `[error: ${String(e)}]`;
    }
    setMsgs((m) => [
      ...m,
      { role: "assistant", text: reply || "(ready)", ts: Date.now() },
    ]);
    setPartial("");
    setStreaming(false);
    if (reply && reply.trim()) {
      logToVault(prompt, reply);
      setLastLogged(
        new Date().toLocaleTimeString("en-GB", { hour12: false })
      );
    }
  };

  function stop() {
    ctrlRef.current?.abort();
    setStreaming(false);
    setPartial("");
  }

  function handleVoice(t: string, opts: { final: boolean }) {
    if (opts.final) {
      const base = interimRef.current
        ? input.replace(/\s*\[voice\][^]*$/, "")
        : input;
      interimRef.current = "";
      const next = (
        base +
        (base.endsWith(" ") || base.length === 0 ? "" : " ") +
        t
      ).trim();
      setInput(next);
    } else {
      interimRef.current = t;
      const base = input.replace(/\s*\[voice\][^]*$/, "");
      setInput(`${base}${base.length ? " " : ""}[voice] ${t}`.trim());
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
    if (e.key === "Escape" && streaming) stop();
  };

  /* ─── Slash popover selection ───────────────────────────────────── */
  const handleSlashSelect = (cmd: string) => {
    setInput(cmd + " ");
    setShowSlash(false);
    taRef.current?.focus();
  };

  const accent = "#22c55e";

  return (
    <div
      className="panel flex flex-col overflow-hidden"
      style={{ height: "min(72vh, 800px)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--panel-border)]">
        <div className="flex items-center gap-2">
          <AgentAvatar agent="codex" size={26} pulse={streaming} />
          <span className="text-sm font-medium" style={{ color: accent }}>
            Codex
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setUltracode((v) => !v)}
            disabled={streaming}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11px] uppercase tracking-widest transition disabled:opacity-50"
            style={{
              borderColor: ultracode ? accent : "var(--panel-border)",
              background: ultracode ? `${accent}1a` : "transparent",
              color: ultracode ? accent : "var(--fg-dim)",
            }}
          >
            <Zap size={11} fill={ultracode ? "currentColor" : "none"} />
            Ultracode
          </button>
          {lastLogged && (
            <Link
              href="/memory"
              className="hidden md:flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] hover:text-[var(--fg-dim)]"
            >
              <BookOpen size={11} /> Logged · {lastLogged}
            </Link>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="scroll flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3"
      >
        <AnimatePresence initial={false}>
          {msgs.length === 0 && !streaming && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="h-full grid place-items-center text-center"
            >
              <div className="max-w-md">
                <div className="mx-auto mb-3">
                  <AgentAvatar agent="codex" size={56} />
                </div>
                <h3
                  className="text-lg font-medium"
                  style={{ color: accent }}
                >
                  Chat with Codex
                </h3>
                <p className="mt-2 text-sm text-[var(--fg-dim)] leading-relaxed">
                  Type or use the mic. Every exchange auto-saves to your
                  Obsidian vault. Use <span className="text-amber-400">/commands</span> for system tools.
                </p>
              </div>
            </motion.div>
          )}
          {msgs.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={`flex gap-3 ${
                m.role === "user" ? "flex-row-reverse" : ""
              }`}
            >
              {m.role === "assistant" && (
                <AgentAvatar agent="codex" size={32} />
              )}
              {m.role === "user" && (
                <div className="w-8 h-8 rounded-full grid place-items-center shrink-0 text-[10px] uppercase tracking-widest text-[var(--fg-dim)] border border-[var(--panel-border)]">
                  you
                </div>
              )}
              <div
                className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap ${
                  m.role === "user"
                    ? "rounded-tr-md bg-[rgba(255,255,255,0.05)] border border-[var(--panel-border)] text-[var(--fg)]"
                    : "rounded-tl-md border"
                }`}
                style={
                  m.role === "assistant"
                    ? {
                        background: `linear-gradient(135deg, ${accent}10, transparent 60%)`,
                        borderColor: `${accent}40`,
                        color: "var(--fg)",
                      }
                    : undefined
                }
              >
                {m.text}
              </div>
            </motion.div>
          ))}
          {streaming && (
            <motion.div
              key="partial"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex gap-3"
            >
              <AgentAvatar agent="codex" size={32} pulse />
              <div
                className="max-w-[78%] rounded-2xl rounded-tl-md px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap border"
                style={{
                  background: `linear-gradient(135deg, ${accent}10, transparent 60%)`,
                  borderColor: `${accent}40`,
                  color: "var(--fg)",
                }}
              >
                {partial ? (
                  partial
                ) : (
                  <span className="inline-flex items-center gap-2 text-[var(--fg-dim)]">
                    <span className="inline-flex items-center">
                      <span
                        className="tick live"
                        style={{ color: accent }}
                      />
                      <span
                        className="tick live"
                        style={{ color: accent, animationDelay: ".15s" }}
                      />
                      <span
                        className="tick live"
                        style={{ color: accent, animationDelay: ".3s" }}
                      />
                    </span>
                    Codex thinking
                  </span>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {ultracode && (
        <div
          className="mx-3 mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[11.5px] leading-snug border"
          style={{
            borderColor: `${accent}55`,
            background: `${accent}08`,
            color: "var(--fg)",
          }}
        >
          <AlertTriangle
            size={13}
            className="shrink-0 mt-0.5"
            style={{ color: accent }}
          />
          <div>
            <span className="font-semibold" style={{ color: accent }}>
              Ultracode is on.
            </span>{" "}
            Codex runs at <code>xhigh</code> effort with dynamic workflows.
            Heavy token use.
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-[var(--panel-border)] p-3 relative">
        <div
          className="flex items-end gap-2 rounded-2xl border bg-[rgba(0,0,0,0.25)] p-2 focus-within:border-[var(--panel-border-hot)] transition"
          style={{ borderColor: "var(--panel-border)" }}
        >
          <VoiceButton onTranscript={handleVoice} size={38} />
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder="Message Codex… (⌘+Enter)  type / for commands"
            className="flex-1 bg-transparent outline-none resize-none px-2 py-2 text-[14px] text-[var(--fg)] placeholder:text-[var(--fg-dimmer)]"
          />
          {/* Send / Stop — always focusable, never disabled */}
          {streaming ? (
            <button
              onClick={stop}
              className="px-3 h-[38px] rounded-lg bg-[rgba(248,113,113,0.18)] border border-[rgba(248,113,113,0.45)] text-rose-300 text-sm flex items-center gap-1.5 hover:bg-[rgba(248,113,113,0.28)] transition"
              type="button"
            >
              <Square size={14} /> Stop
            </button>
          ) : (
            <button
              onClick={send}
              className="px-3 h-[38px] rounded-lg flex items-center gap-1.5 text-sm transition"
              style={{
                background: `${accent}24`,
                border: `1px solid ${accent}55`,
                color: accent,
              }}
              type="button"
            >
              <Send size={14} /> Send
            </button>
          )}
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

        <div className="mt-1.5 px-1 flex items-center justify-between text-[10px] text-[var(--fg-dimmer)] uppercase tracking-widest">
          <span>auto-saved to Obsidian</span>
        </div>
      </div>
    </div>
  );
}
