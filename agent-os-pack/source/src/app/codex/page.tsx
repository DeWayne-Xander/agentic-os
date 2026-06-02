"use client";

import { useState } from "react";
import { FolderOpen, MessageSquare, Terminal, Layers } from "lucide-react";
import UnifiedChat from "@/components/UnifiedChat";
import CodexView from "@/components/CodexView";
import AgentRoom from "@/components/AgentRoom";

type CodexTab = "chat" | "workspace" | "control";

export default function CodexRoute() {
  const [tab, setTab] = useState<CodexTab>("chat");

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        {([
          { key: "chat", label: "Chat", icon: <MessageSquare size={14} /> },
          { key: "workspace", label: "Workspace", icon: <Layers size={14} /> },
          { key: "control", label: "Control Room", icon: <Terminal size={14} /> },
        ] as { key: CodexTab; label: string; icon: React.ReactNode }[]).map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12.5px] transition"
              style={{
                background: active ? "rgba(34,197,94,0.16)" : "transparent",
                borderColor: active ? "#22c55e" : "var(--panel-border)",
                color: active ? "var(--fg)" : "var(--fg-dim)",
              }}
            >
              {t.icon}{t.label}
            </button>
          );
        })}
      </div>

      {tab === "chat" ? (
        <UnifiedChat agent="codex" apiPath="/api/codex/chat" accent="codex" />
      ) : tab === "workspace" ? (
        <CodexView />
      ) : (
        <AgentRoom
          agent="codex"
          accent="#22c55e"
          accentDim="rgba(34,197,94,0.12)"
          defaultTab="status"
          tabs={[
            { key: "status", label: "Status", action: "status", hint: "state" },
            { key: "workspace", label: "Workspace", action: "workspace", hint: "scratch" },
            { key: "goals", label: "Goals", action: "goals", hint: "active" },
            { key: "sessions", label: "Sessions", action: "sessions", hint: "history" },
          ]}
        />
      )}
    </div>
  );
}
