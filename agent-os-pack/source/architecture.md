# ARCHITECTURE — System Structure, Integration Map & Data Flows

> **Last updated:** 2026-06-02 by Chrono
> **Purpose:** Complete architectural reference for how the Agentic OS is structured, how agents communicate, and how data flows through the system.

---

## 1. HIGH-LEVEL SYSTEM DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DEWAYNE (Operator)                          │
│                    Dashboard (http://localhost:3001)                │
└──────────┬───────────────────────────────────┬──────────────────────┘
           │ HTTPS (localhost)                 │ HTTPS (localhost)
           ▼                                   ▼
┌──────────────────────┐           ┌──────────────────────┐
│   Next.js Frontend   │           │  FastAPI Backend     │
│   Port 3001          │           │  Port 8080 (if up)   │
│   src/app/           │           │  Python              │
│   src/components/    │           └──────────────────────┘
└──────────┬───────────┘
           │ API calls (fetch)
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        API ROUTE LAYER                               │
│   src/app/api/<agent>/<action>/route.ts                             │
│                                                                      │
│   /api/claude/chat      /api/openclaw/chat    /api/hermes/chat      │
│   /api/labyrinth/chat   /api/codex/chat       /api/antigravity/chat │
│   /api/codex/workspace  /api/codex/goals      /api/codex/sessions   │
│   /api/goals            /api/journal          /api/memory           │
│   /api/health           /api/daemon           /api/run              │
└──────────┬───────────────────────────────────────────────────────────┘
           │ spawn() via runner.ts
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     CLI AGENT BINARIES                                │
│                                                                      │
│   claude  │  openclaw  │  hermes  │  codex  │  agy (antigravity)   │
│                                                                      │
│   All executed via runner.ts:                                        │
│   - spawn() with array args (never shell interpolation)              │
│   - validateFlagArgs() for safety                                    │
│   - agentEnv() for PATH injection                                    │
│   - Optional approval gate for dangerous operations                  │
└──────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        FILE SYSTEM (Local)                            │
│                                                                      │
│   ~/Projects/agentic-os-source/   ← Live source code (production)   │
│   ~/codex-scratch/                ← Asta sandbox workspace          │
│   ~/.agentic-os/                  ← State, goals, logs, config      │
│   ~/.codex/                       ← Codex session transcripts       │
│   ~/.config/hermes/vault/         ← Obsidian vault (markdown)       │
│   ~/.openclaw/logs/               ← OpenClaw logs                   │
│   ~/.hermes/cache/                ← Hermes cache/logs               │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. CONFIGURATION SYSTEM

### Load Order (highest to lowest priority)
1. **Environment variables** (`AGENTIC_OS_*` prefix)
2. **`~/.agentic-os/config.json`** (user override file)
3. **Auto-detection** (`which <binary>` for each CLI)
4. **Sensible defaults** (defined in `config.ts`)

### config.ts — Single Source of Truth
- Exports `config: AgenticConfig` object
- Exports `isAgentInstalled(agent): boolean`
- Exports `CLAUDE_MODEL: string` (currently `claude-opus-4-8`)
- All other files import from `@/lib/config`

### AgenticConfig Interface
```typescript
{
  claude: string | null;
  openclaw: string | null;
  hermes: string | null;
  labyrinth: string | null;       // defaults to hermes binary (different profile)
  antigravity: string | null;     // "agy" binary
  codex: string | null;
  vaultRoot: string | null;
  openclawLogs: string;
  hermesLogs: string;
  openclawAgent: string;
  goalCategories: string[];
  locationLabel: string;
}
```

---

## 3. RUNNER SYSTEM (src/lib/runner.ts)

### Core Functions
| Function | Purpose |
|----------|---------|
| `run(agent, args, opts)` | Execute agent, wait for result, return `RunResult` |
| `spawnStream(agent, args, opts)` | Execute agent, return `ChildProcess` for streaming |
| `validateFlagArgs(args)` | Sanitize arguments through regex whitelist |
| `agentEnv(extra)` | Build safe `PATH` including Homebrew + common bin dirs |
| `isAgentInstalled(agent)` | Check if binary exists |

### Supported Agents
```typescript
type AgentName = "claude" | "openclaw" | "hermes" | "labyrinth" | "antigravity" | "fcc" | "codex";
// Note: "fcc" maps to claude binary
```

### Result Shape
```typescript
interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}
```

### Approval Gate
```typescript
// When requireApproval is true:
// 1. Emits ApprovalRequest JSON to onApproval callback
// 2. Waits for frontend resolution
// 3. If denied → returns { ok: false, stderr: "[denied] ..." }

interface ApprovalRequest {
  type: "require_approval";
  run_id: string;
  reason: string;
  agent: string;
  args: string[];
  cwd: string;
}
```

---

## 4. MODEL ROUTING (src/lib/model-router.ts)

### Routing Tiers
| Tier | Model | Use Case |
|------|-------|----------|
| `heavy` | `openrouter/owl-alpha` | Deep reasoning, code analysis, complex tasks |
| `light` | `openrouter/owl-alpha` | Quick ops, status checks, simple queries |

### Agent Overrides
- `labyrinth`, `claude` → Always HEAVY
- `openclaw`, `kairos` → Always LIGHT
- Others → Keyword classification on prompt

### API Path Mapping
```typescript
apiPathForAgent("chrono")      → "/api/hermes/chat"
apiPathForAgent("claude")      → "/api/claude/chat"
apiPathForAgent("labyrinth")   → "/api/labyrinth/chat"
apiPathForAgent("openclaw")   → "/api/openclaw/chat"
apiPathForAgent("codex")       → "/api/codex/chat"
```

---

## 5. CODEX SUBSYSTEM

### Workspace Architecture (`codexWorkspace.ts`)
```
Buckets (virtual file groups):
  scratch    → ~/codex-scratch/          (Codex working space)
  state      → ~/.agentic-os/            (Goals, logs, config)
  goals      → ~/.agentic-os/codex-goals.json + logs
  obsidian   → ~/.config/hermes/vault/   (Shared memory)
  sessions   → ~/.codex/                 (Session transcripts)
```

### Goal Engine (`codexGoals.ts`)
```
Goal lifecycle:
  queued → running → completed
                   → failed
                   → stopped (user cancelled)

Persistence: ~/.agentic-os/codex-goals.json
Log files:   ~/.agentic-os/codex-goal-logs/<goal-id>.log
```

### Goal Interface
```typescript
interface CodexGoal {
  id: string;
  title: string;
  prompt: string;
  status: "queued" | "running" | "completed" | "failed" | "stopped";
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  pid?: number;            // For kill/stop
  cwd: string;             // Always ~/codex-scratch/<goal-id>/
  lastOutput?: string;     // Live preview
  logFile: string;         // Full transcript path
  exitCode?: number | null;
}
```

### Execution Flow
```
1. Frontend: POST /api/codex/goals { title, prompt }
2. API: Creates goal record, sets status=queued
3. Frontend: POST /api/codex/goals/:id/start
4. API: Calls codexGoals.startGoal(goal)
5. codexGoals.ts:
   a. Creates scratch dir: ~/codex-scratch/<goal-id>/
   b. Opens log file stream
   c. spawn("codex", ["exec", prompt], { cwd: scratchDir })
   d. Streams stdout+stderr to log file + lastOutput update
   e. On close: updates status (completed/failed)
6. Frontend: Polls GET /api/codex/goals for status updates
7. Frontend: Reads log file for live transcript
```

---

## 6. VIDEO SUBSYSTEM

### Components
| Component | File | Purpose |
|-----------|------|---------|
| VideoStudio | `src/components/VideoStudio.tsx` | Main video tab (3 sub-tabs) |
| videoProjects.ts | `src/lib/videoProjects.ts` | Project CRUD + render job state |
| videoWorkspace.ts | `src/lib/videoWorkspace.ts` | File browser for rendered output |
| heygen.ts | `src/lib/heygen.ts` | HeyGen API client |
| studioHistory.ts | `src/lib/studioHistory.ts` | Render history tracking |

### Sub-Tools
| Sub-Tab | Purpose | Status |
|---------|---------|--------|
| Create | HyperFrames CLI render workflow | Built |
| Avatar | AI avatar video (HeyGen) | Partial — heygen.ts exists, UI not wired |
| Workspace | Browse all rendered output | Built |

### Project Structure
```
~/.agentic-os/video-projects/<slug>/
  index.html          # User/AI-authored composition
  out/
    <timestamp>.mp4   # Rendered output
    <timestamp>.meta.json  # Render metadata sidecar
```

---

## 7. VAULT SYSTEM

### Architecture
```
┌─────────────────────────────────────────┐
│  Obsidian Vault (Markdown Files)        │
│  ~/.config/hermes/vault/                │
│                                         │
│  Agentic OS/                            │
│    Memories/                            │
│      YYYY-MM-DD.md     (daily notes)    │
│      goals.md          (active goals)   │
│      journal/          (daily entries)  │
│      decisions/        (key decisions)  │
└─────────────────────────────────────────┘
           ▲
           │ Writes from multiple sources:
           │
    ┌──────┼──────────┬──────────────┐
    │      │          │              │
    ▼      ▼          ▼              ▼
  API    Goals     Journal       Codex
 route   View      View         goals
(vault   (POST    (POST         (on
Writer)  /api/    /api/        completion)
         goals)   journal)
```

### vaultWriter.ts
- **Mutex-protected writes** — prevents concurrent writes from corrupting files
- `appendMemory(text, category)` — append to daily file
- `VAULT_ROOT` — resolved vault path

### vault.ts
- File listing + search within vault
- Used by Memory page component

---

## 8. PAGE ROUTES (Next.js App Router)

| Page Route | Component | Purpose |
|------------|-----------|---------|
| `/` | `page.tsx` | Mission Control dashboard |
| `/claude` | Claude chat | Claude Code chat panel |
| `/openclaw` | OpenClaw chat + Control Room | OpenClaw panel + infrastructure |
| `/hermes` | Hermes chat | Hermes Agent panel |
| `/labyrinth` | Labyrinth chat | Deep reasoning panel |
| `/codex` | CodexView | Codex CLI workspace + goals + sessions |
| `/gemini` | Gemini chat | Gemini CLI panel (sunsetting 2026-06-18) |
| `/antigravity` | AntigravityView | Antigravity CLI (agy) panel |
| `/video` | VideoStudio | Video creation workspace |
| `/studio` | OpenClawStudio | Full OpenClaw studio (79K chars) |
| `/goals` | GoalsView | Goals manager (writes to vault) |
| `/journal` | JournalView | Daily journal |
| `/memory` | Memory search | Search/browse vault |
| `/kanban` | Kanban board | Task board |
| `/notebook` | NotebookLM | NotebookLM integration (partial) |
| `/seo` | SEO tools | SEO pipeline tools |

---

## 9. API ROUTE MAP

| API Path | Methods | Purpose |
|----------|---------|---------|
| `/api/claude/chat` | POST | Claude chat |
| `/api/openclaw/chat` | POST | OpenClaw chat |
| `/api/hermes/chat` | POST | Hermes/Chrono chat |
| `/api/labyrinth/chat` | POST | Labyrinth deep reasoning |
| `/api/codex/chat` | POST | Codex chat |
| `/api/codex/workspace` | GET | List workspace projects |
| `/api/codex/workspace/file` | GET | Read file content |
| `/api/codex/preview/[...path]` | GET | File preview |
| `/api/codex/goals` | GET, POST | List/create goals |
| `/api/codex/goals/[id]` | GET, PUT, DELETE | Goal CRUD |
| `/api/codex/goals/[id]/start` | POST | Start goal execution |
| `/api/codex/goals/[id]/stop` | POST | Stop running goal |
| `/api/codex/sessions` | GET | List sessions |
| `/api/codex/session/[id]` | GET | Read session |
| `/api/antigravity/chat` | POST | Antigravity chat |
| `/api/goals` | GET, POST | Vault goals |
| `/api/journal` | GET, POST | Vault journal |
| `/api/memory/search` | GET | Vault search |
| `/api/memory/recent` | GET | Recent vault files |
| `/api/health` | GET | System health |
| `/api/daemon` | GET, POST | Daemon control |
| `/api/run` | POST | Agent execution with approval |

---

## 10. DAEMON CONTROL SYSTEM

### Two Paths (both pointing to port 3001)
1. **Programmatic:** `src/lib/daemon-ctl.ts` — `startServer()`, `stopServer()`, `restartServer()`, `getStatus()`
2. **API:** `src/app/api/daemon/route.ts` — `GET` for status, `POST` for start/stop/restart

### Daemon Config
```typescript
{
  launchCommand: "npm run dev -- --port 3001",  // ALWAYS port 3001
  port: 3001,
  projectRoot: "~/Projects/agentic-os-source/agent-os-pack/source",
}
```

### Compiler Gate (in daemon-ctl.ts)
- `runCompilerGate(cwd)` — runs `tsc --noEmit` in the given directory
- Returns `{ ok: boolean, output: string }`
- Used before syncing sandbox → production

---

## 11. STATE MANAGEMENT

### state-manager.ts
- Centralized in-memory state for the dashboard
- Tracks: agent statuses, active goals, health metrics
- Polled by the frontend every 2-5 seconds

### Persistent State Files
| File | Purpose |
|------|---------|
| `~/.agentic-os/config.json` | User configuration |
| `~/.agentic-os/codex-goals.json` | Codex goal records |
| `~/.agentic-os/video-render-jobs.json` | Video render job state |
| `~/.codex/session_index.jsonl` | Codex session index |

---

## 12. PANTHEON COMMUNICATION PATTERN

```
DeWayne
  │
  ▼
Chrono (Hermes default profile)
  │  ├── dispatches research ──→ Labyrinth (hermes --profile labyrinth)
  │  │                              └── writes results to Obsidian vault
  │  ├── dispatches code ───────→ Asta (Codex CLI)
  │  │                              └── writes to ~/codex-scratch/
  │  │                              └── Chrono file-watches → syncs to src/
  │  ├── monitors infra ────────→ Kairos (OpenClaw)
  │  │                              └── health, daemons, processes
  │  └── reports to DeWayne ────→ Telegram + Dashboard
  │
  └── All agents write to shared Obsidian vault
      └── Vault = single source of truth for memory
```

### Cross-Agent Communication Method
- **No direct agent-to-agent API calls**
- All coordination goes through:
  1. **File system** — agents write output to `~/codex-scratch/` or `~/.agentic-os/`
  2. **Obsidian vault** — shared memory store
  3. **Dashboard API** — Next.js API routes as the message bus
  4. **Telegram** — Chrono pushes notifications to DeWayne
