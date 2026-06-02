#!/bin/bash
# Start Agentic OS Pack — Pantheon Edition
# Uses Node 24 for node:sqlite support
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 24.15.0

cd "$(dirname "$0")"
echo "🧠 Agentic OS Pack — Pantheon Edition"
echo "   Node: $(node --version)"
echo "   URL:  http://localhost:3001"
echo ""
npm run dev
