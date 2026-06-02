"use client";
import { useState } from "react";
import { MessageSquare, Terminal, Layers } from "lucide-react";
import AgentRoom from "@/components/AgentRoom";
import UnifiedChat from "@/components/UnifiedChat";
import OpenClawWorkspace from "@/components/OpenClawWorkspace";

export default function OpenClawRoute() {
  const [tab, setTab] = useState<"chat" | "workspace" | "control">("chat");
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap">
        {([
          { key: "chat", label: "Chat", icon: <MessageSquare size={14} /> },
          { key: "workspace", label: "Workspace", icon: <Layers size={14} /> },
          { key: "control", label: "Control Room", icon: <Terminal size={14} /> },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-[12.5px] transition"
            style={{
              background: tab === t.key ? "rgba(244,114,182,0.16)" : "transparent",
              borderColor: tab === t.key ? "#f472b6" : "var(--panel-border)",
              color: tab === t.key ? "var(--fg)" : "var(--fg-dim)",
            }}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>
      {tab === "chat" ? (
        <UnifiedChat agent="openclaw" apiPath="/api/openclaw/chat" accent="openclaw" />
      ) : tab === "workspace" ? (
        <OpenClawWorkspace />
      ) : (
        <AgentRoom agent="openclaw" accent="#f472b6" accentDim="rgba(244,114,182,0.12)"
          defaultTab="health"
          tabs={[
            { key: "health", label: "Health", action: "health", hint: "gateway status" },
            { key: "agents", label: "Agents", action: "agents", hint: "list" },
            { key: "sessions", label: "Sessions", action: "sessions", hint: "history" },
            { key: "logs", label: "Logs", action: "logs", hint: "tail" },
          ]} />
      )}
    </div>
  );
}
