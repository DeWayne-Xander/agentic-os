import { NextResponse } from "next/server";
import { readProjectFile, writeProjectFile } from "@/lib/codexWorkspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const project = url.searchParams.get("project") ?? "";
  const rel = url.searchParams.get("path") ?? "";
  if (!project || !rel) return NextResponse.json({ error: "project and path required" }, { status: 400 });
  const res = await readProjectFile(project, rel);
  if (!res) return NextResponse.json({ error: "file not found" }, { status: 404 });
  return NextResponse.json(res);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const project = String(body.project ?? "").trim();
  const rel = String(body.path ?? "").trim();
  const content = String(body.content ?? "");
  const goalId = typeof body.goalId === "string" ? body.goalId.trim() : undefined;
  const summary = typeof body.summary === "string" ? body.summary.trim() : undefined;
  const envChanges = body.envChanges && typeof body.envChanges === "object" ? body.envChanges as Record<string, unknown> : undefined;
  if (!project || !rel) return NextResponse.json({ error: "project and path required" }, { status: 400 });
  const res = await writeProjectFile(project, rel, content, { goalId, summary, envChanges });
  if (!res) return NextResponse.json({ error: "write failed" }, { status: 400 });
  return NextResponse.json({ ok: true, ...res });
}
