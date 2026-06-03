# CURRENT PACKET — Authoritative Task Context for Asta

> **Last updated:** 2026-06-02 by Chrono
> **Purpose:** This file is the standing reference for what Asta (Codex CLI) should be working on. Read it when orienting, after a packet update, or when the runtime context seems stale.

---

## 1. PROJECT IDENTITY

| Field | Value |
|-------|-------|
| **Name** | Agentic OS |
| **Location** | `~/Projects/agentic-os-source/agent-os-pack/source` |
| **Stack** | Next.js + Tailwind CSS, Node v24.15.0 |
| **Port** | 3001 (primary dashboard; 3000 kept free) |
| **Dashboard URL** | http://localhost:3001 |
| **Author** | DeWayne Xander (DeWayne Nelson Lubega) |
| **Original template** | AIPB Skool pack by Julian Goldie |

---

## 2. CURRENT PROGRAM — VERIFIED AUTONOMY STACK

**Status:** The sandbox / goal / session work is the live baseline. Keep the autonomy stack stable and only revisit pieces that have a concrete gap.

### What Already Exists (DO NOT REBUILD)

| Component | File | Status |
|-----------|------|--------|
| Codex workspace library | `src/lib/codexWorkspace.ts` (401 lines) | DONE |
| Codex goal engine | `src/lib/codexGoals.ts` (250 lines) | DONE |
| Codex workspace API | `src/app/api/codex/workspace/route.ts` | DONE |
| Codex goals API | `src/app/api/codex/goals/route.ts` | DONE |
| Codex preview API | `src/app/api/codex/preview/[...path]/route.ts` | DONE |
| Codex chat API | `src/app/api/codex/chat/route.ts` | DONE |
| CodexView component | `src/components/CodexView.tsx` (329 lines) | DONE |
| GoalsView component | `src/components/GoalsView.tsx` (216 lines) | DONE |
| VideoStudio component | `src/components/VideoStudio.tsx` (861 lines) | DONE |
| hermesMcp library | `src/lib/hermesMcp.ts` (650+ lines) | DONE |
| model-router | `src/lib/model-router.ts` (141 lines) | DONE |
| runner | `src/lib/runner.ts` (113 lines) | DONE |
| config | `src/lib/config.ts` (125 lines) | DONE |
| Runner supports: claude, openclaw, hermes, labyrinth, antigravity, codex | `src/lib/runner.ts` | DONE |

### What Needs Building / Wiring Next

#### P0 — Codex Session APIs (implement if not working end-to-end)

1. **`src/app/api/codex/sessions/route.ts`** — List past Codex sessions from `~/.codex/session_index.jsonl`
2. **`src/app/api/codex/session/route.ts`** — Read a single session transcript
3. **`src/app/api/codex/session-file/[...path]/route.ts`** — Read session file content
4. **`src/app/api/codex/workspace/file/route.ts`** — Read arbitrary workspace file content

**Verify routes with `curl localhost:3001/api/codex/...` when you touch them or suspect drift.**

#### P1 — Goal Mode Execution Engine Wireup

The `CodexView.tsx` shows goals but DOES NOT yet fully wire the execution lifecycle:

1. **Confirm:** Clicking "Run" on a goal calls `POST /api/codex/goals` → spawns Codex CLI → streams output → updates status
2. **Confirm:** Goal log streaming works (SSE or polling from `GoalLogStream.tsx`)
3. **Confirm:** Stop button kills the child process (SIGTERM via `pid`)
4. **If broken:** Fix the full chain: UI → API → `codexGoals.ts` → process spawn → log file → UI update

#### P2 — Asta File-Watcher → Compiler Gate → Production Sync

This is the standard autonomy loop. Treat it as the default path and evolve it only if a specific gap is found:

1. **`src/lib/asta-watcher.ts`** — Polls `~/codex-scratch/` for file changes every 2s
2. **Compiler gate:** On change detection, run `tsc --noEmit` in the scratch dir
3. **If clean:** `rsync` or `cp` changed files to the live `src/` tree
4. **Vault sync:** Append build log + diff summary to Obsidian vault
5. **`src/app/api/asta/sync/route.ts`** — Manual trigger endpoint for "Sync Now"
6. **Dashboard tile:** Add an "Asta Sync" status tile to the Mission Control page

#### P3 — NotebookLM Integration (Gap #1 from video audit)

