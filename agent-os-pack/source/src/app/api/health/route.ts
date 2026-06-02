import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FASTAPI_BASE = "http://127.0.0.1:8080";

export async function GET() {
  try {
    // Try FastAPI health first
    const r = await fetch(`${FASTAPI_BASE}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    const j = await r.json();
    return NextResponse.json({
      ok: true,
      location: "Phoenix, AZ",
      timezone: "America/Phoenix",
      fastapi: j,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      location: "Phoenix, AZ",
      timezone: "America/Phoenix",
      fastapi: { error: String(e) },
    }, { status: 503 });
  }
}
