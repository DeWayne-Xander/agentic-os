# Agent OS — Pack

A complete dashboard that wires together Claude Code, OpenClaw, Hermes, Gemini, Antigravity, Codex, and Free Claude Code into a single Mission Control. Adds Studio (Grok image / X-search / voice / live talk), Hermes Goal Mode (autonomous long-runs), and a Video studio (HyperFrames + AI Avatar).

This pack contains the full source — drop it in, run it, ship it.

---

## What's in this pack

```
agent-os-pack/
├── README.md                      ← you are here
├── source/                        ← the entire Next.js app
│   ├── src/                       ← 34 components, 92 API routes
│   ├── public/                    ← static assets, design references
│   ├── package.json
│   ├── README.md                  ← short setup quickref
│   ├── AGENTS.md                  ← how to install each agent CLI
│   ├── BUILD-YOUR-OWN.md          ← architectural walkthrough
│   ├── NOTEBOOK-SETUP.md          ← NotebookLM MCP wiring
│   └── SEO-SETUP.md               ← SEO module setup
├── design/                        ← brand tokens, font stack reference
└── examples/                      ← five real HyperFrames compositions
    ├── showcase-1-agent-os-intro/   60s cinematic hero
    ├── showcase-2-feature-reel/     90s split-screen feature tour
    ├── showcase-3-vlog-update/      90s vlog template
    ├── nlm-real-1-peril-wrap/       Real NotebookLM video edited
    └── nlm-real-2-side-by-side/     Two NLM videos compared
```

## Why agents might appear "missing" after install

If you see the dashboard but the **Claude / OpenClaw / Hermes** tiles in section II are showing **Offline** or empty values, the dashboard is working — you just don't have those CLIs installed locally yet.

The dashboard always *renders* the agent cards. What it can't do is *talk to a CLI that isn't there*.

See `source/AGENTS.md` for one-line install commands for each agent.

---

## 5-minute setup

```bash
cd source
npm install
cp agentic-os.config.example.json ~/.agentic-os/config.json
npm run dev
```

Open http://localhost:3000.

The dashboard works even with **zero** agents installed. Install them one by one as you need them — see `INSTALL-AGENTS.md`.

### Production build

```bash
npm run build && npm run start
```

This pack has been tested on **Node 22.19+ / npm 10.9+ / Next 16.2.6 / TypeScript 5.9**. If your build fails on a different stack, file an issue.

---

## Install the agent CLIs (one-liners)

```bash
# Claude Code
npm i -g @anthropic-ai/claude-code && claude --version

# OpenClaw (local agent gateway)
brew install openclaw      # or: cargo install openclaw

# Hermes (Nous Research agent)
npm i -g @nousresearch/hermes-agent
hermes login

# Gemini CLI (sunsets 2026-06-18 — use Antigravity instead)
npm i -g @google/gemini-cli

# Antigravity (Google's Gemini CLI successor)
npm i -g @google/antigravity   # binary name: agy

# Codex CLI (OpenAI)
npm i -g @openai/codex

# Free Claude Code (uses claude binary + fcc-server proxy)
# See source/AGENTS.md for the OpenRouter / NVIDIA NIM proxy setup
```

After installing any CLI, refresh the dashboard. Section II "Vitals" will pick it up automatically.

---

## API keys (optional features)

These features are powered by external APIs. Each has a free tier; the dashboard works without them.

- **OpenClaw Studio (image, video, voice, X-search)** — Grok 4.3 via xAI OAuth. Sign in once via the Studio tab.
- **AI Avatar Studio** (in the Video section) — needs a HeyGen API key. Put it in `~/.agentic-os/heygen.env` as `HEYGEN_API_KEY=sk_V2_...` and chmod 600 that file. Never commit it.
- **NotebookLM integration** — uses the `notebooklm-mcp` server. See `source/NOTEBOOK-SETUP.md`.

---

## Featured sections

- **Mission Control** — vitals, agent grid, self (goals/journal/memory), live activity stream
- **Each Agent** — full chat + workspace + control room
- **OpenClaw Studio** — Image, X-Search, TTS, Video, **Talk** (live voice chat with Grok, browser-native STT/TTS, ~7s round-trip), all with persistent history
- **Hermes Goal Mode** — set a long-horizon goal, walk away, Hermes runs autonomously until done
- **Video** — HyperFrames composition runner + AI Avatar Studio + Workspace browser
- **SEO / Notebook / Kanban / Goals / Journal / Memory** — personal productivity layers grounded in your Obsidian vault

---

## Examples folder

Five working HyperFrames compositions you can render and tweak:

```bash
cd examples/showcase-1-agent-os-intro
npx hyperframes render
# → ./out/<timestamp>.mp4
```

Each example includes `index.html` (the composition), `hyperframes.json` (config), and `agent-os.meta.json` (Agent OS workspace metadata).

The two `nlm-real-*` examples show how to take any NotebookLM-generated video overview and edit it with HyperFrames — see their `agent-os.meta.json` for the source NLM artifact IDs.

---

## Made with Agent OS

Built by Julian Goldie · AI Profit Boardroom · agentos.guide
