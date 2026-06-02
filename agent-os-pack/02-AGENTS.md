# 🤖 The seven agents

Which agent for what.

Pick based on cost + capability + speed.

---

## 1. Claude

**What it is:** Anthropic's Claude Code CLI.

**When to use:** the gold standard. Best at long-context reasoning + code. Pay per token.

**Cost:** $3/M input, $15/M output (Sonnet 4).

**Strengths:** thinks longest. Best for agent workflows + cross-file refactors.

**Weaknesses:** the bill adds up fast if you run it all day.

---

## 2. OpenClaw

**What it is:** open-source agent built by my team.

**When to use:** when you want a free agent that integrates tightly with the rest of your stack.

**Cost:** free. Runs locally.

**Strengths:** plays nice with your Obsidian vault + memory.

**Weaknesses:** less polished than Claude.

---

## 3. Hermes

**What it is:** Nous Research's persistent agent.

**When to use:** when you want an agent with MEMORY across sessions. Builds reusable skills.

**Cost:** free if you self-host. Pay if you use their cloud.

**Strengths:** 40+ built-in tools (web search, browser automation, vision). Voice in.

**Weaknesses:** setup is more involved than the others.

---

## 4. Gemini

**What it is:** Google's coding CLI.

**When to use:** for tasks that benefit from Gemini's massive context window (1M tokens).

**Cost:** free tier is generous.

**Strengths:** great at long documents + image understanding.

**Weaknesses:** sunsets 18 June 2026 — use Antigravity instead.

---

## 5. Antigravity

**What it is:** Gemini's successor. Go-based agentic harness.

**When to use:** for multi-agent + async workflows. Has its own scratch workspace.

**Cost:** free with your Gemini account.

**Strengths:** robust browser tool. Plugins. Async tasks that run for days.

**Weaknesses:** still maturing.

---

## 6. Codex

**What it is:** OpenAI's coding agent.

**When to use:** when you want OpenAI's reasoning + tool use. Pairs nicely with ChatGPT Pro.

**Cost:** included if you have ChatGPT Pro.

**Strengths:** Goal Mode (set long-running goals, walk away, come back to results). Sessions browser.

**Weaknesses:** quotas can be tight.

---

## 7. Free Claude Code

**What it is:** the SAME Claude CLI, but routed through a local proxy to OpenRouter or another provider.

**When to use:** when you want Claude Code's interface at $0/token. Owl Alpha is free.

**Cost:** free.

**Strengths:** zero per-token cost. Same exact tooling. Save 90% on Claude bills.

**Weaknesses:** Owl Alpha is slower (~12 tok/s). Swap to a faster model anytime.

---

## 🎯 How I pick

For deep coding work where it matters → Claude.

For long-running goals while I sleep → Codex Goal Mode.

For free coding at scale → Free Claude Code with Owl Alpha.

For research + browsing → Hermes Agent.

For massive document analysis → Gemini.

For multi-agent harness → Antigravity.

For local + private → OpenClaw.

---

## 🪙 Cost example — building a landing page

Same task. Same complexity.

Anthropic Claude direct → ~$2 in tokens.

Codex via ChatGPT Pro → already paid.

Free Claude Code → $0.

OpenClaw → $0.

Hermes self-hosted → $0.

Pick based on what you have already.

Not what the marketing tells you.

---

## ⚡ Mix them

Most days I use 3-4 agents.

Claude for the hard architecture stuff.

Codex Goal Mode for overnight builds.

Free Claude Code for the bulk of the work.

Hermes for memory + voice.

They don't compete. They cover different jobs.
