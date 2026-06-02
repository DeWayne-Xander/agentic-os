"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Brain, Target, BookOpen, ArrowUpRight } from "lucide-react";
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
  { key: "claude",      href: "/claude",      title: "Codex",              tagline: "OpenAI subscription engine. GPT-5 via ChatGPT OAuth.",         accent: "#22c55e" },
  { key: "openclaw",    href: "/openclaw",    title: "Kairos",             tagline: "Infrastructure & ops control plane. Process supervision, cron, daemons, filesystem governance.",  accent: "#f472b6" },
  { key: "chrono",      href: "/hermes",      title: "Chrono",             tagline: "Core orchestrator. Sessions, skills, kanban, plugins, Telegram.",        accent: "#6c5ce7" },
  { key: "labyrinth",   href: "/labyrinth",   title: "Labyrinth",         tagline: "Deep reasoning engine (DeepSeek-R1). Architectural analysis, research, memory synthesis.", accent: "#00b894" },
  { key: "antigravity", href: "/antigravity", title: "Antigravity",        tagline: "Go-based multi-agent harness, plugins, extensions.",          accent: "#7c3aed" },
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
    <div className="space-y-4">
      <Vitals />

      <div className="divider my-6"><span className="rule" /><span className="ornament">✦</span><span className="rule" /></div>

      <section>
        <div className="eyebrow mb-3">
          <span className="num">II.</span>
          <span className="line" />
          <span className="label">Agents · 6 agents · click to open control room</span>
        </div>
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

      <div className="divider my-6"><span className="rule" /><span className="ornament">✦</span><span className="rule" /></div>

      <section>
        <div className="eyebrow mb-3">
          <span className="num">III.</span>
          <span className="line" />
          <span className="label">Self · grounded in your Obsidian vault</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          <SelfCard href="/goals" title="Goals" tagline="Set the targets, tick them off, see the % bar fill." icon={<Target size={20} />} accent="#fbbf24" stat={recentCount > 0 ? "Live · saved to vault" : "Live"} />
          <SelfCard href="/journal" title="Journal" tagline="Daily entries, voice or text, one file per day." icon={<BookOpen size={20} />} accent="#a3e635" stat="Daily files in vault" />
          <SelfCard href="/memory" title="Memory" tagline="Every chat auto-logged. Full vault search." icon={<Brain size={20} />} accent="#22d3ee" stat="Auto-logged to vault" />
        </div>
      </section>

      <div className="divider my-6"><span className="rule" /><span className="ornament">✦</span><span className="rule" /></div>

      <section>
        <div className="eyebrow mb-3">
          <span className="num">IV.</span>
          <span className="line" />
          <span className="label">Live activity · combined log stream</span>
        </div>
        <ActivityStream />
      </section>
    </div>
  );
}

function SelfCard({ href, title, tagline, icon, accent, stat }: { href: string; title: string; tagline: string; icon: React.ReactNode; accent: string; stat: string }) {
  return (
    <Link href={href} className="block group">
      <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.25 }} className="surface-card relative overflow-hidden h-full">
        <div className="pointer-events-none absolute -bottom-16 -right-12 w-48 h-48 rounded-full blur-3xl opacity-15 group-hover:opacity-30 transition" style={{ background: accent }} />
        <div className="relative flex items-start justify-between mb-3">
          <div className="grid place-items-center w-10 h-10 rounded-md" style={{ background: `${accent}1a`, color: accent, border: `1px solid ${accent}30`, boxShadow: `0 0 18px -10px ${accent}` }}>{icon}</div>
          <ArrowUpRight size={14} className="opacity-50 group-hover:opacity-100 transition" style={{ color: "var(--cream-dim)" }} />
        </div>
        <div className="relative">
          <h3 className="action-title">{title}</h3>
          <p className="mt-1.5 action-desc">{tagline}</p>
          <div className="mt-4 action-tag">{stat}</div>
        </div>
      </motion.div>
    </Link>
  );
}
