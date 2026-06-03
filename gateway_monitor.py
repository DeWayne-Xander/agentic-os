#!/usr/bin/env python3
"""
Gateway Runtime Status Monitor
Polls the gateway's runtime state file and PID at a configurable interval.
Captures: uptime, active connections, throughput, error rate, restart tracking.
Maintains a rolling window of 5 minutes of metrics.
Emits WARN on error rate >5% or unexpected zero connections.
"""

import json
import logging
import os
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ─── Paths ────────────────────────────────────────────────────────────

HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes-agent"))
GATEWAY_STATE_FILE = HERMES_HOME / "gateway_state.json"
GATEWAY_PID_FILE = HERMES_HOME / "gateway.pid"

# ─── Config ───────────────────────────────────────────────────────────

DEFAULT_POLL_INTERVAL = 15           # seconds
DEFAULT_ROLLING_WINDOW = 300         # 5 minutes
ERROR_RATE_WARN_THRESHOLD = 5.0     # percent
ZERO_CONNECTIONS_WARN = True         # warn when active_platforms drops to 0


class GatewayMetricEntry:
    """Single snapshot of gateway metrics."""

    def __init__(self, metrics: dict, warnings: list[str], timestamp: str = None):
        self.metrics = metrics
        self.warnings = warnings
        self.timestamp = timestamp or datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict:
        return {
            "metrics": self.metrics,
            "warnings": self.warnings,
            "timestamp": self.timestamp,
        }


