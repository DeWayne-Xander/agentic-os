#!/bin/bash
set -euo pipefail

export NODE_OPTIONS="--dns-result-order=ipv4first"
export TELEGRAM_BOT_TOKEN="8875033602:AAFCAG2nwNzt5mLWAkS8SZh9IHsaBKYjSY8"
export ADMIN_TELEGRAM_ID="8773216528"
export SOUL_CONFIG="./kairos_soul.md"

echo "🦉 Owl Alpha Engine: Initializing Kairos within Next.js framework..."
# Execute via the package dev script so the API route mounts with full context
npm run dev
