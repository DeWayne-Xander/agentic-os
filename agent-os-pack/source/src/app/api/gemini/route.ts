// Deprecated: /api/gemini/* routes are retained for backward compatibility.
// They now proxy to the Labyrinth Hermes profile (deep reasoning engine).
import { NextResponse } from "next/server";
import { spawnStream } from "@/lib/runner";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "status";

  // Proxy to Hermes labyrinth profile
  try {
    const child = spawnStream(
      "hermes",
      ["status", "--profile", "labyrinth"],
      { extraEnv: { ...process.env, HERMES_PROFILE: "labyrinth" } }
    );
    let stdout = "";
    let stderr = "";
    await new Promise<void>((resolve) => {
      child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    });
    return NextResponse.json({ action, ok: true, stdout: stdout.trim(), stderr: stderr.trim(), version: "labyrinth-0.1" });
  } catch (err) {
    return NextResponse.json({ action, ok: false, error: String(err) }, { status: 500 });
  }
}
