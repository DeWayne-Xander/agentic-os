"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Brain, Target, BookOpen, ArrowUpRight, ChevronRight,
  Zap, Shield, Cpu, Activity, Radio, Clock, CheckCircle2,
  AlertCircle, XCircle, Terminal, Layers, MessageSquare,
  Plug, Wrench, Globe, Database, Lock, Eye, Settings,
  TrendingUp, Users, Sparkles, CircleDot,
} from "lucide-react";
import AgentPortal from "./AgentPortal";
import AgentAvatar from "./AgentAvatar";
import type { AgentKey } from "./AgentAvatar";
import Vitals from "./Vitals";
import ActivityStream from "./ActivityStream";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";

interface AgentStatus { ok: boolean; model?: string; provider?: string; latencyMs?: number; gateway?: string; degraded?: boolean; busy?: boolean; version?: string; }
interface VitalsData {
  ts: number;
  claude: AgentStatus;
  codex: AgentStatus & { model?: string };
  openclaw: AgentStatus & { agents: string[]; sessions: number; };
  chrono: AgentStatus;
  labyrinth: AgentStatus & { latencyMs: number };
  antigravity: AgentStatus & { model?: string };
}

const ALL_AGENTS: { key: AgentKey; href: string; title: string; tagline: string; accent: string; icon: React.ReactNode; status: "online" | "busy" | "degraded" }[] = [
  { key: "openclaw",    href: "/openclaw",    title: "Kairos",      tagline: "Infrastructure & ops control plane. Process supervision, cron, daemons, filesystem governance.", accent: "#f472b6", icon: <Wrench size={20} />,       status: "online" },
  { key: "chrono",      href: "/hermes",      title: "Chrono",      tagline: "Core orchestrator. Sessions, skills, kanban, Telegram, gateway guardian.", accent: "#6c5ce7", icon: <Zap size={20} />,           status: "online" },
  { key: "claude",      href: "/claude",      title: "Asta",        tagline: "OpenAI subscription engine. GPT-5 via ChatGPT OAuth. Deep research & code.", accent: "#d97757", icon: <Sparkles size={20} />,     status: "online" },
  { key: "labyrinth",   href: "/labyrinth",   title: "Labyrinth",   tagline: "Deep reasoning engine. Architectural analysis, research, memory synthesis.", accent: "#00b894", icon: <Brain size={20} />,         status: "online" },
  { key: "antigravity", href: "/antigravity", title: "Antigravity", tagline: "Go-based multi-agent harness. Plugins, extensions, system-level automation.", accent: "#7c3aed", icon: <Rocket size={20} />,       status: "online" },
];

function Rocket({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09Z"/>
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z"/>
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>
    </svg>
  );
}

function StatusPill({ status, accent }: { status: string; accent: string }) {
  const config = {
    online:  { icon: <CheckCircle2 size={10} />, label: "Online",  glow: accent },
    busy:    { icon: <CircleDot size={10} />,     label: "Busy",    glow: "#f59e0b" },
    degraded:{ icon: <AlertCircle size={10} />,   label: "Degraded", glow: "#ef4444" },
    offline: { icon: <XCircle size={10} />,       label: "Offline", glow: "#6b7280" },
  }[status] ?? { icon: <CircleDot size={10} />, label: status, glow: "#6b7280" };

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
      style={{ background: `${config.glow}18`, color: config.glow, border: `1px solid ${config.glow}30` }}>
      {config.icon} {config.label}
    </span>
  );
}

const ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 12 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as const } },
};

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

  const agentModel = (key: string): string | null => {
    if (!v) return null;
    const map: Record<string, () => string | null> = {
      chrono: () => v.chrono?.model ?? null,
      labyrinth: () => v.labyrinth?.model ?? null,
      claude: () => v.codex?.model ?? null,
      codex: () => v.codex?.model ?? null,
      openclaw: () => v.openclaw?.model ?? null,
      antigravity: () => v.antigravity?.model ?? null,
    };
    return map[key]?.() ?? null;
  };

  const getStatus = (key: string): "online" | "busy" | "degraded" => {
    if (!v) return "online"; // Default to online when loading
    const map: Record<string, AgentStatus> = {
      chrono: v.chrono, labyrinth: v.labyrinth, claude: v.claude,
      codex: v.codex, openclaw: v.openclaw, antigravity: v.antigravity,
    };
    const s = map[key];
    if (!s) return "online";
    if ("ok" in s && !s.ok) return "degraded";
    if ("busy" in s && (s as any).busy) return "busy";
    return "online";
  };

  return (
    <div className="space-y-6">
      {/* Vitals bar */}
      <motion.div variants={ITEM_VARIANTS} initial="hidden" animate="show">
        <Vitals />
      </motion.div>

      <Divider />

      {/* Mobile Agent Grid */}
      <section className="md:hidden">
        <SectionEyebrow num="II." label="Agents" extra={<span className="badge-live">5 online</span>} />
        <motion.div className="grid grid-cols-1 sm:grid-cols-2 gap-3" variants={ITEM_VARIANTS} initial="hidden" animate="show">
          {ALL_AGENTS.map((agent, i) => (
            <motion.div key={agent.key} variants={ITEM_VARIANTS} transition={{ delay: i * 0.06 }}>
              <Link href={agent.href} className="block rounded-2xl border p-4 surface-card active:scale-[0.98] transition-all duration-200"
                style={{ borderColor: "var(--line-soft)" }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="grid place-items-center w-12 h-12 rounded-xl"
                    style={{ background: `${agent.accent}14`, color: agent.accent, border: `1px solid ${agent.accent}22`, boxShadow: `0 0 24px -8px ${agent.accent}` }}>
                    <AgentAvatar agent={agent.key} size={28} />
                  </div>
                  <StatusPill status={getStatus(agent.key)} accent={agent.accent} />
                </div>
                <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 600, fontSize: "1.05rem", color: "var(--cream)", letterSpacing: "-0.02em" }}>
                  {agent.title}
                </div>
                <div className="mt-1.5 text-[11px] leading-snug line-clamp-2" style={{ color: "var(--cream-dim)" }}>
                  {agent.tagline}
                </div>
                <div className="mt-3 flex items-center gap-1.5" style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: "0.6rem", letterSpacing: "0.14em", textTransform: "uppercase", color: agent.accent, opacity: 0.7 }}>
                  Open <ChevronRight size={10} />
                </div>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* Desktop Agent Grid */}
      <section className="hidden md:block">
        <SectionEyebrow num="II." label="Agents · 5 agents · click to open control room" />
        <motion.div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" variants={ITEM_VARIANTS} initial="hidden" animate="show">
          {ALL_AGENTS.map((agent, i) => {
            const model = agentModel(agent.key);
            const metrics = model ? [{ label: "Model", value: model }] : [];
            return (
              <motion.div key={agent.key} variants={ITEM_VARIANTS} transition={{ delay: i * 0.06 }}>
                <AgentPortal
                  href={agent.href}
                  title={agent.title}
                  tagline={agent.tagline}
                  icon={<AgentAvatar agent={agent.key} size={32} />}
                  accent={agent.accent}
                  status={getStatus(agent.key)}
                  metrics={metrics}
                />
              </motion.div>
            );
          })}
        </motion.div>
      </section>

      <Divider />

      {/* Self tools */}
      <section>
        <SectionEyebrow num="III." label="Self · grounded in your Obsidian vault" />
        <motion.div className="grid grid-cols-1 md:grid-cols-3 gap-3" variants={ITEM_VARIANTS} initial="hidden" animate="show">
          <motion.div variants={ITEM_VARIANTS}><SelfCard href="/goals" title="Goals" tagline="Set targets, tick them off, see the bar fill." icon={<Target size={20} />} accent="#fbbf24" stat={recentCount > 0 ? `${recentCount} active` : "Live"} /></motion.div>
          <motion.div variants={ITEM_VARIANTS}><SelfCard href="/horizon" title="Horizon" tagline="Cron jobs, schedules, and system health at a glance." icon={<Activity size={20} />} accent="#F5A623" stat="Live dashboard" /></motion.div>
          <motion.div variants={ITEM_VARIANTS}><SelfCard href="/journal" title="Journal" tagline="Daily entries, voice or text, one file per day." icon={<BookOpen size={20} />} accent="#a3e635" stat="Daily files in vault" /></motion.div>
        </motion.div>
      </section>

      <Divider />

      {/* Live Activity Stream */}
      <section>
        <SectionEyebrow num="IV." label="Live activity · combined log stream" extra={
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--emerald)" }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--emerald)" }} />
            Real-time
          </span>
        } />
        <ActivityStream />
      </section>
    </div>
  );
}

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
    <div className="flex items-center gap-4 my-2" style={{ color: "var(--gold)", opacity: 0.4 }}>
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
        whileHover={{ y: -3, scale: 1.01 }}
        transition={{ duration: 0.2 }}
        className="surface-card relative overflow-hidden h-full rounded-2xl border p-5"
        style={{ borderColor: "var(--line-soft)" }}
      >
        <div className="pointer-events-none absolute -bottom-20 -right-16 w-56 h-56 rounded-full blur-3xl opacity-[0.07] group-hover:opacity-[0.18] transition-opacity duration-500" style={{ background: accent }} />
        <div className="relative flex items-start justify-between mb-4">
          <div className="grid place-items-center w-11 h-11 rounded-xl" style={{
            background: `${accent}14`, color: accent,
            border: `1px solid ${accent}25`,
            boxShadow: `0 0 20px -10px ${accent}`,
          }}>
            {icon}
          </div>
          <ArrowUpRight size={14} className="opacity-30 group-hover:opacity-70 transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" style={{ color: "var(--cream-dim)" }} />
        </div>
        <div className="relative">
          <h3 className="action-title text-[1.05rem]">{title}</h3>
          <p className="mt-2 text-[0.85rem] leading-relaxed" style={{ color: "var(--cream-soft)" }}>{tagline}</p>
          <div className="mt-4 action-tag">{stat}</div>
        </div>
      </motion.div>
    </Link>
  );
}
