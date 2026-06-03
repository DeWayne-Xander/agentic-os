import { NextResponse } from "next/server";
import { readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnStream } from "@/lib/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COMMANDS: Record<string, string[]> = {
  status: ["status"],
  doctor: ["doctor"],
  sessions: ["sessions", "list"],
  cron: ["status"],
};

function labyrinthArgs(args: string[]): string[] {
  return [...args, "--profile", "labyrinth"];
}

function cronSummary(): Promise<string> {
  const jobsDir = path.join(os.homedir(), ".openclaw", "workspace", "codex", "context", "scheduler", "jobs");
  return readdir(jobsDir)
    .then((entries) => {
      const jobs = entries.filter((n) => n.endsWith(".json")).sort();
      if (jobs.length === 0) return "No scheduled jobs found.";
      return ["Scheduled jobs:", ...jobs.map((j) => `- ${j}`)].join("\n");
    })
    .catch(() => "Scheduler jobs directory not available.");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "status";

  if (action === "cron") {
    return NextResponse.json({
      action,
      ok: true,
      stdout: await cronSummary(),
      stderr: "",
      code: 0,
      durationMs: 0,
    });
  }

  const args = COMMANDS[action];
  if (!args) return NextResponse.json({ error: "unknown action" }, { status: 400 });

  if (action === "doctor") {
    const child = spawnStream(
      "hermes",
      labyrinthArgs(args),
      { extraEnv: { ...process.env, HERMES_PROFILE: "labyrinth" } }
    );

    const out = await new Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string; durationMs: number }>((resolve) => {
      const started = Date.now();
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      child.on("close", (code) => {
        resolve({ ok: code === 0, code, stdout, stderr, durationMs: Date.now() - started });
      });
      child.on("error", (err) => {
        resolve({ ok: false, code: -1, stdout, stderr: String(err), durationMs: Date.now() - started });
      });
    });

    return NextResponse.json({
      action,
      ...out,
      stdout: [
        "Labyrinth diagnostics:",
        "- Engine: hermes profile labyrinth",
        "- Mode: deep reasoning",
        "- Route: /api/labyrinth/chat",
      ].join("\n"),
    });
  }

  const child = spawnStream(
    "hermes",
    labyrinthArgs(args),
    { extraEnv: { ...process.env, HERMES_PROFILE: "labyrinth" } }
  );

  const out = await new Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string; durationMs: number }>((resolve) => {
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => {
      resolve({ ok: code === 0, code, stdout, stderr, durationMs: Date.now() - started });
    });
    child.on("error", (err) => {
      resolve({ ok: false, code: -1, stdout, stderr: String(err), durationMs: Date.now() - started });
    });
  });

  return NextResponse.json({ action, ...out });
}
