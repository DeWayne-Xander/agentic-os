"use client";

import { useState } from "react";
import { MessageSquare, Terminal } from "lucide-react";
import UnifiedChat from "@/components/UnifiedChat";
import AgentRoom from "@/components/AgentRoom";

type LabyrinthTab = "chat" | "control";

export default function LabyrinthRoute() {
  const [tab, setTab] = useState<LabyrinthTab>("chat");

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        {([
          { key: "chat", label: "Chat", icon: <MessageSquare size={14} /> },
          { key: "control", label: "Control Room", icon: <Terminal size={14} /> },
        ] as { key: LabyrinthTab; label: string; icon: React.ReactNode }[]).map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12.5px] transition"
              style={{
                background: active ? "rgba(0,184,148,0.16)" : "transparent",
                borderColor: active ? "#00b894" : "var(--panel-border)",
                color: active ? "var(--fg)" : "var(--fg-dim)",
              }}
            >
              {t.icon}{t.label}
            </button>
          );
        })}
      </div>

      {tab === "chat" ? (
        <UnifiedChat agent="labyrinth" apiPath="/api/labyrinth/chat" accent="labyrinth" />
      ) : (
        <AgentRoom
          agent="labyrinth"
          accent="#00b894"
          accentDim="rgba(0,184,148,0.12)"
          defaultTab="status"
          tabs={[
            { key: "status", label: "Status", action: "status", hint: "profile labyrinth" },
            { key: "models", label: "Models", action: "models", hint: "list" },
            { key: "sessions", label: "Sessions", action: "sessions", hint: "list" },
            { key: "cron", label: "Cron", action: "cron", hint: "list" },
          ]}
        />
      )}
    </div>
  );
}
