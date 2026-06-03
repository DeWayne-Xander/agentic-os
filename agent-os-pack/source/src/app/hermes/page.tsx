"use client";

import { useEffect, useState } from "react";
import { Cpu, MessageSquare, Terminal, Layers, Target, Plug } from "lucide-react";
import AgentRoom from "@/components/AgentRoom";
import UnifiedChat from "@/components/UnifiedChat";
import HermesWorkspace from "@/components/HermesWorkspace";
import HermesGoals from "@/components/HermesGoals";
import HermesMCPCatalog from "@/components/HermesMCPCatalog";

type HermesTab = "chat" | "goals" | "workspace" | "mcps" | "control";

export default function HermesRoute() {
  const [tab, setTab] = useState<HermesTab>("chat");

  return (
    <div className="space-y-5" style={{ minHeight: "calc(100svh - 180px)" }}>
      <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar pb-1 -mx-1 px-1 mx-0 px-0 sm:overflow-visible sm:flex-wrap">
        {([
          { key: "chat",      label: "Chat",         icon: <MessageSquare size={14} /> },
          { key: "goals",     label: "Goal Mode",    icon: <Target size={14} /> },
          { key: "workspace", label: "Workspace",    icon: <Layers size={14} /> },
          { key: "mcps",      label: "MCPs",         icon: <Plug size={14} /> },
          { key: "control",   label: "Control Room", icon: <Terminal size={14} /> },
        ] as { key: HermesTab; label: string; icon: React.ReactNode }[]).map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-3 py-1.5 rounded-full border text-[11px] sm:text-[12.5px] whitespace-nowrap transition flex-shrink-0"
              style={{
                background: active ? "rgba(108,92,231,0.16)" : "rgba(255,255,255,0.02)",
                borderColor: active ? "#6c5ce7" : "var(--panel-border)",
                color: active ? "var(--fg)" : "var(--fg-dim)",
              }}
            >
              {t.icon}{t.label}
            </button>
          );
        })}
      </div>

      {tab === "chat" ? (
        <UnifiedChat agent="chrono" apiPath="/api/hermes/chat" accent="chrono" />
      ) : tab === "goals" ? (
        <HermesGoals />
      ) : tab === "workspace" ? (
        <HermesWorkspace />
      ) : tab === "mcps" ? (
        <HermesMCPCatalog />
      ) : (
        <AgentRoom
          agent="hermes"
          accent="#6c5ce7"
          accentDim="rgba(108,92,231,0.12)"
          defaultTab="status"
          tabs={[
            { key: "status",   label: "Status",   action: "status",   hint: "env" },
            { key: "sessions", label: "Sessions", action: "sessions", hint: "history" },
            { key: "skills",   label: "Skills",   action: "skills",   hint: "installed" },
            { key: "plugins",  label: "Plugins",  action: "plugins",  hint: "marketplace" },
            { key: "kanban",   label: "Kanban",   action: "kanban",   hint: "tasks" },
            { key: "doctor",   label: "Doctor",   action: "doctor",   hint: "check" },
            { key: "insights", label: "Insights", action: "insights", hint: "analytics" },
          ]}
        />
      )}
    </div>
  );
}
