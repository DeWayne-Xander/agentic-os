#!/usr/bin/env python3
"""
Daemon Health Watch Loop
Monitors Hermes daemon/agent health by checking PID files,
process liveness, and heartbeat timestamps.

Polls at configurable interval (default 10s).
Reports: healthy / degraded / down with last-checked timestamp.
Maintains a rolling window of health check results.
"""

import json
import logging
import os
import signal
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import psutil

logger = logging.getLogger(__name__)

# ─── Paths (defaults, overridable per-instance) ───────────────────────

_DEFAULT_HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes-agent"))

# ─── Config ───────────────────────────────────────────────────────────

DEFAULT_POLL_INTERVAL = 10          # seconds
DEFAULT_ROLLING_WINDOW = 300        # 5 minutes
STALE_HEARTBEAT_THRESHOLD = 60      # seconds before heartbeat is stale
MAX_ACCEPTABLE_RESTARTS = 3         # per rolling window before degraded


class DaemonHealthEntry:
    """Single health check result."""

    def __init__(self, status: str, details: dict, timestamp: str = None):
        self.status = status  # "healthy" | "degraded" | "down"
        self.details = details
        self.timestamp = timestamp or datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "details": self.details,
            "timestamp": self.timestamp,
        }


class DaemonHealthMonitor:
    """
    Watches daemon health by:
    1. Checking PID file existence and process liveness
    2. Verifying heartbeat freshness
    3. Tracking restart frequency
    4. Monitoring resource usage (CPU, memory) of daemon processes
    """

    def __init__(
        self,
        poll_interval: int = DEFAULT_POLL_INTERVAL,
        rolling_window: int = DEFAULT_ROLLING_WINDOW,
        hermes_home: Path = None,
    ):
        self.poll_interval = poll_interval
        self.rolling_window = rolling_window
        self.hermes_home = hermes_home or _DEFAULT_HERMES_HOME

        self._pid_file = self.hermes_home / "gateway.pid"
        self._heartbeat_file = self.hermes_home / "health_heartbeat.json"

        self._running = False
        self._entries: deque[DaemonHealthEntry] = deque()
        self._max_entries = rolling_window // poll_interval
        self._last_status: Optional[dict] = None
        self._restart_count = 0
        self._last_pid: Optional[int] = None
        self._start_time = None

    # ─── Public API ────────────────────────────────────────────────

    def start(self):
        """Start the health watch loop (non-blocking, runs in background thread)."""
        import threading
        self._running = True
        self._start_time = datetime.now(timezone.utc).isoformat()
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="daemon-health-monitor")
        self._thread.start()
        logger.info("Daemon health monitor started (interval=%ds)", self.poll_interval)

    def stop(self):
        """Signal the monitor to stop and wait for the thread to finish."""
        self._running = False
        if hasattr(self, "_thread"):
            self._thread.join(timeout=self.poll_interval + 2)
        logger.info("Daemon health monitor stopped")

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def last_checked(self) -> Optional[str]:
        if self._entries:
            return self._entries[-1].timestamp
        return None

    def get_status(self) -> dict:
        """Return the current daemon health status."""
        if not self._entries:
            return {
                "status": "unknown",
                "last_checked": None,
                "uptime": self._start_time,
                "checks_performed": 0,
                "details": {},
            }
        latest = self._entries[-1]
        rolling = self._get_rolling_stats()
        return {
            "daemon_status": latest.status,
            "last_checked": latest.timestamp,
            "uptime": self._start_time,
            "checks_performed": len(self._entries),
            "restart_count": self._restart_count,
            "details": latest.details,
            "rolling_window": rolling,
        }

    # ─── Internal Loop ────────────────────────────────────────────

    def _run_loop(self):
        while self._running:
            try:
                entry = self._check_health()
                self._entries.append(entry)
                # Trim to rolling window
                while len(self._entries) > self._max_entries:
                    self._entries.popleft()
                self._last_status = entry.to_dict()

                if entry.status != "healthy":
                    logger.warning("Daemon health: %s — %s", entry.status, entry.details)
            except Exception:
                logger.exception("Error in daemon health check loop")

            # Interruptible sleep
            for _ in range(int(self.poll_interval * 10)):
                if not self._running:
                    break
                time.sleep(0.1)

    def _check_health(self) -> DaemonHealthEntry:
        """Perform a single health check cycle."""
        details: dict = {}
        issues: list[str] = []

        # 1. Check PID file
        pid, pid_details = self._check_pid_file()
        details["pid_file"] = pid_details

        if pid is None:
            return DaemonHealthEntry("down", {**details, "reason": "pid_file_missing_or_stale"})

        # 2. Check process liveness
        proc_details = self._check_process(pid)
        details["process"] = proc_details
        if not proc_details["alive"]:
            return DaemonHealthEntry("down", {**details, "reason": "process_not_running"})

        # 3. Track restarts
        if self._last_pid is not None and pid != self._last_pid:
            self._restart_count += 1
            details["restart_detected"] = True
        self._last_pid = pid

        # 4. Check heartbeat freshness
        heartbeat_details = self._check_heartbeat()
        details["heartbeat"] = heartbeat_details
        if not heartbeat_details["fresh"]:
            issues.append("stale_heartbeat")

        # 5. Check resource usage
        resource_details = self._check_resources(pid)
        details["resources"] = resource_details
        if resource_details.get("cpu_percent", 0) > 90:
            issues.append("high_cpu")
        if resource_details.get("memory_rss_mb", 0) > 2048:
            issues.append("high_memory")

        # 6. Too many restarts in window?
        if self._restart_count >= MAX_ACCEPTABLE_RESTARTS:
            issues.append("excessive_restarts")

        if issues:
            details["issues"] = issues
            return DaemonHealthEntry("degraded", details)

        return DaemonHealthEntry("healthy", details)

    # ─── Sub-checks ───────────────────────────────────────────────

    def _check_pid_file(self) -> tuple[Optional[int], dict]:
        """Read and validate the gateway PID file."""
        d = {"path": str(self._pid_file)}
        if not self._pid_file.exists():
            return None, {**d, "exists": False}

        try:
            data = json.loads(self._pid_file.read_text())
            pid = data.get("pid") if isinstance(data, dict) else int(data)
            d["pid"] = pid
            d["exists"] = True
            return pid, d
        except (json.JSONDecodeError, ValueError, TypeError) as exc:
            d["exists"] = True
            d["error"] = str(exc)
            return None, d

    def _check_process(self, pid: int) -> dict:
        """Check if a process with the given PID is alive and responding."""
        d = {"pid": pid}
        try:
            proc = psutil.Process(pid)
            d["alive"] = True
            d["status"] = proc.status()
            d["name"] = proc.name()
            d["uptime_seconds"] = int(time.time() - proc.create_time())
            d["pid"] = proc.pid
            return d
        except psutil.NoSuchProcess:
            d["alive"] = False
            d["error"] = "process_not_found"
            return d
        except psutil.AccessDenied:
            d["alive"] = True  # exists but can't inspect
            d["status"] = "access_denied"
            return d
        except Exception as exc:
            d["alive"] = False
            d["error"] = str(exc)
            return d

    def _check_heartbeat(self) -> dict:
        """Check the health heartbeat file for freshness."""
        d = {"path": str(self._heartbeat_file)}
        if not self._heartbeat_file.exists():
            return {**d, "exists": False, "fresh": True}  # No heartbeat file is OK

        try:
            data = json.loads(self._heartbeat_file.read_text())
            ts_str = data.get("timestamp") or data.get("updated_at")
            if ts_str:
                ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                age = (datetime.now(timezone.utc) - ts).total_seconds()
                d["age_seconds"] = round(age, 1)
                d["fresh"] = age < STALE_HEARTBEAT_THRESHOLD
            else:
                d["fresh"] = True
            d["exists"] = True
            return d
        except Exception as exc:
            d["exists"] = True
            d["error"] = str(exc)
            d["fresh"] = True
            return d

    def _check_resources(self, pid: int) -> dict:
        """Get CPU and memory usage for a process."""
        d: dict = {}
        try:
            proc = psutil.Process(pid)
            with proc.oneshot():
                d["cpu_percent"] = proc.cpu_percent(interval=0.1)
                mem = proc.memory_info()
                d["memory_rss_mb"] = round(mem.rss / (1024 * 1024), 1)
                d["memory_vms_mb"] = round(mem.vms / (1024 * 1024), 1)
                d["num_threads"] = proc.num_threads()
            return d
        except Exception as exc:
            d["error"] = str(exc)
            return d

    # ─── Rolling Window Stats ─────────────────────────────────────

    def _get_rolling_stats(self) -> dict:
        """Aggregate stats over the rolling window."""
        if not self._entries:
            return {}

        statuses = [e.status for e in self._entries]
        total = len(statuses)
        return {
            "window_seconds": self.rolling_window,
            "total_checks": total,
            "healthy_count": statuses.count("healthy"),
            "degraded_count": statuses.count("degraded"),
            "down_count": statuses.count("down"),
            "availability_pct": round(statuses.count("healthy") / total * 100, 1) if total else 0,
        }
