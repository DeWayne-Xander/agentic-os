"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Radio, Zap, Brain, Wrench, Sparkles, Terminal, AlertTriangle, Info, CheckCircle2 } from "lucide-react";
import Panel from "./Panel";

interface Entry { ts: number; agent: string; text: string; level?: string; }

const AGENT_COLORS: Record<string, string> = {
  chrono: "#6c5ce7", hermes: "#6c5ce7", openclaw: "#f472b6", kairos: "#f472b6",
  labyrinth: "#00b894", claude: "#d97757", asta: "#d97757", codex: "#22c55e",
  antigravity: "#7c3aed", memory: "#22d3ee", system: "#a855f5",
};

const AGENT_ICONS: Record<string, React.ReactNode> = {
  chrono: <Zap size={12} />, hermes: <Zap size={12} />, openclaw: <Wrench size={12} />, kairos: <Wrench size={12} />,
  labyrinth: <Brain size={12} />, claude: <Sparkles size={12} />, asta: <Sparkles size={12} />, codex: <Terminal size={12} />,
  antigravity: <RocketIcon size={12} />, memory: <Brain size={12} />, system: <Terminal size={12} />,
};

function RocketIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09Z"/>
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z"/>
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>
    </svg>
  );
}

function LevelIcon({ level }: { level?: string }) {
  switch (level) {
    case "error": case "err": return <AlertTriangle size={11} className="text-rose-400" />;
    case "warn": case "warning": return <AlertTriangle size={11} className="text-amber-400" />;
    case "success": case "ok": return <CheckCircle2 size={11} className="text-emerald-400" />;
    default: return <Info size={11} className="text-[var(--cream-dim)]" />;
  }
}

export default function ActivityStream() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const fetchEntries = useCallback(async () => {
    try {
      const r = await fetch("/api/activity", { cache: "no-store" });
      const j = await r.json();
      if (j.entries) {
        setEntries(j.entries);
        setTotalCount(j.total ?? j.entries.length);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchEntries();
    const t = setInterval(fetchEntries, 5000);
    return () => clearInterval(t);
  }, [fetchEntries]);

  const dotColor = (agent: string) => AGENT_COLORS[agent] ?? "var(--cream-dim)";
  const iconFor = (agent: string) => AGENT_ICONS[agent] ?? <Radio size={12} />;

  return (
    <Panel
      title="Activity Stream"
      accent="system"
      icon={<Radio size={14} className="animate-pulse" />}
      actions={
        <div className="flex items-center gap-2">
          <span className="pill pill-info">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--emerald)" }} />
            {totalCount} events
          </span>
        </div>
      }
      className="min-h-[420px]"
    >
      <div className="scroll stream-fade overflow-y-auto h-full min-h-0 pr-1">
        <AnimatePresence initial={false}>
          {entries.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 rounded-2xl mb-4 grid place-items-center" style={{ background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.15)" }}>
                <Radio size={24} style={{ color: "var(--gold)", opacity: 0.5 }} />
              </div>
              <div className="text-sm font-medium" style={{ color: "var(--cream-dim)" }}>Waiting for live activity…</div>
              <div className="text-xs mt-1" style={{ color: "var(--cream-mute)" }}>Agent logs, vault updates, and cron events will appear here in real-time.</div>
            </motion.div>
          )}
          {entries.map((e, i) => (
            <motion.div
              key={`${e.ts}-${i}`}
              initial={{ opacity: 0, x: -10, height: 0 }}
              animate={{ opacity: 1, x: 0, height: "auto" }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.3, delay: Math.min(i * 0.015, 0.3) }}
              className="flex items-start gap-2.5 py-2 px-2 rounded-lg border-b border-[rgba(255,255,255,0.03)] last:border-0 hover:bg-[rgba(255,255,255,0.02)] transition-colors group"
            >
              <div className="shrink-0 mt-0.5 w-5 h-5 rounded-md grid place-items-center" style={{ background: `${dotColor(e.agent)}15`, color: dotColor(e.agent) }}>
                {iconFor(e.agent)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-mono shrink-0" style={{ color: "var(--cream-mute)" }}>
                    {new Date(e.ts).toLocaleTimeString("en-GB", { hour12: false })}
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider shrink-0 w-20 truncate" style={{ color: dotColor(e.agent) }}>
                    {e.agent}
                  </span>
                  <LevelIcon level={e.level} />
                </div>
                <div className={`text-[11.5px] leading-relaxed font-[var(--font-geist-mono)] truncate ${
                  e.level === "err" ? "text-rose-300/80" :
                  e.level === "warn" ? "text-amber-300/80" :
                  "text-[var(--cream-soft)]"
                }`}>
                  {e.text}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Panel>
  );
}
