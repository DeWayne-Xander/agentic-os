"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Square, BookOpen } from "lucide-react";
import Link from "next/link";
import AgentAvatar from "./AgentAvatar";
import VoiceButton from "./VoiceButton";

interface Msg { role: "user" | "assistant"; text: string; ts: number; }

const storageKey = () => "agentic-os-chat-v2:openclaw";
const ANSI_STRIP = /\x1B\[[0-?]*[ -\/]*[@-~]|\x1B\][^\x07\x1B]*(\x07|\x1B\\)|\x1B[@-_]/g;

function cleanText(text: string): string {
  return text.replace(ANSI_STRIP, "").replace(/\r/g, "").trim();
}

function logToVault(user: string, reply: string) {
  fetch("/api/memory/log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent: "openclaw", kind: "chat", user, reply }),
  }).catch(() => {});
}

export default function OpenClawPanel() {
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [partial, setPartial] = useState("");
  const [lastLogged, setLastLogged] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const interimRef = useRef<string>("");

  useEffect(() => {
    setLoaded(false);
    try {
      const raw = localStorage.getItem(storageKey());
      setMsgs(raw ? JSON.parse(raw) : []);
    } catch { setMsgs([]); }
    queueMicrotask(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(storageKey(), JSON.stringify(msgs.slice(-50))); } catch {}
  }, [msgs, loaded]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, partial]);

  async function send() {
    const prompt = input.trim();
    if (!prompt || streaming) return;
    const userMsg: Msg = { role: "user", text: prompt, ts: Date.now() };
    setMsgs((m) => [...m, userMsg]);
    setInput("");
    setPartial("");
    setStreaming(true);
    interimRef.current = "";
    let reply = "";
    try {
      const r = await fetch("/api/openclaw/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: ctrlRef.current?.signal,
      });
      const j = await r.json();
      reply = cleanText(String(j.text ?? "(ready)"));
    } catch (e) {
      reply = cleanText(`[error: ${String(e)}]`);
    }
    setMsgs((m) => [...m, { role: "assistant", text: reply || "(ready)", ts: Date.now() }]);
    setPartial("");
    setStreaming(false);
    if (reply && reply.trim()) {
      logToVault(prompt, reply);
      setLastLogged(new Date().toLocaleTimeString("en-GB", { hour12: false }));
    }
  }

  function stop() { ctrlRef.current?.abort(); setStreaming(false); setPartial(""); }

  function handleVoice(t: string, opts: { final: boolean }) {
    if (opts.final) {
      const base = interimRef.current ? input.replace(/\s*\[voice\][^]*$/, "") : input;
      interimRef.current = "";
      const next = (base + (base.endsWith(" ") || base.length === 0 ? "" : " ") + t).trim();
      setInput(next);
    } else {
      interimRef.current = t;
      const base = input.replace(/\s*\[voice\][^]*$/, "");
      setInput(`${base}${base.length ? " " : ""}[voice] ${t}`.trim());
    }
  }

  const accent = "#f472b6";

  return (
    <div className="panel flex flex-col overflow-hidden" style={{ height: "min(72vh, 800px)" }}>
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--panel-border)]">
        <div className="flex items-center gap-2">
          <AgentAvatar agent="openclaw" size={26} pulse={streaming} />
          <span className="text-sm font-medium" style={{ color: accent }}>Kairos</span>
        </div>
        <div className="flex items-center gap-2">
          {lastLogged && (
            <Link href="/memory" className="hidden md:flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] hover:text-[var(--fg-dim)]">
              <BookOpen size={11} /> Logged · {lastLogged}
            </Link>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="scroll flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
        <AnimatePresence initial={false}>
          {msgs.length === 0 && !streaming && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full grid place-items-center text-center">
              <div className="max-w-md">
                <div className="mx-auto mb-3"><AgentAvatar agent="openclaw" size={56} /></div>
                <h3 className="text-lg font-medium" style={{ color: accent }}>Chat with Kairos</h3>
                <p className="mt-2 text-sm text-[var(--fg-dim)] leading-relaxed">
                  Local orchestration surface. Chat history stays with Kairos and auto-saves to your Obsidian vault.
                </p>
              </div>
            </motion.div>
          )}
          {msgs.map((m, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
              className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              {m.role === "assistant" && <AgentAvatar agent="openclaw" size={32} />}
              {m.role === "user" && (
                <div className="w-8 h-8 rounded-full grid place-items-center shrink-0 text-[10px] uppercase tracking-widest text-[var(--fg-dim)] border border-[var(--panel-border)]">you</div>
              )}
              <div className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "rounded-tr-md bg-[rgba(255,255,255,0.05)] border border-[var(--panel-border)] text-[var(--fg)]"
                  : "rounded-tl-md border"
              }`}
                style={m.role === "assistant" ? { background: `linear-gradient(135deg, ${accent}10, transparent 60%)`, borderColor: `${accent}40`, color: "var(--fg)" } : undefined}>
                {m.text}
              </div>
            </motion.div>
          ))}
          {streaming && (
            <motion.div key="partial" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
              <AgentAvatar agent="openclaw" size={32} pulse />
              <div className="max-w-[78%] rounded-2xl rounded-tl-md px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap border"
                style={{ background: `linear-gradient(135deg, ${accent}10, transparent 60%)`, borderColor: `${accent}40`, color: "var(--fg)" }}>
                {partial ? partial : (
                  <span className="inline-flex items-center gap-2 text-[var(--fg-dim)]">
                    <span className="inline-flex items-center">
                      <span className="tick live" style={{ color: accent }} />
                      <span className="tick live" style={{ color: accent, animationDelay: ".15s" }} />
                      <span className="tick live" style={{ color: accent, animationDelay: ".3s" }} />
                    </span>
                    Kairos thinking
                  </span>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="border-t border-[var(--panel-border)] p-3">
        <div className="flex items-end gap-2 rounded-2xl border bg-[rgba(0,0,0,0.25)] p-2 focus-within:border-[var(--panel-border-hot)] transition"
             style={{ borderColor: "var(--panel-border)" }}>
          <VoiceButton onTranscript={handleVoice} size={38} />
          <textarea ref={taRef} value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
              if (e.key === "Escape" && streaming) stop();
            }}
            rows={2} placeholder="Message Kairos… (⌘+Enter)"
            className="flex-1 bg-transparent outline-none resize-none px-2 py-2 text-[14px] text-[var(--fg)] placeholder:text-[var(--fg-dimmer)]" />
          {streaming ? (
            <button onClick={stop}
              className="px-3 h-[38px] rounded-lg bg-[rgba(248,113,113,0.18)] border border-[rgba(248,113,113,0.45)] text-rose-300 text-sm flex items-center gap-1.5 hover:bg-[rgba(248,113,113,0.28)] transition">
              <Square size={14} /> Stop
            </button>
          ) : (
            <button onClick={send} disabled={!input.trim()}
              className="px-3 h-[38px] rounded-lg flex items-center gap-1.5 text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: `${accent}24`, border: `1px solid ${accent}55`, color: accent }}>
              <Send size={14} /> Send
            </button>
          )}
        </div>
        <div className="mt-1.5 px-1 flex items-center justify-between text-[10px] text-[var(--fg-dimmer)] uppercase tracking-widest">
          <span>auto-saved to Obsidian</span>
        </div>
      </div>
    </div>
  );
}
