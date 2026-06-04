"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock, CheckCircle2, XCircle, Pause, Play, Timer,
  ChevronLeft, ChevronRight, Zap, Activity, Calendar,
  ArrowUpRight, RotateCcw, Eye
} from "lucide-react";

/* ─── Types ─── */
interface CronStatus {
  label: string;
  color: string;
  icon: string;
}

interface CronJob {
  job_id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  state: string;
  last_run_at: string | null;
  last_status: string | null;
  next_run_at: string | null;
  agent: string | null;
  has_script: boolean;
  status: CronStatus;
  lastRunDisplay: string;
  nextRunDisplay: string;
  isHealthy: boolean;
  isFailed: boolean;
}

interface CronData {
  jobs: CronJob[];
  total: number;
  healthy: number;
  failed: number;
  paused: number;
  running: number;
  generated_at: string;
}

/* ─── Helpers ─── */
function scheduleLabel(s: string): string {
  if (s.startsWith("every ")) return s.replace("every ", "Every ");
  if (s.startsWith("0 ")) {
    const parts = s.split(" ");
    if (parts.length >= 3) {
      const hour = parseInt(parts[1]);
      const ampm = hour >= 12 ? "PM" : "AM";
      const h = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
      return `Daily ${h} ${ampm} MST`;
    }
  }
  return s;
}

function agentColor(agent: string | null): string {
  if (!agent) return "#a855f5";
  if (agent.includes("Labyrinth")) return "#00b894";
  if (agent.includes("Chrono")) return "#6c5ce7";
  if (agent.includes("Kairos")) return "#f472b6";
  if (agent.includes("Asta")) return "#22c55e";
  if (agent.includes("System")) return "#a855f5";
  return "#a855f5";
}

/* ─── Status Badge ─── */
function StatusBadge({ job }: { job: CronJob }) {
  const s = job.status;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider"
      style={{
        background: `${s.color}15`,
        color: s.color,
        border: `1px solid ${s.color}30`,
      }}
    >
      <span className="text-[8px]">{s.icon}</span>
      {s.label}
    </span>
  );
}

/* ─── Single Job Card ─── */
function JobCard({ job, isActive }: { job: CronJob; isActive: boolean }) {
  const accent = agentColor(job.agent);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="w-full shrink-0"
      style={{ padding: "0 0.5rem" }}
    >
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: isActive
            ? `linear-gradient(135deg, ${accent}08, ${accent}03)`
            : "rgba(255,255,255,0.02)",
          border: isActive ? `1px solid ${accent}25` : "1px solid var(--line-soft)",
          boxShadow: isActive ? `0 0 40px ${accent}08` : "none",
        }}
      >
        {/* Top accent bar */}
        <div
          className="h-[3px] w-full"
          style={{
            background: job.isFailed
              ? "linear-gradient(90deg, #ef4444, #f97316)"
              : job.isHealthy
              ? `linear-gradient(90deg, ${accent}, ${accent}80)`
              : "var(--line-soft)",
          }}
        />

        <div className="p-5 sm:p-6">
          {/* Header row */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3
                  className="text-[15px] sm:text-[16px] font-semibold truncate"
                  style={{
                    fontFamily: "'Bricolage Grotesque', sans-serif",
                    color: "var(--cream)",
                  }}
                >
                  {job.name}
                </h3>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-[10px] font-medium px-2 py-0.5 rounded-md"
                  style={{
                    background: `${accent}12`,
                    color: accent,
                    fontFamily: "'Manrope', sans-serif",
                  }}
                >
                  {job.agent}
                </span>
                <StatusBadge job={job} />
              </div>
            </div>
            {job.state === "running" && (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="shrink-0"
              >
                <RotateCcw size={16} style={{ color: accent }} />
              </motion.div>
            )}
          </div>

          {/* Schedule */}
          <div
            className="flex items-center gap-2 mb-4 px-3 py-2.5 rounded-xl"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--line-deep)" }}
          >
            <Calendar size={13} style={{ color: "var(--cream-dim)" }} />
            <span
              className="text-[12px]"
              style={{ fontFamily: "'Manrope', sans-serif", color: "var(--cream-soft)" }}
            >
              {scheduleLabel(job.schedule)}
            </span>
            {job.has_script && (
              <span
                className="ml-auto text-[9px] font-semibold px-1.5 py-0.5 rounded"
                style={{ background: "rgba(168,85,247,0.1)", color: "#a855f5" }}
              >
                SCRIPT
              </span>
            )}
          </div>

          {/* Timing grid */}
          <div className="grid grid-cols-2 gap-3">
            <div
              className="rounded-xl p-3"
              style={{ background: "rgba(255,255,255,0.015)", border: "1px solid var(--line-deep)" }}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Clock size={11} style={{ color: "var(--cream-dim)" }} />
                <span
                  className="text-[9px] uppercase tracking-wider font-semibold"
                  style={{ fontFamily: "'Manrope', sans-serif", color: "var(--cream-mute)" }}
                >
                  Last Run
                </span>
              </div>
              <span
                className="text-[13px] font-medium"
                style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: "var(--cream)" }}
              >
                {job.lastRunDisplay}
              </span>
            </div>
            <div
              className="rounded-xl p-3"
              style={{ background: "rgba(255,255,255,0.015)", border: "1px solid var(--line-deep)" }}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Timer size={11} style={{ color: "var(--cream-dim)" }} />
                <span
                  className="text-[9px] uppercase tracking-wider font-semibold"
                  style={{ fontFamily: "'Manrope', sans-serif", color: "var(--cream-mute)" }}
                >
                  Next Run
                </span>
              </div>
              <span
                className="text-[13px] font-medium"
                style={{
                  fontFamily: "'Bricolage Grotesque', sans-serif",
                  color: job.nextRunDisplay === "Overdue" ? "#ef4444" : "var(--cream)",
                }}
              >
                {job.nextRunDisplay}
              </span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Stats Bar ─── */
