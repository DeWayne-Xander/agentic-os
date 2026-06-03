import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { recentNotes } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Activity log sources — Pantheon agents via Hermes + OpenClaw
const STREAMS: { agent: string; dir: string; files?: string[] }[] = [
  { agent: "chrono", dir: path.join(os.homedir(), ".hermes", "logs"), files: ["agent.log", "gateway.log", "errors.log"] },
  { agent: "openclaw", dir: path.join(os.homedir(), ".openclaw", "logs"), files: ["agent.log", "gateway.log", "errors.log"] },
];

export async function GET() {
  const entries: { ts: number; agent: string; text: string; level?: string }[] = [];

  for (const s of STREAMS) {
    try {
      const logFiles = s.files?.length
        ? s.files
        : (await fs.readdir(s.dir, { withFileTypes: true }))
            .filter((d) => d.isFile() && (d.name.endsWith(".log") || d.name.endsWith(".jsonl")))
            .map((d) => d.name)
            .slice(0, 3);
      for (const fileName of logFiles) {
        const raw = await fs.readFile(path.join(s.dir, fileName), "utf-8");
        const lines = raw.split("\n").filter(Boolean).slice(-30);
        for (const line of lines) {
          try {
            const j = JSON.parse(line);
            entries.push({
              ts: j.ts ?? Date.now(),
              agent: s.agent,
              text: j.text ?? j.message ?? j.event?.delta?.text ?? line.slice(0, 200),
              level: j.level,
            });
          } catch {
            entries.push({ ts: Date.now(), agent: s.agent, text: line.slice(0, 200) });
          }
        }
      }
    } catch { /* ignore */ }
  }

  try {
    const notes = await recentNotes(8);
    for (const note of notes) {
      entries.push({
        ts: note.mtime,
        agent: "memory",
        text: `${note.title} · ${note.path}`,
        level: "info",
      });
    }
  } catch { /* ignore */ }

  entries.sort((a, b) => b.ts - a.ts);
  return NextResponse.json({ entries: entries.slice(0, 100) });
}
