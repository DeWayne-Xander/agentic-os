import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Activity log sources — Pantheon agents via Hermes
const STREAMS: { agent: string; dir: string }[] = [
  { agent: "hermes", dir: path.join(os.homedir(), ".hermes-agent") },
];

export async function GET() {
  const entries: { ts: number; agent: string; text: string; level?: string }[] = [];

  for (const s of STREAMS) {
    try {
      const dir = await fs.readdir(s.dir, { withFileTypes: true });
      const logFiles = dir
        .filter((d) => d.isFile() && (d.name.endsWith(".log") || d.name.endsWith(".jsonl")))
        .slice(0, 3);
      for (const f of logFiles) {
        const raw = await fs.readFile(path.join(s.dir, f.name), "utf-8");
        const lines = raw.split("\n").filter(Boolean).slice(-30);
        for (const line of lines) {
          try {
            const j = JSON.parse(line);
            entries.push({
              ts: j.ts ?? Date.now(),
              agent: s.agent,
              text: j.text ?? j.message ?? line.slice(0, 200),
              level: j.level,
            });
          } catch {
            entries.push({ ts: Date.now(), agent: s.agent, text: line.slice(0, 200) });
          }
        }
      }
    } catch { /* ignore */ }
  }

  entries.sort((a, b) => a.ts - b.ts);
  return NextResponse.json({ entries: entries.slice(-100) });
}