function StatsBar({ data }: { data: CronData }) {
  const stats = [
    { label: "Total", value: data.total, color: "#a855f5", icon: <Activity size={13} /> },
    { label: "Healthy", value: data.healthy, color: "#22c55e", icon: <CheckCircle2 size={13} /> },
    { label: "Failed", value: data.failed, color: "#ef4444", icon: <XCircle size={13} /> },
    { label: "Paused", value: data.paused, color: "#6b7280", icon: <Pause size={13} /> },
  ];

  return (
    <div className="grid grid-cols-4 gap-2 sm:gap-3 mb-6">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-xl p-3 sm:p-4 text-center"
          style={{
            background: `${s.color}08`,
            border: `1px solid ${s.color}18`,
          }}
        >
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <span style={{ color: s.color }}>{s.icon}</span>
            <span
              className="text-[9px] uppercase tracking-wider font-bold"
              style={{ fontFamily: "'Manrope', sans-serif", color: `${s.color}99` }}
            >
              {s.label}
            </span>
          </div>
          <span
            className="text-xl sm:text-2xl font-bold"
            style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: s.color }}
          >
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─── Main Page ─── */
export default function HorizonPage() {
  const [data, setData] = useState<CronData | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const rotateRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch("/api/cron/status");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setData(d);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 30000); // refresh every 30s
    return () => clearInterval(iv);
  }, [fetchData]);

  // Auto-rotate through jobs
  useEffect(() => {
    if (rotateRef.current) clearInterval(rotateRef.current);
    if (!autoRotate || !data || data.jobs.length <= 1) return;

    rotateRef.current = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % data.jobs.length);
    }, 5000); // 5 seconds per job

    return () => {
      if (rotateRef.current) clearInterval(rotateRef.current);
    };
  }, [autoRotate, data]);

  const jobs = data?.jobs || [];
  const activeJob = jobs[activeIdx];

  const goNext = () => {
    setAutoRotate(false);
    setActiveIdx((p) => Math.min(p + 1, jobs.length - 1));
  };
  const goPrev = () => {
    setAutoRotate(false);
    setActiveIdx((p) => Math.max(p - 1, 0));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: "60vh" }}>
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
        >
          <Zap size={24} style={{ color: "var(--gold)" }} />
        </motion.div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <XCircle size={32} className="mx-auto mb-3" style={{ color: "#ef4444" }} />
        <p style={{ color: "var(--cream-dim)" }}>Failed to load cron data: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1
            className="text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: "var(--cream)" }}
          >
            Horizon
            <span className="hand text-[0.85em] ml-2">⊕</span>
          </h1>
          <p
            className="text-[12px] sm:text-[13px] mt-1"
            style={{ fontFamily: "'Manrope', sans-serif", color: "var(--cream-mute)" }}
          >
            All agent cron jobs & workflows · Auto-refreshing
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRotate(!autoRotate)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider transition-colors"
            style={{
              fontFamily: "'Manrope', sans-serif",
              background: autoRotate ? "rgba(212,165,116,0.1)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${autoRotate ? "var(--gold)" : "var(--line-soft)"}`,
              color: autoRotate ? "var(--gold)" : "var(--cream-dim)",
            }}
          >
            <Eye size={12} />
            {autoRotate ? "Live" : "Paused"}
          </button>
          <button
            onClick={fetchData}
            className="grid place-items-center w-9 h-9 rounded-lg transition-colors"
            style={{ border: "1px solid var(--line-soft)", color: "var(--cream-dim)" }}
          >
            <RotateCcw size={14} />
          </button>
        </div>
      </div>

      {/* Stats */}
      {data && <StatsBar data={data} />}

      {/* Job carousel */}
      {jobs.length === 0 ? (
        <div className="text-center py-16">
          <Clock size={32} className="mx-auto mb-3" style={{ color: "var(--cream-dim)" }} />
          <p style={{ color: "var(--cream-dim)", fontFamily: "'Bricolage Grotesque', sans-serif" }}>
            No cron jobs configured
          </p>
        </div>
      ) : (
        <>
          {/* Carousel nav */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span
                className="text-[11px] font-semibold"
                style={{ fontFamily: "'Manrope', sans-serif", color: "var(--cream-mute)" }}
              >
                {activeIdx + 1} / {jobs.length}
              </span>
              {/* Dot indicators */}
              <div className="flex items-center gap-1">
                {jobs.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => { setAutoRotate(false); setActiveIdx(i); }}
                    className="rounded-full transition-all"
                    style={{
                      width: i === activeIdx ? 20 : 6,
                      height: 6,
                      background: i === activeIdx ? "var(--gold)" : "var(--line-soft)",
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={goPrev}
                disabled={activeIdx === 0}
                className="grid place-items-center w-8 h-8 rounded-lg transition-colors disabled:opacity-30"
                style={{ border: "1px solid var(--line-soft)", color: "var(--cream-dim)" }}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={goNext}
                disabled={activeIdx === jobs.length - 1}
                className="grid place-items-center w-8 h-8 rounded-lg transition-colors disabled:opacity-30"
                style={{ border: "1px solid var(--line-soft)", color: "var(--cream-dim)" }}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          {/* Active job card */}
          <div className="relative overflow-hidden" style={{ minHeight: 320 }}>
            <AnimatePresence mode="wait">
              {activeJob && (
                <JobCard key={activeJob.job_id} job={activeJob} isActive={true} />
              )}
            </AnimatePresence>
          </div>

          {/* Mini job list below carousel */}
          <div className="mt-6">
            <div
              className="text-[10px] uppercase tracking-[0.2em] font-bold mb-3"
              style={{ fontFamily: "'Manrope', sans-serif", color: "var(--cream-mute)" }}
            >
              All Jobs
            </div>
            <div className="space-y-2">
              {jobs.map((job, i) => (
                <button
                  key={job.job_id}
                  onClick={() => { setAutoRotate(false); setActiveIdx(i); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left"
                  style={{
                    background: i === activeIdx ? `${agentColor(job.agent)}08` : "rgba(255,255,255,0.01)",
                    border: `1px solid ${i === activeIdx ? `${agentColor(job.agent)}25` : "var(--line-deep)"}`,
                  }}
                >
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      background: job.isFailed ? "#ef4444" : job.isHealthy ? "#22c55e" : "#6b7280",
                      boxShadow: `0 0 6px ${job.isFailed ? "#ef4444" : job.isHealthy ? "#22c55e" : "#6b7280"}40`,
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <span
                      className="text-[12px] font-medium truncate block"
                      style={{ fontFamily: "'Bricolage Grotesque', sans-serif", color: "var(--cream)" }}
                    >
                      {job.name}
                    </span>
                    <span
                      className="text-[10px]"
                      style={{ fontFamily: "'Manrope', sans-serif", color: "var(--cream-mute)" }}
                    >
                      {job.agent} · {job.lastRunDisplay}
                    </span>
                  </div>
                  <StatusBadge job={job} />
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Last updated */}
      {data?.generated_at && (
        <div className="text-center pt-4">
          <span
            className="text-[10px]"
            style={{ fontFamily: "'Manrope', sans-serif", color: "var(--cream-dim)" }}
          >
            Last synced {new Date(data.generated_at).toLocaleTimeString()} · Refreshes every 30s
          </span>
        </div>
      )}
    </div>
  );
}
