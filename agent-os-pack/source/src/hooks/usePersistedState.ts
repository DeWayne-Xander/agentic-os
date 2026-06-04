"use client";

import { useState, useEffect, useCallback, type Dispatch, type SetStateAction } from "react";
import { PLATFORM_MODEL } from "@/lib/model-router";

/**
 * usePersistedState — Generic persisted state hook.
 * Survives page refresh (localStorage) and tab switch (sessionStorage backup).
 *
 * Usage:
 *   const [theme, setTheme] = usePersistedState('ui:theme', 'dark');
 *   const [sidebar, setSidebar] = usePersistedState('ui:sidebarOpen', true);
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(defaultValue);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from storage on mount
  useEffect(() => {
    try {
      // Try sessionStorage first (hot data from current tab)
      const hot = sessionStorage.getItem(key);
      if (hot !== null) {
        setValue(JSON.parse(hot) as T);
        setHydrated(true);
        return;
      }
      // Fall back to localStorage (long-term)
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        setValue(JSON.parse(stored) as T);
        // Mirror into sessionStorage
        sessionStorage.setItem(key, stored);
      }
    } catch {
      // Malformed — keep default
    }
    setHydrated(true);
  }, [key]);

  // Persist to both stores on change
  const persistValue: Dispatch<SetStateAction<T>> = useCallback(
    (action) => {
      setValue((prev) => {
        const next = action instanceof Function ? action(prev) : action;
        try {
          const json = JSON.stringify(next);
          sessionStorage.setItem(key, json);
          localStorage.setItem(key, json);
        } catch {
          // quota exceeded — silently drop
        }
        return next;
      });
    },
    [key]
  );

  return [hydrated ? value : defaultValue, persistValue];
}

/**
 * useConversationHistory — Persisted conversation array per agent.
 * Uses state-manager.ts under the hood for CRDT-safe upserts.
 */
export function useConversationHistory(agent: string) {
  const [history, setHistoryState] = useState<import("@/lib/state-manager").ConversationNode[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const { getConversation } = require("@/lib/state-manager");
    setHistoryState(getConversation(agent));
    setHydrated(true);
  }, [agent]);

  const append = useCallback(
    (node: import("@/lib/state-manager").ConversationNode) => {
      const { appendConversationNode } = require("@/lib/state-manager");
      const tree = appendConversationNode(node);
      setHistoryState(tree[agent] ?? []);
    },
    [agent]
  );

  const clear = useCallback(() => {
    const { clearConversation } = require("@/lib/state-manager");
    clearConversation(agent);
    setHistoryState([]);
  }, [agent]);

  return { history: hydrated ? history : [], append, clear, hydrated };
}

/**
 * useEngineContext — Persisted engine/model context.
 * Remembers active model tier and session across refreshes.
 */
export function useEngineContext() {
  const [context, setContextState] = useState<import("@/lib/state-manager").EngineContext | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const { loadEngineContext, saveEngineContext, getOrCreateSessionId } = require("@/lib/state-manager");
    const ctx = loadEngineContext();
    if (ctx) {
      setContextState(ctx);
    } else {
      const fresh = {
        activeModel: PLATFORM_MODEL,
        activeTier: "heavy" as const,
        sessionId: getOrCreateSessionId(),
        startedAt: Date.now(),
      };
      saveEngineContext(fresh);
      setContextState(fresh);
    }
    setHydrated(true);
  }, []);

  const setContext = useCallback(
    (ctx: import("@/lib/state-manager").EngineContext) => {
      const { saveEngineContext } = require("@/lib/state-manager");
      saveEngineContext(ctx);
      setContextState(ctx);
    },
    []
  );

  return { context: hydrated ? context : null, setContext, hydrated };
}
