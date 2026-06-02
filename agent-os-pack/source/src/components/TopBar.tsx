"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import CommandPalette from "./CommandPalette";

interface PageMeta { numeral: string; label: string; title: string; sub: string; }

const TITLES: Record<string, PageMeta> = {
  "/":            { numeral: "I.",    label: "Mission Control",       title: "Mission Control",         sub: "6 agents · Phoenix, AZ (MST)" },
  "/claude":      { numeral: "II.",   label: "Agent · Codex",         title: "Codex",                   sub: "Native Codex streaming channel backed by ChatGPT OAuth." },
  "/openclaw":    { numeral: "III.",  label: "Agent · Kairos",        title: "Kairos",                  sub: "Infrastructure & ops control plane. Process supervision, cron, daemons, filesystem, network." },
  "/hermes":      { numeral: "IV.",   label: "Agent · Chrono",        title: "Chrono",                  sub: "Core orchestrator. Sessions, skills, kanban, plugins. Phoenix, AZ." },
  "/labyrinth":   { numeral: "V.",    label: "Agent · Labyrinth",    title: "Labyrinth",               sub: "Deep reasoning engine (DeepSeek-R1). Architectural analysis, research, memory synthesis." },
  "/gemini":      { numeral: "V.",    label: "Agent · Labyrinth",    title: "Labyrinth",               sub: "Deep reasoning engine. Chain-of-thought analysis, research, synthesis." },
  "/antigravity": { numeral: "VI.",   label: "Agent · Antigravity",   title: "Antigravity",             sub: "Go-based, multi-agent harness, plugins." },
  "/codex":       { numeral: "VII.",  label: "Agent · Codex",         title: "Codex",                   sub: "OpenAI's coding agent. Chat, goals, preview." },
  "/goals":       { numeral: "VIII.", label: "Self · Goals",          title: "Goals",                   sub: "Set targets. Tick them off. Watch the bar fill." },
  "/journal":     { numeral: "IX.",   label: "Self · Journal",        title: "Journal",                 sub: "Daily entries with voice or text." },
  "/memory":      { numeral: "X.",    label: "Self · Memory",         title: "Memory",                  sub: "Search your Obsidian vault. All conversations auto-logged." },
  "/guide":       { numeral: "XI.",   label: "Build · Your Own",      title: "Build Your Own",          sub: "Step-by-step guide." },
};

export default function TopBar() {
  const pathname = usePathname();
  const t = TITLES[pathname] ?? TITLES["/"];
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    const set = () => setTime(new Date().toLocaleTimeString("en-US", { hour12: true, hour: "2-digit", minute: "2-digit", timeZone: "America/Phoenix" }) + " MST");
    set();
    const i = setInterval(set, 1000 * 15);
    return () => clearInterval(i);
  }, []);

  return (
    <header className="flex items-start justify-between gap-6 mb-6">
      <motion.div key={pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="min-w-0">
        <div className="eyebrow"><span className="num">{t.numeral}</span><span className="line" /><span className="label">{t.label}</span></div>
        <h1 className="page-title">{t.title}</h1>
        <p className="page-subtitle">{t.sub}</p>
        <div className="mt-4 status-meta"><span className="hand">{time}</span><span className="mx-2 opacity-40">·</span>Phoenix, AZ</div>
      </motion.div>
      <div className="flex items-center gap-3 pt-2 shrink-0">
        <CommandPalette />
        <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-md border border-[var(--line-soft)] text-[11px]" style={{ color: "var(--cream-dim)", background: "rgba(243,235,218,0.02)" }}>
          <span className="inline-flex">
            <span className="tick live" style={{ color: "var(--emerald)" }} />
            <span className="tick live" style={{ color: "var(--gold)", animationDelay: ".15s" }} />
            <span className="tick live" style={{ color: "var(--emerald)", animationDelay: ".3s" }} />
            <span className="tick live" style={{ color: "var(--gold-soft)", animationDelay: ".45s" }} />
          </span>
          <span className="uppercase tracking-widest" style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 600 }}>6 agents</span>
        </div>
      </div>
    </header>
  );
}
