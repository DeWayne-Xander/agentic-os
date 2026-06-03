"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Brain, Target, BookOpen, ArrowUpRight, ChevronRight } from "lucide-react";
import AgentPortal from "./AgentPortal";
import AgentAvatar from "./AgentAvatar";
import type { AgentKey } from "./AgentAvatar";
import Vitals from "./Vitals";
import ActivityStream from "./ActivityStream";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";

interface VitalsData {
  ts: number;
  claude: { ok: boolean; version: string; latencyMs: number };
  openclaw: { ok: boolean; gateway: string; degraded: boolean; busy?: boolean; agents: string[]; sessions: number };
  chrono: { ok: boolean; model: string; provider: string };
  labyrinth: { ok: boolean; model: string; latencyMs: number };
  antigravity: { ok: boolean; version: string; latencyMs: number };
}

const ALL_AGENTS: { key: AgentKey; href: string; title: string; tagline: string; accent: string }[] = [
  { key: "claude",      href: "/claude",      title: "Codex",       tagline: "OpenAI subscription engine. GPT-5 via ChatGPT OAuth.",         accent: "#22c55e" },
  { key: "openclaw",    href: "/openclaw",    title: "Kairos",      tagline: "Infrastructure & ops. Process supervision, cron, daemons.",   accent: "#f472b6" },
  { key: "chrono",      href: "/hermes",      title: "Chrono",      tagline: "Core orchestrator. Sessions, skills, kanban, Telegram.",      accent: "#6c5ce7" },
  { key: "labyrinth",   href: "/labyrinth",   title: "Labyrinth",  tagline: "Deep reasoning engine. Research, memory synthesis.",          accent: "#00b894" },
  { key: "antigravity", href: "/antigravity", title: "Antigravity", tagline: "Go-based multi-agent harness, plugins, extensions.",        accent: "#7c3aed" },
];

export default function Overview() {
  const [v, setV] = useState<VitalsData | null>(null);
  const [recentCount, setRecentCount] = useState<number>(0);

  usePollWhileVisible(async () => {
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/vitals", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/memory/recent", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);
      setV(r1);
      if (r2?.recent) setRecentCount(r2.recent.length);
    } catch { /* ignore */ }
  }, 10000);

  return (
    <div className="space-y-5">
      {/* Vitals */}
      <Vitals />

      <Divider />

      {/* Mobile: Agent carousel */}
      <section className="md:hidden">
        <SectionEyebrow num="II." label="Agents" extra={<span className="badge-live">5 online</span>} />
        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 snap-x snap-mandatory">
          {ALL_AGENTS.map((agent) => (
            <Link
              key={agent.key}
              href={agent.href}
              className="snap-start shrink-0 w-[180px] rounded-xl border p-4 surface-card active:scale-[0.97] transition-transform"
              style={{ borderColor: "var(--line-soft)" }}
            >
              <div className="flex items-center justify-between mb-3">
                <div
                  className="grid place-items-center w-11 h-11 rounded-xl"
                  style={{
                    background: `${agent.accent}12`,
                    color: agent.accent,
                    border: `1px solid ${agent.accent}22`,
                    boxShadow: `0 0 20px -10px ${agent.accent}`,
                  }}
                >
                  <AgentAvatar agent={agent.key} size={24} />
                </div>
                <span className="status-dot ok" />
              </div>
              <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 500, fontSize: "1rem", color: "var(--cream)", letterSpacing: "-0.02em" }}>
                {agent.title}
              </div>
              <div className="mt-1.5 text-[11px] leading-snug line-clamp-2" style={{ color: "var(--cream-dim)" }}>
                {agent.tagline.split(".")[0]}.
              </div>
              <div className="mt-3 flex items-center gap-1" style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: "0.6rem", letterSpacing: "0.16em", textTransform: "uppercase", color: agent.accent, opacity: 0.7 }}>
                Open <ChevronRight size={10} />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Desktop: Agent grid */}
      <section className="hidden md:block">
        <SectionEyebrow num="II." label="Agents · 6 agents · click to open control room" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {ALL_AGENTS.map((agent) => (
            <AgentPortal
              key={agent.key}
              href={agent.href}
              title={agent.title}
              tagline={agent.tagline}
              icon={<AgentAvatar agent={agent.key} size={28} />}
              accent={agent.accent}
              status="ok"
              metrics={[
                { label: "Model", value: agent.key === "chrono" ? "Owl Alpha" : "—" },
                { label: "Route", value: agent.href },
              ]}
            />
          ))}
        </div>
      </section>

      <Divider />

      {/* Self tools */}
      <section>
        <SectionEyebrow num="III." label="Self · grounded in your Obsidian vault" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          <SelfCard href="/goals" title="Goals" tagline="Set targets, tick them off, see the bar fill." icon={<Target size={20} />} accent="#fbbf24" stat={recentCount > 0 ? "Live · saved to vault" : "Live"} />
          <SelfCard href="/journal" title="Journal" tagline="Daily entries, voice or text, one file per day." icon={<BookOpen size={20} />} accent="#a3e635" stat="Daily files in vault" />
          <SelfCard href="/memory" title="Memory" tagline="Every chat auto-logged. Full vault search." icon={<Brain size={20} />} accent="#22d3ee" stat="Auto-logged to vault" />
        </div>
      </section>

      <Divider />

      {/* Activity */}
      <section>
        <SectionEyebrow num="IV." label="Live activity · combined log stream" />
        <ActivityStream />
      </section>
    </div>
  );
}

/* ─── Shared components ─── */

function SectionEyebrow({ num, label, extra }: { num: string; label: string; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="eyebrow mb-0">
        <span className="num">{num}</span>
        <span className="line" />
        <span className="label">{label}</span>
      </div>
      {extra}
    </div>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-4 my-2" style={{ color: "var(--gold)", opacity: 0.5 }}>
      <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
      <span className="text-xs">✦</span>
      <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
    </div>
  );
}

function SelfCard({ href, title, tagline, icon, accent, stat }: {
  href: string; title: string; tagline: string; icon: React.ReactNode; accent: string; stat: string;
}) {
  return (
    <Link href={href} className="block group">
      <motion.div
        whileHover={{ y: -2 }}
        transition={{ duration: 0.2 }}
        className="surface-card relative overflow-hidden h-full"
      >
        <div className="pointer-events-none absolute -bottom-16 -right-12 w-48 h-48 rounded-full blur-3xl opacity-10 group-hover:opacity-25 transition-opacity" style={{ background: accent }} />
        <div className="relative flex items-start justify-between mb-3">
          <div className="grid place-items-center w-10 h-10 rounded-lg" style={{
            background: `${accent}14`, color: accent,
            border: `1px solid ${accent}25`,
            boxShadow: `0 0 20px -12px ${accent}`,
          }}>
            {icon}
          </div>
          <ArrowUpRight size={14} className="opacity-40 group-hover:opacity-80 transition-opacity" style={{ color: "var(--cream-dim)" }} />
        </div>
        <div className="relative">
          <h3 className="action-title">{title}</h3>
          <p className="mt-1.5 text-[0.88rem] leading-relaxed" style={{ color: "var(--cream-soft)" }}>{tagline}</p>
          <div className="mt-4 action-tag">{stat}</div>
        </div>
      </motion.div>
    </Link>
  );
}
