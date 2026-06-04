import os from "node:os";
import path from "node:path";

export const HOME = os.homedir();
export const AGENTIC_STATE_ROOT = process.env.AGENTIC_OS_STATE_ROOT ?? path.join(HOME, ".agentic-os");
export const HERMES_HOME = process.env.AGENTIC_OS_HERMES_HOME ?? path.join(AGENTIC_STATE_ROOT, "hermes");
export const OPENCLAW_HOME = process.env.AGENTIC_OS_OPENCLAW_HOME ?? path.join(AGENTIC_STATE_ROOT, "openclaw");

export const LEGACY_HERMES_HOME = path.join(HOME, ".hermes");
export const LEGACY_OPENCLAW_HOME = path.join(HOME, ".openclaw");
