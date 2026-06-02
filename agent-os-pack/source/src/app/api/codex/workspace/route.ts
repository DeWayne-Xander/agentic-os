import { NextResponse } from "next/server";
import { listProjects, listProjectFiles, CODEX_SCRATCH_ROOT } from "@/lib/codexWorkspace";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const project = url.searchParams.get("project");
  if (project) {
    const res = await listProjectFiles(project);
    if (!res) return NextResponse.json({ error: "project not found" }, { status: 404 });
    return NextResponse.json(res);
  }
  const projects = await listProjects();
  return NextResponse.json({ projects, root: CODEX_SCRATCH_ROOT, exists: existsSync(CODEX_SCRATCH_ROOT) });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
    return NextResponse.json({ error: "invalid project name" }, { status: 400 });
  }
  const dir = path.join(CODEX_SCRATCH_ROOT, name);
  await mkdir(dir, { recursive: true });
  return NextResponse.json({ ok: true, project: name, root: dir });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const from = String(body.from ?? "").trim();
  const to = String(body.to ?? "").trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(from) || !/^[A-Za-z0-9_.-]+$/.test(to)) {
    return NextResponse.json({ error: "invalid project name" }, { status: 400 });
  }
  const fromDir = path.join(CODEX_SCRATCH_ROOT, from);
  const toDir = path.join(CODEX_SCRATCH_ROOT, to);
  if (!existsSync(fromDir)) return NextResponse.json({ error: "project not found" }, { status: 404 });
  if (existsSync(toDir)) return NextResponse.json({ error: "target exists" }, { status: 409 });
  await import("node:fs/promises").then(({ rename }) => rename(fromDir, toDir));
  return NextResponse.json({ ok: true, project: to });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const project = url.searchParams.get("project") ?? "";
  if (!/^[A-Za-z0-9_.-]+$/.test(project)) {
    return NextResponse.json({ error: "project required" }, { status: 400 });
  }
  const dir = path.join(CODEX_SCRATCH_ROOT, project);
  if (!existsSync(dir)) return NextResponse.json({ error: "project not found" }, { status: 404 });
  await import("node:fs/promises").then(({ rm }) => rm(dir, { recursive: true, force: true }));
  return NextResponse.json({ ok: true });
}
