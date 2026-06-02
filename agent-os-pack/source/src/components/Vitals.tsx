"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, Box, Sparkles, Cpu, Zap, Route } from "lucide-react";
import type { ReactNode } from "react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";

interface VitalsData {
  ts: number;
  claude: { ok: boolean; version: string; latencyMs: number };
  openclaw: { ok: boolean; gateway: string; degraded: boolean; busy?: boolean; agents: string[]; sessions: number; latencyMs: number };
  chrono: { ok: boolean; model: string; provider: string; latencyMs: number };
  labyrinth: { ok: boolean; model: string; latencyMs: number };
  antigravity: { ok: boolean; version: string; latencyMs: number };
}

function VitalTile({ label, icon, primary, sub, status, href }: {
  label: string; icon: ReactNode; primary: ReactNode; sub?: string; status: "ok" | "warn" | "err" | "info"; href?: string;
}) {
  const inner = (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="vital-tile">
      <div className="flex items-center justify-between">
        <span className="k flex items-center gap-1.5"><span style={{ color: "var(--gold)" }}>{icon}</span>{label}</span>
        <span className={`status-dot ${status}`} />
      </div>
      <div className="v">{primary}</div>
      {sub && <div className="sub truncate">{sub}</div>}
    </motion.div>
  );
  if (href) return <a href={href} className="block">{inner}</a>;
  return inner;
}

export default function Vitals() {
  const [data, setData] = useState<VitalsData | null>(null);
  const [, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  usePollWhileVisible(async () => {
    try {
      const r = await fetch("/api/vitals", { cache: "no-store" });
      const v = await r.json();
      setData(v); setErr(null); setTick((n) => n + 1);
    } catch (e) { setErr(String(e)); }
  }, 10000);

  useEffect(() => { /* polling via usePollWhileVisible */ }, []);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
      <VitalTile label="Asta" icon={<Sparkles size={12} />} primary={data?.claude.ok ? "Online" : "…"}
        sub={data ? `${data.claude.version.split(" ")[0]} · ${data.claude.latencyMs}ms` : "checking…"} status={data?.claude.ok ? "ok" : "warn"} />
      <VitalTile label="Kairos" icon={<Box size={12} />} primary={data?.openclaw.ok ? (data.openclaw.degraded ? "Degraded" : data.openclaw.busy ? "Busy" : "Ready") : "…"}
        sub={data ? `${data.openclaw.agents.length} agents · ${data.openclaw.sessions} sessions` : "checking…"} status={!data?.openclaw.ok ? "err" : data.openclaw.degraded ? "warn" : "ok"} />
      <VitalTile label="Chrono" icon={<Cpu size={12} />} primary={data?.chrono.ok ? "Online" : "…"}
        sub={data ? `${data.chrono.model.split("/").pop()} · ${data.chrono.provider}` : "checking…"} status={data?.chrono.ok ? "ok" : "warn"} />
      <VitalTile label="Labyrinth" icon={<Route size={12} />} primary={data?.labyrinth.ok ? "Online" : "…"}
        sub={data ? `Owl Alpha · ${data.labyrinth.latencyMs}ms` : "checking…"} status={data?.labyrinth.ok ? "ok" : "warn"} />
      <VitalTile label="Antigravity" icon={<Zap size={12} />} primary={data?.antigravity.ok ? "Online" : "…"}
        sub={data ? `${data.antigravity.version.split(" ")[0]} · ${data.antigravity.latencyMs}ms` : "checking…"} status={data?.antigravity.ok ? "ok" : "warn"} />
      <VitalTile label="Heartbeat" icon={<Activity size={12} />} primary={<><em>{tick}</em><span className="text-[var(--cream-dim)] text-[0.7em] ml-0.5">ticks</span></>}
        sub="poll · 10s" status="info" />
    </div>
  );
}
