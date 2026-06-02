"use client";

import { useState } from "react";
import { MessageSquare, Terminal } from "lucide-react";
import AntigravityView from "@/components/AntigravityView";
import AgentRoom from "@/components/AgentRoom";

type AntigravityTab = "chat" | "control";

export default function AntigravityRoute() {
  const [tab, setTab] = useState<AntigravityTab>("chat");

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        {([
          { key: "chat", label: "Chat", icon: <MessageSquare size={14} /> },
          { key: "control", label: "Control Room", icon: <Terminal size={14} /> },
        ] as { key: AntigravityTab; label: string; icon: React.ReactNode }[]).map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12.5px] transition"
              style={{
                background: active ? "rgba(124,58,237,0.16)" : "transparent",
                borderColor: active ? "#7c3aed" : "var(--panel-border)",
                color: active ? "var(--fg)" : "var(--fg-dim)",
              }}
            >
              {t.icon}{t.label}
            </button>
          );
        })}
      </div>

      {tab === "chat" ? (
        <AntigravityView />
      ) : (
        <AgentRoom
          agent="antigravity"
          accent="#7c3aed"
          accentDim="rgba(124,58,237,0.12)"
          defaultTab="status"
          tabs={[
            { key: "status", label: "Status", action: "status", hint: "version" },
            { key: "doctor", label: "Doctor", action: "doctor", hint: "check" },
            { key: "sessions", label: "Sessions", action: "sessions", hint: "history" },
          ]}
        />
      )}
    </div>
  );
}
