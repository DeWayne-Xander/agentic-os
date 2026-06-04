import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = process.cwd();
const FILES = [
  "package.json",
  "src/app/page.tsx",
  "src/app/layout.tsx",
  "src/components/Shell.tsx",
  "src/components/ClientBody.tsx",
  "src/components/TopBar.tsx",
  "src/components/Overview.tsx",
  "src/components/Vitals.tsx",
  "src/components/ActivityStream.tsx",
  "src/components/UnifiedChat.tsx",
  "src/context/ChatContext.tsx",
  "src/context/EnhancedChatContext.tsx",
  "src/lib/state-manager.ts",
  "src/app/api/state/route.ts",
  "src/app/api/cron/status/route.ts",
];

async function fingerprint() {
  const h = crypto.createHash("sha1");
  h.update(ROOT);
  for (const rel of FILES) {
    const abs = path.join(ROOT, rel);
    try {
      const st = await fs.stat(abs);
      h.update(`${rel}:${st.size}:${Math.floor(st.mtimeMs)};`);
    } catch {
      h.update(`${rel}:missing;`);
    }
  }
  return h.digest("hex");
}

export async function GET() {
  return NextResponse.json(
    {
      version: await fingerprint(),
      generatedAt: Date.now(),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    }
  );
}
