"use client";

import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { motion, AnimatePresence } from "framer-motion";
import { Cpu, ChevronRight } from "lucide-react";
import type { AgentKey } from "./AgentAvatar";

interface Action {
  id: string;
  label: string;
  hint: string;
  agent: AgentKey;
  args: string[];
}

const ACTIONS: Action[] = [
  { id: "chrono-status",  label: "Chrono: status",    hint: "orchestrator status",       agent: "chrono", args: ["status"] },
  { id: "chrono-skills",  label: "Chrono: skills",    hint: "list installed skills",     agent: "chrono", args: ["skills"] },
  { id: "chrono-sessions", label: "Chrono: sessions",  hint: "recent session history",    agent: "chrono", args: ["sessions"] },
  { id: "chrono-doctor",  label: "Chrono: doctor",    hint: "system health check",       agent: "chrono", args: ["doctor"] },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{ label: string; out: string } | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  async function execute(a: Action) {
    setRunning(true);
    setResult({ label: a.label, out: "running…" });
    try {
      const r = await fetch("/api/hermes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: a.args[0] }),
      });
      const j = await r.json();
      setResult({ label: a.label, out: (j.stdout || "") + (j.stderr ? `\n${j.stderr}` : "") || "(ready)" });
    } catch (e) {
      setResult({ label: a.label, out: String(e) });
    }
    setRunning(false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden md:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--panel-border)] text-[12px] text-[var(--fg-dim)] hover:text-[var(--fg)] hover:border-[var(--panel-border-hot)] transition"
      >
        <span>⌘K</span><span>Command palette</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 grid place-items-start pt-[12vh] bg-[rgba(0,0,0,0.5)] backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ y: -16, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -8, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="panel panel-hot w-[min(640px,92vw)] mx-auto overflow-hidden"
            >
              <Command label="Command palette" loop>
                <Command.Input
                  className="cmdk-input"
                  placeholder="Run a Chrono command…"
                  autoFocus
                />
                <div className="border-t border-[var(--panel-border)] p-2 max-h-[50vh] overflow-y-auto scroll">
                  <Command.Empty className="px-4 py-3 text-sm text-[var(--fg-dim)]">
                    No commands found.
                  </Command.Empty>
                  <Command.Group heading="Chrono Commands" className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] px-2 py-1">
                    {ACTIONS.map((a) => (
                      <Command.Item
                        key={a.id}
                        value={`${a.label} ${a.hint}`}
                        onSelect={() => execute(a)}
                        className="cmdk-item"
                      >
                        <Cpu size={14} className="text-[#6c5ce7]" />
                        <span className="flex-1 text-sm text-[var(--fg)]">{a.label}</span>
                        <span className="text-[11px] text-[var(--fg-dimmer)]">{a.hint}</span>
                        <ChevronRight size={12} className="opacity-50" />
                      </Command.Item>
                    ))}
                  </Command.Group>
                </div>

                {result && (
                  <div className="border-t border-[var(--panel-border)] p-3 bg-[rgba(0,0,0,0.25)]">
                    <div className="text-[10px] uppercase tracking-widest text-[var(--fg-dimmer)] mb-1">
                      {running ? "running" : "result"} · {result.label}
                    </div>
                    <pre className="scroll max-h-[200px] overflow-auto text-[11px] font-[var(--font-geist-mono)] text-[var(--fg-dim)] whitespace-pre">
                      {result.out}
                    </pre>
                  </div>
                )}
              </Command>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
