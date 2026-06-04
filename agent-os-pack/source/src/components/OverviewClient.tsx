"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import AgentPortal from "./AgentPortal";
import AgentAvatar from "./AgentAvatar";
import type { AgentKey } from "./AgentAvatar";
import ActivityStream from "./ActivityStream";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";

interface AgentStatus { ok: boolean; model?: string; provider?: string; latencyMs?: number; }
interface VitalsData {
  ts: number;
  claude: AgentStatus; codex: AgentStatus; openclaw: AgentStatus & { agents: string[]; sessions: number };
  chrono: AgentStatus; labyrinth: AgentStatus; antigravity: AgentStatus;
}

const ALL_AGENTS: { key: AgentKey; href: string; title: string; tagline: string; accent: string }[] = [
  { key: "openclaw",    href: "/openclaw",    title: "Kairos",      tagline: "Infrastructure & ops control plane.", accent: "#f472b6" },
  { key: "chrono",      href: "/hermes",      title: "Chrono",      tagline: "Core orchestrator. Sessions, skills, kanban.", accent: "#6c5ce7" },
  { key: "claude",      href: "/claude",      title: "Asta",        tagline: "OpenAI subscription engine. GPT-5.", accent: "#d97757" },
  { key: "labyrinth",   href: "/labyrinth",   title: "Labyrinth",   tagline: "Deep reasoning engine. Research, memory.", accent: "#00b894" },
  { key: "antigravity", href: "/antigravity", title: "Antigravity", tagline: "Go-based multi-agent harness.", accent: "#7c3aed" },
];

export default function OverviewClient() {
  const [v, setV] = useState<VitalsData | null>(null);

  usePollWhileVisible(async () => {
    try {
      const r = await fetch("/api/vitals", { cache: "no-store" });
      if (r.ok) setV(await r.json());
    } catch { /* ignore */ }
  }, 10000);

  const agentModel = (key: string): string | null => {
    if (!v) return null;
    const map: Record<string, () => string | null> = {
      chrono: () => v.chrono?.model ?? null, labyrinth: () => v.labyrinth?.model ?? null,
      claude: () => v.codex?.model ?? null, codex: () => v.codex?.model ?? null,
      openclaw: () => v.openclaw?.model ?? null, antigravity: () => v.antigravity?.model ?? null,
    };
    return map[key]?.() ?? null;
  };

  const isOnline = (key: string) => {
    if (!v) return true;
    const map: Record<string, AgentStatus> = { chrono: v.chrono, labyrinth: v.labyrinth, claude: v.claude, codex: v.codex, openclaw: v.openclaw, antigravity: v.antigravity };
    const s = map[key];
    return !s || s.ok !== false;
  };

  return (
    <div className="space-y-6">
      {/* Agent grid */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="eyebrow mb-0">
            <span className="num">II.</span><span className="line" /><span className="label">Agents · 5 agents · click to open control room</span>
          </div>
          <span className="badge-live">5 online</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {ALL_AGENTS.map((agent) => {
            const model = agentModel(agent.key);
            const metrics = model ? [{ label: "Model", value: model }] : [];
            return (
              <AgentPortal key={agent.key} href={agent.href} title={agent.title} tagline={agent.tagline}
                icon={<AgentAvatar agent={agent.key} size={32} />} accent={agent.accent}
                status={isOnline(agent.key) ? "online" : "degraded"} metrics={metrics} />
            );
          })}
        </div>
      </section>

      <div className="flex items-center gap-4 my-2" style={{ color: "var(--gold)", opacity: 0.4 }}>
        <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
        <span className="text-xs">✦</span>
        <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
      </div>

      {/* Self tools */}
      <section>
        <div className="eyebrow mb-0">
          <span className="num">III.</span><span className="line" /><span className="label">Self · grounded in your Obsidian vault</span>
        </div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <SelfCard href="/goals" title="Goals" tagline="Set targets, tick them off, see the bar fill." accent="#fbbf24" stat="Live · saved to vault" />
          <SelfCard href="/horizon" title="Horizon" tagline="Cron jobs, schedules, and system health at a glance." accent="#F5A623" stat="Live dashboard" />
          <SelfCard href="/journal" title="Journal" tagline="Daily entries, voice or text, one file per day." accent="#a3e635" stat="Daily files in vault" />
        </div>
      </section>

      <div className="flex items-center gap-4 my-2" style={{ color: "var(--gold)", opacity: 0.4 }}>
        <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
        <span className="text-xs">✦</span>
        <div className="flex-1 h-px" style={{ background: "var(--line)" }} />
      </div>

      {/* Activity Stream */}
      <section>
        <div className="eyebrow mb-0">
          <span className="num">IV.</span><span className="line" /><span className="label">Live activity · combined log stream</span>
        </div>
        <div className="mt-3">
          <ActivityStream />
        </div>
      </section>
    </div>
  );
}

function SelfCard({ href, title, tagline, accent, stat }: { href: string; title: string; tagline: string; accent: string; stat: string }) {
  return (
    <Link href={href} className="block group">
      <motion.div whileHover={{ y: -2 }} transition={{ duration: 0.2 }}
        className="surface-card relative overflow-hidden h-full rounded-2xl border p-4" style={{ borderColor: "var(--line-soft)" }}>
        <div className="pointer-events-none absolute -bottom-20 -right-16 w-56 h-56 rounded-full blur-3xl opacity-[0.07] group-hover:opacity-[0.18] transition-opacity duration-500" style={{ background: accent }} />
        <div className="flex items-start justify-between mb-3">
          <div className="grid place-items-center w-10 h-10 rounded-xl" style={{ background: `${accent}14`, color: accent, border: `1px solid ${accent}25`, boxShadow: `0 0 20px -10px ${accent}` }}>
            <span style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 600, fontSize: "1.1rem" }}>{title[0]}</span>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: accent, opacity: 0.7 }}>→</span>
        </div>
        <h3 className="action-title">{title}</h3>
        <p className="mt-1.5 text-[0.85rem] leading-relaxed" style={{ color: "var(--cream-soft)" }}>{tagline}</p>
        <div className="mt-3 action-tag">{stat}</div>
      </motion.div>
    </Link>
  );
}
