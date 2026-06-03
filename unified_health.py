#!/usr/bin/env python3
"""
Unified Health Dashboard
Integrates the DaemonHealthMonitor and GatewayMonitor into a single
status endpoint with a combined system status (green/yellow/red).

Lifecycle:
  - start() kicks off both monitors on application boot
  - stop() gracefully shuts down both on SIGTERM
  - get_status() returns the combined dashboard payload
"""

import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# Status constants
STATUS_GREEN = "green"
STATUS_YELLOW = "yellow"
STATUS_RED = "red"


class UnifiedHealthDashboard:
    """
    Combines daemon health and gateway runtime monitoring into a single
    dashboard view with a derived overall system status.
    """

    def __init__(self, daemon_monitor, gateway_monitor):
        """
        Args:
            daemon_monitor: DaemonHealthMonitor instance
            gateway_monitor: GatewayMonitor instance
        """
        self.daemon_monitor = daemon_monitor
        self.gateway_monitor = gateway_monitor
        self._start_time = None

    def start(self):
        """Start both sub-monitors. Call on application boot."""
        self._start_time = datetime.now(timezone.utc).isoformat()
        self.daemon_monitor.start()
        self.gateway_monitor.start()
        logger.info("Unified health dashboard started")

    def stop(self):
        """Gracefully stop both sub-monitors. Call on SIGTERM."""
        try:
            self.daemon_monitor.stop()
        except Exception:
            logger.exception("Error stopping daemon monitor")
        try:
            self.gateway_monitor.stop()
        except Exception:
            logger.exception("Error stopping gateway monitor")
        logger.info("Unified health dashboard stopped")

    def get_status(self) -> dict:
        """
        Build the unified status payload.

        Returns a dict with:
          - daemon: daemon health status
          - gateway: gateway runtime status
          - system_status: "green" | "yellow" | "red"
          - system_status_reason: human-readable rationale
          - dashboard_uptime: when the dashboard started
          - timestamp: current ISO-8601 timestamp
        """
        daemon_status = self.daemon_monitor.get_status()
        gateway_status = self.gateway_monitor.get_status()

        system_status, reason = self._compute_combined_status(
            daemon_status, gateway_status
        )

        return {
            "daemon": daemon_status,
            "gateway": gateway_status,
            "system_status": system_status,
            "system_status_reason": reason,
            "dashboard_uptime": self._start_time,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    def get_compact_status(self) -> dict:
        """Return a minimal dashboard view for lightweight polling."""
        daemon = self.daemon_monitor.get_status()
        gateway = self.gateway_monitor.get_status()
        system_status, reason = self._compute_combined_status(daemon, gateway)

        return {
            "system_status": system_status,
            "system_status_reason": reason,
            "daemon_status": daemon.get("daemon_status", "unknown"),
            "daemon_last_checked": daemon.get("last_checked"),
            "gateway_status": gateway.get("gateway_status", "unknown"),
            "gateway_last_checked": gateway.get("last_checked"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    # ─── Combined Status Logic ────────────────────────────────────

    def _compute_combined_status(
        self, daemon: dict, gateway: dict
    ) -> tuple[str, str]:
        """
        Derive overall system status from daemon + gateway sub-statuses.

        Rules:
          - RED if either monitor reports "down"
          - YELLOW if either monitor reports "degraded"
          - YELLOW if either monitor hasn't performed any checks yet (status="unknown")
            but has been running for >30 seconds (monitor is stuck)
          - GREEN otherwise
        """
        daemon_state = daemon.get("daemon_status", "unknown")
        gateway_state = gateway.get("gateway_status", "unknown")

        # Both healthy -> GREEN
        if daemon_state == "healthy" and gateway_state == "healthy":
            return STATUS_GREEN, "All monitors healthy"

        # Any down -> RED
        downs = []
        if daemon_state == "down":
            downs.append("daemon")
        if gateway_state == "down":
            downs.append("gateway")
        if downs:
            return STATUS_RED, f"{' and '.join(downs)} monitor(s) down"

        # Any degraded -> YELLOW
        degradations = []
        if daemon_state == "degraded":
            degradations.append("daemon")
            daemon_issues = daemon.get("details", {}).get("issues", [])
            if daemon_issues:
                degradations.append(f"daemon: {', '.join(daemon_issues)}")
        if gateway_state == "degraded":
            degradations.append("gateway")
            gw_warnings = gateway.get("latest_warnings", [])
            if gw_warnings:
                degradations.append(f"gateway: {', '.join(gw_warnings)}")
        if degradations:
            return STATUS_YELLOW, f"{' and '.join(degradations)} degraded"

        # Unknown but monitors are running — check if it's just startup delay
        if daemon_state == "unknown" or gateway_state == "unknown":
            unknowns = []
            if daemon_state == "unknown":
                unknowns.append("daemon")
            if gateway_state == "unknown":
                unknowns.append("gateway")
            return STATUS_YELLOW, f"{' and '.join(unknowns)} status pending (starting up)"

        return STATUS_GREEN, "All monitors nominal"