The `notebooklmClient.ts` lib exists but the integration is incomplete:

1. Confirm NotebookLM API client works end-to-end
2. Add a NotebookLM chat route + page in the dashboard
3. Create memory synthesis: scan vault → send to NotebookLM → store insights back to vault

#### P4 — Video Studio → HeyGen Merge (Gap #2 from video audit)

VideoStudio.tsx exists with HyperFrames support. The HeyGen integration from `heygen.ts` needs to be wired in:

1. Verify `heygen.ts` API client works
2. Wire HeyGen avatar generation into VideoStudio's "Avatar" sub-tab
3. Add render progress + download from the Workspace sub-tab

---

## 3. AUTONOMY RULES FOR ASTA

### File-Watching → Compiler-Gate → Sync Pattern
```
Asta writes to ~/codex-scratch/<project>/
    ↓
File watcher detects changes (poll every 2s)
    ↓
Run: tsc --noEmit (or next build --dry)
    ↓
IF clean → sync to live src/
    ↓
Write build log to Obsidian vault
    ↓
Dashboard updates via SSE/refetch
```

### Sandbox Isolation Rules
- Prefer `~/codex-scratch/<project>/` as the first write target
- Keep direct writes to `src/` tightly scoped to the sync step
- Only clean builds get synced to production
- Each Codex goal gets its own scratch subdir

### Agent Binary Paths (from config.ts)
- `claude` → auto-detected via `which claude`
- `openclaw` → auto-detected via `which openclaw`
- `hermes` → auto-detected via `which hermes`
- `labyrinth` → defaults to `which hermes` (same binary, different profile)
- `codex` → auto-detected via `which codex`
- `antigravity` → auto-detected via `which agy`

---

## 4. PANTHEON AGENTS — WHO DOES WHAT

| Agent | Role | Where it runs |
|-------|------|---------------|
| **Chrono** (me) | Orchestrator, Telegram, scheduling, this file | Hermes default profile |
| **Asta** | Engineering executor — implements features in sandbox | Codex CLI, `~/codex-scratch/` |
| **Labyrinth** | Deep reasoning, architectural analysis, research | Hermes `labyrinth` profile |
| **Kairos** | Local infrastructure — health, daemons, gateway | OpenClaw |
| **DeWayne** | Operator — makes final decisions | Dashboard + Telegram |

### Routing Rules
- Code/DevOps task? → Asta (Codex CLI)
- Memory/Schedule/Channel? → Chrono (Hermes)
- Deep Reasoning/Research? → Labyrinth
- Complex multi-step? → Labyrinth reasons → Asta implements → Chrono monitors

---

## 5. INFRASTRUCTURE CONSTRAINTS

| Constraint | Value |
|------------|-------|
| OS | macOS 26.5 |
| Node | v24.15.0 (via nvm) |
| Python | 3.x (for FastAPI on port 8080 if active) |
| Model budget | Free tier only — `openrouter/owl-alpha` |
| Port 3000 | MUST REMAIN FREE |
| Port 3001 | Agentic OS dashboard |
| Port 8080 | FastAPI backend (if running) |
| Data policy | ALL LOCAL — nothing leaves the machine |
| Vault path | `~/.config/hermes/vault/` |
| Codex scratch | `~/codex-scratch/` |
| Agent state | `~/.agentic-os/` |

---

## 6. ENVIRONMENT VARIABLES — CRITICAL

```bash
# Required in .env.local or shell environment:
AGENTIC_OS_CLAUDE_BIN=/path/to/claude
AGENTIC_OS_OPENCLAW_BIN=/path/to/openclaw
AGENTIC_OS_HERMES_BIN=/path/to/hermes
AGENTIC_OS_CODEX_BIN=/path/to/codex
AGENTIC_OS_ANTIGRAVITY_BIN=/path/to/agy
AGENTIC_OS_VAULT=~/.config/hermes/vault

# Port pinning (always 3001):
PORT=3001
```

---

## 7. CONTACT & ESCALATION

- **Operator:** DeWayne Xander — escalate blockers immediately via Telegram
- **Escalation path:** Asta → Chrono (file watcher/thread) → DeWayne
- Keep architectural changes coordinated with Chrono when they affect shared runtime behavior
- Prefer `~/codex-scratch/` for new work, then sync only the reviewed diff into the live tree
