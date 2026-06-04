"use client";

import { ChatProvider } from "@/context/ChatContext";
import { EnhancedChatProvider } from "@/context/EnhancedChatContext";
import { StreamProvider } from "@/context/StreamContext";
import { useEffect, type ReactNode } from "react";

const VERSION_KEY = "mission-control:canonical-version";
const CLEAR_PREFIXES = ["chat:", "engine:", "agentic-os-chat-v2:"];

function clearMissionControlBrowserState() {
  if (typeof window === "undefined") return;
  const storages = [window.localStorage, window.sessionStorage];
  for (const storage of storages) {
    try {
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (!key) continue;
        if (key === VERSION_KEY || CLEAR_PREFIXES.some((prefix) => key.startsWith(prefix))) {
          keys.push(key);
        }
      }
      for (const key of keys) storage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}

function CanonicalVersionGate() {
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const resp = await fetch("/api/version", { cache: "no-store" });
        if (!resp.ok) return;
        const data = (await resp.json()) as { version?: string };
        const version = String(data.version ?? "");
        if (!version || cancelled) return;
        const current = window.localStorage.getItem(VERSION_KEY);
        const url = new URL(window.location.href);
        const currentUrlVersion = url.searchParams.get("v");

        if (current === version && currentUrlVersion === version) return;

        if (current && current !== version) {
          clearMissionControlBrowserState();
        } else if (currentUrlVersion && currentUrlVersion !== version) {
          clearMissionControlBrowserState();
        }

        window.localStorage.setItem(VERSION_KEY, version);
        window.sessionStorage.setItem(VERSION_KEY, version);

        if (currentUrlVersion !== version) {
          url.searchParams.set("v", version);
          window.location.replace(url.toString());
          return;
        }
      } catch {
        /* no-op */
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onPageShow = (ev: PageTransitionEvent) => {
      if (ev.persisted) {
        window.location.reload();
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);
  return null;
}

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
      <CanonicalVersionGate />
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