class GatewayMonitor:
    """
    Polls gateway_state.json and gateway.pid at a configurable interval.
    Captures uptime, active connections, error rate, throughput.
    Maintains a rolling window and emits threshold warnings.
    """

    def __init__(
        self,
        poll_interval: int = DEFAULT_POLL_INTERVAL,
        rolling_window: int = DEFAULT_ROLLING_WINDOW,
        hermes_home: Path = None,
    ):
        self.poll_interval = poll_interval
        self.rolling_window = rolling_window
        self.hermes_home = hermes_home or HERMES_HOME
        self.state_file = self.hermes_home / "gateway_state.json"
        self.pid_file = self.hermes_home / "gateway.pid"

        self._running = False
        self._entries: deque[GatewayMetricEntry] = deque()
        self._max_entries = max(rolling_window // poll_interval, 1)
        self._last_state: Optional[dict] = None
        self._restart_count = 0
        self._last_pid: Optional[int] = None
        self._start_time = None
        self._prev_timestamp: Optional[float] = None
        self._prev_error_count: int = 0
        self._prev_request_count: int = 0

    # ─── Public API ────────────────────────────────────────────────

    def start(self):
        """Start the gateway monitor loop (non-blocking background thread)."""
        import threading
        self._running = True
        self._start_time = datetime.now(timezone.utc).isoformat()
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="gateway-monitor")
        self._thread.start()
        logger.info("Gateway monitor started (interval=%ds)", self.poll_interval)

    def stop(self):
        """Signal the monitor to stop and wait for the thread."""
        self._running = False
        if hasattr(self, "_thread"):
            self._thread.join(timeout=self.poll_interval + 2)
        logger.info("Gateway monitor stopped")

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def last_checked(self) -> Optional[str]:
        if self._entries:
            return self._entries[-1].timestamp
        return None

    def get_status(self) -> dict:
        """Return current gateway status summary."""
        if not self._entries:
            return {
                "status": "unknown",
                "last_checked": None,
                "uptime": self._start_time,
                "polls_performed": 0,
                "metrics": {},
            }
        latest = self._entries[-1]
        rolling = self._get_rolling_stats()
        return {
            "gateway_status": self._derive_status(latest),
            "last_checked": latest.timestamp,
            "uptime": self._start_time,
            "polls_performed": len(self._entries),
            "restart_count": self._restart_count,
            "latest_metrics": latest.metrics,
            "latest_warnings": latest.warnings,
            "rolling_window": rolling,
        }

    def get_summary_line(self) -> str:
        """Return a single-line text summary suitable for logging."""
        s = self.get_status()
        metrics = s.get("latest_metrics", {})
        warnings = s.get("latest_warnings", [])
        parts = [
            f"gateway={s.get('gateway_status', 'unknown')}",
            f"conns={metrics.get('active_connections', '?')}",
            f"err_rate={metrics.get('error_rate_pct', 0):.1f}%",
            f"req_s={metrics.get('throughput_req_s', 0):.1f}",
        ]
        if warnings:
            parts.append(f"warnings={','.join(warnings)}")
        return " ".join(parts)

    # ─── Internal Loop ────────────────────────────────────────────

    def _run_loop(self):
        while self._running:
            try:
                entry = self._poll_once()
                self._entries.append(entry)
                while len(self._entries) > self._max_entries:
                    self._entries.popleft()
                self._last_state = entry.to_dict()

                for w in entry.warnings:
                    logger.warning("Gateway monitor: %s", w)
            except Exception:
                logger.exception("Error in gateway monitor loop")

            for _ in range(int(self.poll_interval * 10)):
                if not self._running:
                    break
                time.sleep(0.1)

    def _poll_once(self) -> GatewayMetricEntry:
        """Read the gateway state file and extract metrics."""
        metrics: dict = {}
        warnings: list[str] = []

        # Read state file
        state_raw: dict = {}
        if self.state_file.exists():
            try:
                state_raw = json.loads(self.state_file.read_text())
                metrics["gateway_state"] = state_raw.get("gateway_state", "unknown")
            except (json.JSONDecodeError, OSError) as exc:
                metrics["gateway_state"] = "read_error"
                metrics["read_error"] = str(exc)
        else:
            metrics["gateway_state"] = "no_state_file"

        # Track PID changes (restarts)
        pid_data = self._read_pid_file()
        current_pid = pid_data.get("pid") if pid_data else None
        metrics["pid"] = current_pid

        if current_pid is not None:
            if self._last_pid is not None and current_pid != self._last_pid:
                self._restart_count += 1
                metrics["restart_detected"] = True
            self._last_pid = current_pid
        metrics["total_restarts"] = self._restart_count

        # Active connections from platform states
        platforms = state_raw.get("platforms", {})
        active_connections = sum(
            1 for p in platforms.values()
            if isinstance(p, dict) and p.get("state") == "connected"
        )
        metrics["active_connections"] = active_connections
        metrics["platforms"] = {
            name: info.get("state", "unknown")
            for name, info in platforms.items()
            if isinstance(info, dict)
        }

        # Uptime: from state start_time or fallback
        start_time = state_raw.get("start_time")
        if start_time:
            try:
                st = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
                metrics["uptime_seconds"] = int(
                    (datetime.now(timezone.utc) - st).total_seconds()
                )
            except (ValueError, TypeError):
                metrics["uptime_seconds"] = 0
        else:
            metrics["uptime_seconds"] = 0

        # Active agents
        metrics["active_agents"] = state_raw.get("active_agents", 0)

        # Error rate and throughput: derived from state raw counters if present,
        # or estimated from platform error metrics
        error_count = 0
        request_estimate = 0
        for name, pinfo in platforms.items():
            if isinstance(pinfo, dict):
                if pinfo.get("error_code") or pinfo.get("error_message"):
                    error_count += 1
                # Use updated_at changes as a rough activity proxy
                request_estimate += 1  # connected platform = activity

        now = time.time()
        if self._prev_timestamp is not None and now > self._prev_timestamp:
            dt = now - self._prev_timestamp
            new_errors = max(error_count - self._prev_error_count, 0)
            new_requests = max(request_estimate - self._prev_request_count, 0) + request_estimate

            if new_requests > 0:
                metrics["error_rate_pct"] = round(new_errors / new_requests * 100, 2)
            else:
                metrics["error_rate_pct"] = 0.0

            metrics["throughput_req_s"] = round(new_requests / max(dt, 0.001), 2)
        else:
            metrics["error_rate_pct"] = 0.0
            metrics["throughput_req_s"] = 0.0

        self._prev_timestamp = now
        self._prev_error_count = error_count
        self._prev_request_count = request_estimate

        if metrics["error_rate_pct"] > ERROR_RATE_WARN_THRESHOLD:
            warnings.append(
                f"error_rate_high: {metrics['error_rate_pct']:.1f}% > {ERROR_RATE_WARN_THRESHOLD}%"
            )

        if ZERO_CONNECTIONS_WARN and active_connections == 0 and metrics["gateway_state"] == "running":
            warnings.append("zero_active_connections")

        metrics["last_updated_at"] = state_raw.get("updated_at")
        metrics["last_restart_at"] = metrics.get("restart_detected") and datetime.now(timezone.utc).isoformat()

        return GatewayMetricEntry(metrics, warnings)

    def _read_pid_file(self) -> Optional[dict]:
        if not self.pid_file.exists():
            return None
        try:
            return json.loads(self.pid_file.read_text())
        except (json.JSONDecodeError, OSError):
            return None

    def _derive_status(self, entry: GatewayMetricEntry) -> str:
        """Map raw metrics to a simple status."""
        gw_state = entry.metrics.get("gateway_state", "")
        if gw_state in ("down", "read_error", "no_state_file"):
            return "down"
        if entry.metrics.get("restart_detected"):
            return "degraded"
        if entry.warnings:
            return "degraded"
        return "healthy"

    # ─── Rolling Window Stats ─────────────────────────────────────

    def _get_rolling_stats(self) -> dict:
        """Aggregate metrics over the rolling window."""
        if not self._entries:
            return {}

        error_rates = [e.metrics.get("error_rate_pct", 0) for e in self._entries]
        throughputs = [e.metrics.get("throughput_req_s", 0) for e in self._entries]
        connections = [e.metrics.get("active_connections", 0) for e in self._entries]

        def _safe_stats(values: list[float]) -> dict:
            if not values:
                return {"min": 0, "max": 0, "avg": 0, "last": 0}
            return {
                "min": round(min(values), 2),
                "max": round(max(values), 2),
                "avg": round(sum(values) / len(values), 2),
                "last": round(values[-1], 2),
            }

        total = len(self._entries)
        all_warns: list[str] = []
        for e in self._entries:
            all_warns.extend(e.warnings)

        return {
            "window_seconds": self.rolling_window,
            "total_polls": total,
            "error_rate": _safe_stats(error_rates),
            "throughput_req_s": _safe_stats(throughputs),
            "active_connections": _safe_stats(connections),
            "total_warnings": len(all_warns),
        }
