# 🛠️ Install — Agent OS

Setup from zero.

In order. Don't skip.

About 30 minutes if you're new to Node.

---

## 🧱 Step 1 · Install the prerequisites

You need:

- macOS or Linux (Windows works with WSL2)
- **Node 22 or higher** (required — the Kanban reads its data via Node's built-in SQLite, which only exists on Node 22+. On Node 20 the Kanban board won't load.)
- Python 3.14 + `uv` — only if you want Free Claude Code (optional)

Check what you have:

```bash
node -v
python3 --version
```

If Node is missing or older than 22, install it via Homebrew (simplest, one command):

```bash
brew install node@22
```

If you don't have Homebrew, get it from [brew.sh](https://brew.sh) — same command they show on the homepage.

If `uv` is missing and you want Free Claude Code, install it:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
uv python install 3.14
```

> The `astral.sh/uv` URL above is the official installer for `uv`, not anything I host. You can read the script before piping into bash if you want to verify.

---

## 📁 Step 2 · Copy the Agent OS source onto your machine

**There is no GitHub clone step.** The full source is already in this pack, under `source/`.

### 2a. First, navigate into the unzipped pack

If you double-clicked the zip on macOS, Safari/Finder extracted it to `~/Downloads/agent-os-pack/`. **You have to `cd` into that folder before any of the copy commands below will find `./source/`.**

```bash
cd ~/Downloads/agent-os-pack
```

If you extracted it somewhere else, `cd` there instead.

### 2b. Verify you're in the right place

Run `ls` — you should see something like this:

```
01-INSTALL.md    02-AGENTS.md    03-DESIGN-SYSTEM.md    04-WORKSPACE-PATTERN.md
05-TRAVEL-MODE.md    README.md    design/    examples/    source/
```

If you don't see `source/` in that list, you're in the wrong directory — go back and `cd` into wherever you unzipped the pack.

### 2c. Copy it to its final home + install dependencies

I keep mine at `~/Agentic OS/agentic-os/`. Pick wherever you want.

```bash
# Make the destination
mkdir -p ~/Agentic\ OS

# Copy the bundled source into it (./source must exist in your CURRENT directory)
cp -R ./source ~/Agentic\ OS/agentic-os

# Move in + install dependencies
cd ~/Agentic\ OS/agentic-os
npm install
```

That's it for the dashboard itself. `npm install` will pull all the Next.js, React, Tailwind, etc. dependencies from npm — that step needs an internet connection once. After that, the dashboard runs fully local.

### Troubleshooting

- **"No such file or directory" when running `cp -R ./source ...`** — you skipped step 2a. Your terminal is in the wrong folder. Run `cd ~/Downloads/agent-os-pack` first, then re-run the copy.
- **`zsh: command not found: npm`** — Node isn't installed. Go back to Step 1.
- **macOS asks "are you sure you want to open this?"** — say yes. Pack contents are normal JS/TS source code.

---

## 🤖 Step 3 · Install the agents you want

You don't need all seven.

Pick what you'll actually use.

Each agent has its own install — these are all third-party tools, installed via their official channels.

**Claude Code** — Anthropic's CLI.

```bash
npm install -g @anthropic-ai/claude-code
claude login
```

**OpenClaw** — open-source agent.

```bash
# Follow openclaw.ai install guide
```

**Hermes Agent** — Nous Research.

```bash
pip install nousresearch-hermes
hermes auth login
```

**Gemini** — Google's coding CLI.

```bash
npm install -g @google/gemini-cli
gemini auth
```

**Antigravity** — Gemini's successor.

```bash
brew install agy
agy auth
```

**Codex** — OpenAI's coding agent.

```bash
npm install -g @openai/codex
codex login
```

**Free Claude Code** — open-source proxy that lets you use Claude Code tooling against any OpenRouter model. This one is a third-party tool maintained by another developer — the install command below pulls it from where they publish it.

```bash
uv tool install --force "git+https://github.com/Alishahryar1/free-claude-code.git"
fcc-init
# Then edit ~/.fcc/.env and paste your OpenRouter key
```

(See `agents/free-claude-code-setup.md` for the full walk-through.)

---

## 📓 Step 4 · Point at your Obsidian vault

The dashboard reads from your vault.

So Goals, Journal, and Memory all show real content.

Set the path:

```bash
mkdir -p ~/.agentic-os
cat > ~/.agentic-os/config.json <<EOF
{
  "vaultRoot": "/Users/yourname/Documents/Obsidian Vault"
}
EOF
```

Replace the path with where YOUR vault lives.

(There's also a template in `source/agentic-os.config.example.json` you can copy.)

---

## 🚀 Step 5 · Start the dashboard

```bash
cd ~/Agentic\ OS/agentic-os
npm run dev
```

You should see:

```
✓ Ready in 200ms
- Local:  http://localhost:3000
```

Open that URL. (Next.js dev server uses port 3000 by default. If you want a different port, run `PORT=3737 npm run dev` instead.)

You'll land on Mission Control.

Every agent you installed will show ONLINE.

---

## 🦉 Step 6 · Optional — wire Free Claude Code

If you want zero-cost Claude Code via OpenRouter:

```bash
fcc-server
```

Leave it running.

Open the dashboard.

Click `Free Claude Code` in the sidebar.

You'll see the chat panel + Workspace tab.

(Full walk-through in `agents/free-claude-code-setup.md`.)

---

## ✅ You're done

Bookmark `localhost:3000`.

That's your command centre.

Open it every morning.

Wire in any new agents using the same pattern (see `04-WORKSPACE-PATTERN.md`).

If something breaks, check the dev server log:

```bash
tail -f /tmp/aos-dev.log
```

If you want to use it from anywhere (not just your home machine):

Read `05-TRAVEL-MODE.md`.

It walks you through Tailscale.

10 minutes to set up. Free forever.

---

## 🔒 What you DON'T need

You don't need a GitHub account.

You don't need to fork anything.

You don't need a cloud account anywhere.

You don't need to expose any port to the internet (unless you opt in to Travel Mode via Tailscale).

The source is in this pack. The agents are CLIs on your machine. The data is in your Obsidian vault. That's the whole stack.
