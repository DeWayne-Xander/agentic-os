import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FASTAPI_BASE = "http://127.0.0.1:8080";

export async function GET() {
  // Check FastAPI but don't fail if it's down
  let fastapi: Record<string, unknown> = { status: "unknown" };
  try {
    const r = await fetch(`${FASTAPI_BASE}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (r.ok) {
      fastapi = await r.json();
    } else {
      fastapi = { status: "unhealthy", http: r.status };
    }
  } catch (e) {
    fastapi = { status: "unavailable", error: String(e) };
  }

  return NextResponse.json({
    ok: true,
    location: "Phoenix, AZ",
    timezone: "America/Phoenix",
    fastapi,
  });
}
