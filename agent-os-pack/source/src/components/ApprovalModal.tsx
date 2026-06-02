"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, X, Check, Clock, Ban } from "lucide-react";

export interface ApprovalRequest {
  run_id: string;
  reason: string;
  agent: string;
  args: string[];
  cwd: string;
}

interface Props {
  request: ApprovalRequest | null;
  onResolve: (runId: string, approved: boolean, mode: string) => void;
}

export default function ApprovalModal({ request, onResolve }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (request) setVisible(true);
  }, [request]);

  if (!request) return null;

  const handleDecision = (approved: boolean, mode: string) => {
    onResolve(request.run_id, approved, mode);
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-[rgba(0,0,0,0.6)] backdrop-blur-sm"
          onClick={() => { /* backdrop click = deny */ handleDecision(false, "deny"); }}
        >
          <motion.div
            initial={{ scale: 0.9, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, y: 10, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="panel panel-hot w-[min(520px,92vw)] overflow-hidden"
            style={{ borderColor: "rgba(108,92,231,0.4)" }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--panel-border)" }}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg grid place-items-center" style={{ background: "rgba(108,92,231,0.18)", color: "#6c5ce7" }}>
                  <Shield size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: "var(--fg)" }}>Execution Approval Required</h3>
                  <p className="text-[11px]" style={{ color: "var(--fg-dim)" }}>Agentic OS security gate</p>
                </div>
              </div>
              <button
                onClick={() => handleDecision(false, "deny")}
                className="w-7 h-7 rounded-md grid place-items-center transition hover:bg-[rgba(248,113,113,0.15)]"
                style={{ color: "var(--fg-dim)" }}
              >
                <X size={14} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              <div className="rounded-lg px-3 py-2.5 text-[12px] font-[var(--font-geist-mono)] leading-relaxed" style={{ background: "rgba(0,0,0,0.3)", color: "var(--fg-dim)", border: "1px solid var(--panel-border)" }}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] uppercase tracking-widest" style={{ color: "#6c5ce7" }}>{request.agent}</span>
                  <span style={{ color: "var(--fg-dimmer)" }}>·</span>
                  <span className="text-[10px]" style={{ color: "var(--fg-dimmer)" }}>{request.cwd}</span>
                </div>
                <div style={{ color: "var(--fg)" }}>{request.reason}</div>
              </div>

              <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--fg-dimmer)" }}>
                <Clock size={11} />
                <span>Multi-step agentic tasks may run indefinitely. Approve to proceed.</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="px-5 py-4 border-t grid grid-cols-2 gap-2" style={{ borderColor: "var(--panel-border)" }}>
              <button
                onClick={() => handleDecision(true, "once")}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[12px] font-medium transition"
                style={{ background: "rgba(108,92,231,0.18)", border: "1px solid rgba(108,92,231,0.4)", color: "#6c5ce7" }}
              >
                <Check size={13} /> Allow Once
              </button>
              <button
                onClick={() => handleDecision(true, "session")}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[12px] font-medium transition"
                style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.35)", color: "#22c55e" }}
              >
                <Shield size={13} /> Session
              </button>
              <button
                onClick={() => handleDecision(true, "always")}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[12px] font-medium transition"
                style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)", color: "#fbbf24" }}
              >
                <Check size={13} /> Always
              </button>
              <button
                onClick={() => handleDecision(false, "deny")}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[12px] font-medium transition"
                style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)", color: "#f87171" }}
              >
                <Ban size={13} /> Deny
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
