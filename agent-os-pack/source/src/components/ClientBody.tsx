"use client";

import { ChatProvider } from "@/context/ChatContext";
import { EnhancedChatProvider } from "@/context/EnhancedChatContext";
import { StreamProvider } from "@/context/StreamContext";
import { type ReactNode } from "react";

/**
 * ClientBody — Root client wrapper.
 * Provider order:
 *   ChatProvider         (legacy persistent storage + streams)
 *   EnhancedChatProvider (routing + enhanced persistence)
 *   StreamProvider       (tab-throttle bypass + model-tier streams)
 */
export default function ClientBody({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-10">
      <ChatProvider>
        <EnhancedChatProvider>
          <StreamProvider>
            {children}
          </StreamProvider>
        </EnhancedChatProvider>
      </ChatProvider>
    </div>
  );
}
