import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { OPENCLAW_HOME, LEGACY_OPENCLAW_HOME } from "@/lib/agentHomes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALERTS_FILE = path.join(OPENCLAW_HOME, "workspace", "scripts", "chrono-alerts.json");
const LEGACY_ALERTS_FILE = path.join(LEGACY_OPENCLAW_HOME, "workspace", "scripts", "chrono-alerts.json");

// GET — fetch pending alerts (for Telegram polling)
export async function GET() {
  let alerts: any[] = [];
  try {
    const source = existsSync(ALERTS_FILE) ? ALERTS_FILE : (existsSync(LEGACY_ALERTS_FILE) ? LEGACY_ALERTS_FILE : null);
    if (source) {
      alerts = JSON.parse(readFileSync(source, "utf8"));
    }
  } catch { alerts = []; }

  // Return only alerts that require approval
  const pending = alerts.filter((a: any) => a.requiresApproval);
  return NextResponse.json({ alerts: pending, total: alerts.length });
}

// POST — inject a manual event or acknowledge/deny an alert
export async function POST(req: Request) {
  const body = await req.json();
  const { action, alertId, event } = body;

  if (action === "acknowledge" && alertId) {
    let alerts: any[] = [];
    try {
      const source = existsSync(ALERTS_FILE) ? ALERTS_FILE : (existsSync(LEGACY_ALERTS_FILE) ? LEGACY_ALERTS_FILE : null);
      if (source) alerts = JSON.parse(readFileSync(source, "utf8"));
    } catch { alerts = []; }
    const filtered = alerts.filter((a: any) => a.timestamp !== alertId);
    writeFileSync(ALERTS_FILE, JSON.stringify(filtered, null, 2));
    try { writeFileSync(LEGACY_ALERTS_FILE, JSON.stringify(filtered, null, 2)); } catch {}
    return NextResponse.json({ ok: true, acknowledged: alertId, remaining: filtered.length });
  }

  if (action === "inject" && event) {
    let alerts: any[] = [];
    try {
      if (existsSync(ALERTS_FILE)) alerts = JSON.parse(readFileSync(ALERTS_FILE, "utf8"));
    } catch { alerts = []; }
    alerts.push({
      severity: event.severity || "info",
      event: event,
      message: event.message || "Manual event injection",
      requiresApproval: event.requiresApproval !== false,
      timestamp: Date.now(),
    });
    if (alerts.length > 50) alerts = alerts.slice(-50);
    writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));
    try { writeFileSync(LEGACY_ALERTS_FILE, JSON.stringify(alerts, null, 2)); } catch {}
    return NextResponse.json({ ok: true, injected: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
