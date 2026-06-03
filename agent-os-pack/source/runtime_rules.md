# RUNTIME RULES — Coding Standards & Constraints for Asta

> **Last updated:** 2026-06-02 by Chrono
> **Purpose:** Hard rules that every engineering session MUST follow. Non-negotiable.

---

## 1. NEXT.JS VERSION COMPLIANCE

This project runs **Node v24.15.0** which ships a **custom Next.js** with breaking changes.

- Avoid relying on generic training-data assumptions for Next.js APIs, conventions, or file structure
- Check `node_modules/next/dist/docs/` when touching a Next.js surface that may have changed
- Heed deprecation notices in the docs
- Read `AGENTS.md` at the project root when you need the current compliance header

### Next.js Breaking Changes to Watch
- API route signatures may differ from standard Next.js 14/15
- File-based routing conventions may have changed
- Server component / client component boundaries may differ
- The `"use client"` directive is still required for client components

---

## 2. TYPESCRIPT RULES

| Rule | Enforcement |
|------|------------|
| **Strict mode** | `strict: true` in tsconfig — no `any` without comment justification |
| **Explicit return types** | All API routes must have explicit return types |
| **Interface over type** | Prefer `interface` for object shapes, `type` for unions/primitives |
| **No `@ts-ignore`** | Use `@ts-expect-error` with an explanation comment |
| **Import style** | Use `@/` alias for internal imports (e.g., `@/lib/config`) |

### Compiler Gate Standard
Every code change should pass:
```bash
npx tsc --noEmit
```
before being synced to production. Aim for zero errors and zero warnings.

---

## 3. SECURITY RULES

### Spawn Safety (Critical — runner.ts)
```typescript
// NEVER interpolate user input into shell commands
// ALWAYS use spawn with array args (never shell: true with template literals)
// ALWAYS validate flags through validateFlagArgs() before passing to spawn()
// ALWAYS set timeout on child processes
```

### Path Traversal Prevention
```typescript
// For any file read endpoint:
const resolved = path.resolve(base, userPath);
if (!resolved.startsWith(base + "/")) {
  return NextResponse.json({ error: "Path traversal blocked" }, { 403 });
}
```

### Approval Gate Pattern
- Dangerous operations (shell exec, file delete, network calls) should still use an approval step
- Use the `ApprovalRequest` / `onApproval` pattern from `runner.ts` where available
- Keep confirmations visible in the frontend for actions that can cause damage

### No Data Leaves the Machine
- Keep external calls limited to the locally-running Hermes/OpenClaw gateway
- No analytics, telemetry, or tracking
- Keep the dashboard localhost-only unless a feature explicitly requires otherwise

---

## 4. COMPONENT PATTERNS

### Client Component Standard
```tsx
"use client";  // Top of file, line 1

import { useState, useEffect, useCallback } from "react";
import { usePollWhileVisible } from "@/lib/usePollWhileVisible";  // For polling
// Always use usePollWhileVisible instead of raw setInterval
```

### API Fetch Pattern
```typescript
const r = await fetch("/api/...", { cache: "no-store" });  // Never cache API routes
const j = await r.json();
if (!r.ok) throw new Error(j.error ?? "Request failed");
```

### Polling Pattern
```typescript
// USE this from @/lib/usePollWhileVisible:
const data = usePollWhileVisible("/api/.../poll", 2000);  // 2s interval
// NOT raw setInterval — it must pause when tab is hidden
```

### Error Boundary Pattern
```typescript
// Wrap async operations in try/catch with user-visible error states
try {
  setLoading(true);
  await doThing();
} catch (e) {
  setError(String(e));  // Always show error in UI, don't swallow
} finally {
  setLoading(false);
}
```

### State Management
- Use `useState` + `useCallback` — no Redux, no Zustand
- Global state via React Context ONLY if needed across 3+ components
- Server state via API polling (no SWR, no React Query)

---

## 5. FILE STRUCTURE CONVENTIONS

```
src/
  app/
    api/                    # API routes — server-side only
      <agent>/              # Per-agent API namespace
        chat/route.ts       # Chat endpoint
        workspace/route.ts  # File browser endpoint
        goals/route.ts      # Goals CRUD endpoint
      health/route.ts       # System health endpoint
    <page>/page.tsx         # Page components (server components by default)
    layout.tsx              # Root layout
    globals.css             # Global styles (CSS variables at top)
  components/
    <Feature>.tsx           # Feature components (client components)
    AgentAvatar.tsx         # Shared agent avatar component
  lib/
    <feature>.ts            # Server-side libraries (runnable in API routes)
    usePollWhileVisible.ts  # Shared hooks
    config.ts               # Single source of truth for paths
    runner.ts               # Safe CLI execution (NEVER bypass)
    model-router.ts         # Model routing logic
```

### Naming Conventions
- Components: `PascalCase.tsx`
- Libraries: `camelCase.ts`
- API routes: `route.ts` inside descriptive folder
- CSS variables in `globals.css` for all colors

---

## 6. CSS / STYLING RULES

- **Tailwind CSS only** — no styled-components, no CSS-in-JS
- **CSS variables** in `globals.css` (`:root { --accent: ... }`) for all theme colors
- **No inline styles** except for dynamic values (width, color from variable)
- **Glass effect:** `backdrop-blur` + `bg-white/5` + `border border-white/10` for panels
- **Accent colors per agent:**
  - Chrono (Hermes): `#22d3ee` (cyan)
  - Codex (Asta): `#8b5cf6` (violet)
  - Labyrinth: `#a855f7` (purple)
  - OpenClaw (Kairos): `#10b981` (emerald)
  - Video Studio: `#ef4444` (red)
  - Antigravity: `#f59e0b` (amber)

---

## 7. CLI EXECUTION RULES

### From runner.ts — the ONLY safe way to run agents
```typescript
import { run, spawnStream } from "@/lib/runner";

// For simple run-and-wait:
const result = await run("codex", ["exec", "--full-auto", prompt], {
  timeoutMs: 120_000,
  cwd: "~/codex-scratch/project-name",
});

// For streaming output (chat):
const child = spawnStream("codex", ["exec", prompt], {
  cwd: "~/codex-scratch/project-name",
});
child.stdout.on("data", (b) => { /* stream to frontend */ });
child.stderr.on("data", (b) => { /* stream errors */ });
```

### NEVER:
- Use `execSync` with string interpolation
- Use `shell: true`
- Pass unsanitized user input to any CLI
- Run without a timeout
- Forget to kill child processes on component unmount / goal stop

---

## 8. ERROR HANDLING STANDARDS

### API Routes
```typescript
// Always return structured errors:
return NextResponse.json(
  { error: "Descriptive message", detail: String(e) },
  { status: 400 }  // Appropriate HTTP status
);
```

### Client Components
```typescript
// Always have error state:
const [error, setError] = useState<string | null>(null);
// Display error prominently — never silent failures
if (error) return <div className="text-red-400 p-4">{error}</div>;
```

### Process Errors
```typescript
child.on("error", (e) => {
  // Log to console + update UI + write to goal log file
  console.error("[asta]", e);
  appendToLog(goalId, `ERROR: ${e.message}`);
  updateGoalStatus(goalId, "failed");
});
```

---

## 9. TESTING / VERIFICATION RULES

### Before Declaring Any Feature Complete:
1. `npx tsc --noEmit` — no compile errors
2. `npm run build` — production build succeeds when the change touches build-sensitive code
3. `curl localhost:3001/api/.../route` — check routes that were changed
4. Manual check in browser — verify the affected UI renders cleanly
5. Check for obvious port conflicts if the change touches runtime startup

### Integration Test for Codex APIs:
```bash
# Workspace list
curl -s http://localhost:3001/api/codex/workspace | python3 -m json.tool

# Goals CRUD
curl -s -X POST http://localhost:3001/api/codex/goals \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","prompt":"Say hello"}'

# Chat
curl -s -X POST http://localhost:3001/api/codex/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello Asta"}'
```

---

## 10. COST & RESOURCE DISCIPLINE

| Rule | Reason |
|------|--------|
| Always use `openrouter/owl-alpha` (free) | DeepSeek-R1 is NOT free on OpenRouter |
| Set timeouts on ALL API calls | Prevent runaway costs |
| Poll intervals: minimum 2 seconds | Don't hammer the gateway |
| Limit file reads to <10MB | Prevent memory issues |
| Clean up temp files after sync | Disk space discipline |

---

## 11. STYLE GUIDE — CODE COMMENTS

```typescript
// ─── Section Header ──────────────────────────────────────────
// Use double-dash headers for major sections within files

// Single-line comments for inline explanations
// Keep comments focused on WHY, not WHAT

/**
 * JSDoc for exported functions:
 * @param agent - The agent binary to execute
 * @param args - Array of arguments (NEVER a single string)
 */
```

---

## 12. PROHIBITED ACTIONS

The following are STRICTLY PROHIBITED without explicit Chrono approval:

1. Modifying `node_modules/`
2. Adding new npm packages without documenting the need
3. Changing port from 3001
4. Adding external network calls (except to `localhost` agents)
5. Modifying `runner.ts` security controls
6. Removing approval gates
7. Hardcoding API keys or paths
8. Modifying another agent's profile/config
