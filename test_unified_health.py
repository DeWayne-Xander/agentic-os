#!/usr/bin/env python3
"""
Comprehensive tests for the unified health dashboard.
Covers daemon monitor, gateway monitor, unified dashboard,
combined status logic, lifecycle management, and HTTP endpoints.
"""

import json
import os
import sys
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch, MagicMock

# Ensure we import from the workspace (project) directory
sys.path.insert(0, os.path.dirname(__file__))


class TestDaemonHealthMonitor(unittest.TestCase):
    """Tests for the daemon health watch loop."""

    def _make_monitor(self, tmpdir: Path, **kwargs):
        from daemon_monitor import DaemonHealthMonitor
        kwargs.setdefault("hermes_home", tmpdir)
        monitor = DaemonHealthMonitor(**kwargs)
        return monitor

    def test_init_defaults(self):
        from daemon_monitor import DaemonHealthMonitor, DEFAULT_POLL_INTERVAL, DEFAULT_ROLLING_WINDOW
        m = DaemonHealthMonitor()
        self.assertEqual(m.poll_interval, DEFAULT_POLL_INTERVAL)
        self.assertEqual(m.rolling_window, DEFAULT_ROLLING_WINDOW)
        self.assertIsNone(m.last_checked)
        self.assertFalse(m.is_running)

    def test_init_custom(self):
        from daemon_monitor import DaemonHealthMonitor
        m = DaemonHealthMonitor(poll_interval=5, rolling_window=60)
        self.assertEqual(m.poll_interval, 5)
        self.assertEqual(m.rolling_window, 60)

    def test_status_before_any_checks(self):
        from daemon_monitor import DaemonHealthMonitor
        m = DaemonHealthMonitor()
        status = m.get_status()
        self.assertEqual(status["status"], "unknown")
        self.assertIsNone(status["last_checked"])
        self.assertEqual(status["checks_performed"], 0)

    def test_pid_file_missing(self):
        """Monitor should report 'down' when PID file is missing."""
        from daemon_monitor import DaemonHealthMonitor
        with tempfile.TemporaryDirectory() as tmpdir:
            m = self._make_monitor(Path(tmpdir))
            entry = m._check_health()
            self.assertEqual(entry.status, "down")
            self.assertIn("reason", entry.details)

    def test_pid_file_with_invalid_json(self):
        from daemon_monitor import DaemonHealthMonitor
        with tempfile.TemporaryDirectory() as tmpdir:
            pid_file = Path(tmpdir) / "gateway.pid"
            pid_file.write_text("not-json{{{")
            m = self._make_monitor(Path(tmpdir))
            entry = m._check_health()
            self.assertEqual(entry.status, "down")

    def test_process_not_running(self):
        """Monitor should report 'down' for a stale PID."""
        from daemon_monitor import DaemonHealthMonitor
        with tempfile.TemporaryDirectory() as tmpdir:
            pid_file = Path(tmpdir) / "gateway.pid"
            pid_file.write_text(json.dumps({"pid": 99999999}))
            m = self._make_monitor(Path(tmpdir))
            entry = m._check_health()
            self.assertEqual(entry.status, "down")
            self.assertFalse(entry.details["process"]["alive"])

    def test_healthy_self_process(self):
        """Monitor should report 'healthy' when checking the current process."""
        from daemon_monitor import DaemonHealthMonitor
        with tempfile.TemporaryDirectory() as tmpdir:
            pid_file = Path(tmpdir) / "gateway.pid"
            pid_file.write_text(json.dumps({"pid": os.getpid()}))
            m = self._make_monitor(Path(tmpdir))
            entry = m._check_health()
            self.assertEqual(entry.status, "healthy")
            self.assertTrue(entry.details["process"]["alive"])

    def test_rolling_window_trims(self):
        """Rolling window should cap entries at max_entries."""
        from daemon_monitor import DaemonHealthMonitor
        with tempfile.TemporaryDirectory() as tmpdir:
            pid_file = Path(tmpdir) / "gateway.pid"
            pid_file.write_text(json.dumps({"pid": os.getpid()}))
            m = self._make_monitor(Path(tmpdir), poll_interval=1, rolling_window=3)
            m._max_entries = 3
            for _ in range(5):
                m._entries.append(m._check_health())
                while len(m._entries) > m._max_entries:
                    m._entries.popleft()
            self.assertEqual(len(m._entries), 3)

    def test_get_status_after_check(self):
        from daemon_monitor import DaemonHealthMonitor
        with tempfile.TemporaryDirectory() as tmpdir:
            pid_file = Path(tmpdir) / "gateway.pid"
            pid_file.write_text(json.dumps({"pid": os.getpid()}))
            m = self._make_monitor(Path(tmpdir))
            entry = m._check_health()
            m._entries.append(entry)
            status = m.get_status()
            self.assertEqual(status["daemon_status"], "healthy")
            self.assertIsNotNone(status["last_checked"])
            self.assertEqual(status["checks_performed"], 1)

    def test_start_stop_lifecycle(self):
        """Monitor should start and stop without errors."""
        from daemon_monitor import DaemonHealthMonitor
        with tempfile.TemporaryDirectory() as tmpdir:
            pid_file = Path(tmpdir) / "gateway.pid"
            pid_file.write_text(json.dumps({"pid": os.getpid()}))
            m = self._make_monitor(Path(tmpdir))
            m.poll_interval = 1
            m.start()
            time.sleep(0.5)
            self.assertTrue(m.is_running)
            m.stop()
            self.assertFalse(m.is_running)

    def test_resources_collected(self):
        """Resource check should return CPU and memory data."""
        from daemon_monitor import DaemonHealthMonitor
        with tempfile.TemporaryDirectory() as tmpdir:
            pid_file = Path(tmpdir) / "gateway.pid"
            pid_file.write_text(json.dumps({"pid": os.getpid()}))
            m = self._make_monitor(Path(tmpdir))
            resources = m._check_resources(os.getpid())
            self.assertIn("memory_rss_mb", resources)
            self.assertIn("num_threads", resources)
            self.assertGreater(resources["memory_rss_mb"], 0)

    def test_stale_heartbeat_detection(self):
        """Stale heartbeat should be detected in details."""
        from daemon_monitor import DaemonHealthMonitor
        with tempfile.TemporaryDirectory() as tmpdir:
            pid_file = Path(tmpdir) / "gateway.pid"
            pid_file.write_text(json.dumps({"pid": os.getpid()}))
            # Write a stale heartbeat
            hb_file = Path(tmpdir) / "health_heartbeat.json"
            old_ts = "2020-01-01T00:00:00+00:00"
            hb_file.write_text(json.dumps({"timestamp": old_ts}))
            m = self._make_monitor(Path(tmpdir))
            entry = m._check_health()
            self.assertFalse(entry.details["heartbeat"]["fresh"])

    def test_fresh_heartbeat(self):
        """Fresh heartbeat should be detected."""
        from daemon_monitor import DaemonHealthMonitor
        with tempfile.TemporaryDirectory() as tmpdir:
            pid_file = Path(tmpdir) / "gateway.pid"
            pid_file.write_text(json.dumps({"pid": os.getpid()}))
            hb_file = Path(tmpdir) / "health_heartbeat.json"
            now_ts = datetime.now(timezone.utc).isoformat()
            hb_file.write_text(json.dumps({"timestamp": now_ts}))
            m = self._make_monitor(Path(tmpdir))
            entry = m._check_health()
            self.assertTrue(entry.details["heartbeat"]["fresh"])


class TestGatewayMonitor(unittest.TestCase):
    """Tests for the gateway runtime status monitor."""

    def _make_monitor(self, tmpdir: Path, **kwargs):
        from gateway_monitor import GatewayMonitor
        monitor = GatewayMonitor(**kwargs)
        monitor.hermes_home = tmpdir
        monitor.state_file = tmpdir / "gateway_state.json"
        monitor.pid_file = tmpdir / "gateway.pid"
        return monitor

    def test_init_defaults(self):
        from gateway_monitor import GatewayMonitor, DEFAULT_POLL_INTERVAL, DEFAULT_ROLLING_WINDOW
        m = GatewayMonitor()
        self.assertEqual(m.poll_interval, DEFAULT_POLL_INTERVAL)
        self.assertEqual(m.rolling_window, DEFAULT_ROLLING_WINDOW)
        self.assertIsNone(m.last_checked)

    def test_status_before_any_polls(self):
        from gateway_monitor import GatewayMonitor
        m = GatewayMonitor()
        status = m.get_status()
        self.assertEqual(status["status"], "unknown")
        self.assertIsNone(status["last_checked"])

    def test_no_state_file_returns_no_state(self):
        """When gateway_state.json doesn't exist, status should reflect that."""
        from gateway_monitor import GatewayMonitor
        with tempfile.TemporaryDirectory() as tmpdir:
            m = self._make_monitor(Path(tmpdir))
            entry = m._poll_once()
            self.assertEqual(entry.metrics["gateway_state"], "no_state_file")

    def test_valid_state_file(self):
        """Monitor should parse valid gateway_state.json correctly."""
        from gateway_monitor import GatewayMonitor
        with tempfile.TemporaryDirectory() as tmpdir:
            state_file = Path(tmpdir) / "gateway_state.json"
            state_file.write_text(json.dumps({
                "pid": 12345,
                "gateway_state": "running",
                "active_agents": 2,
                "platforms": {
                    "telegram": {"state": "connected", "updated_at": "2026-01-01T00:00:00+00:00"},
                    "discord": {"state": "disconnected"},
                },
                "updated_at": "2026-01-01T00:00:00+00:00",
            }))
            pid_file = Path(tmpdir) / "gateway.pid"
            pid_file.write_text(json.dumps({"pid": 12345}))
            m = self._make_monitor(Path(tmpdir))
            entry = m._poll_once()
            self.assertEqual(entry.metrics["gateway_state"], "running")
            self.assertEqual(entry.metrics["active_connections"], 1)
            self.assertIn("telegram", entry.metrics["platforms"])

    def test_zero_connections_warning(self):
        """Should warn when gateway is running but no active connections."""
        from gateway_monitor import GatewayMonitor
        with tempfile.TemporaryDirectory() as tmpdir:
            state_file = Path(tmpdir) / "gateway_state.json"
            state_file.write_text(json.dumps({
                "gateway_state": "running",
                "platforms": {"telegram": {"state": "disconnected"}},
                "updated_at": "2026-01-01T00:00:00+00:00",
            }))
            pid_file = Path(tmpdir) / "gateway.pid"
            pid_file.write_text(json.dumps({"pid": 12345}))
            m = self._make_monitor(Path(tmpdir))
            entry = m._poll_once()
            self.assertTrue(any("zero" in w.lower() for w in entry.warnings))

    def test_restart_detection(self):
        """Monitor should detect when the gateway PID changes."""
        from gateway_monitor import GatewayMonitor
        with tempfile.TemporaryDirectory() as tmpdir:
            pid_file = Path(tmpdir) / "gateway.pid"
            pid_file.write_text(json.dumps({"pid": 111}))
            state_file = Path(tmpdir) / "gateway_state.json"
            state_file.write_text(json.dumps({
                "gateway_state": "running",
                "platforms": {},
                "updated_at": "2026-01-01T00:00:00+00:00",
            }))
            m = self._make_monitor(Path(tmpdir))

            # First poll with PID 111
            m._poll_once()
            self.assertEqual(m._last_pid, 111)
            self.assertEqual(m._restart_count, 0)

            # Simulate restart: change PID
            pid_file.write_text(json.dumps({"pid": 222}))
            entry = m._poll_once()
            self.assertEqual(m._last_pid, 222)
            self.assertEqual(m._restart_count, 1)
            self.assertTrue(entry.metrics.get("restart_detected"))

    def test_rolling_stats(self):
        """Rolling window stats should aggregate correctly."""
        from gateway_monitor import GatewayMonitor, GatewayMetricEntry
        with tempfile.TemporaryDirectory() as tmpdir:
            m = self._make_monitor(Path(tmpdir))
            from gateway_monitor import GatewayMetricEntry
            for i in range(10):
                e = GatewayMetricEntry(
                    metrics={
                        "error_rate_pct": float(i),
                        "throughput_req_s": float(i * 2),
                        "active_connections": i % 3,
                    },
                    warnings=[] if i < 5 else ["warn"],
                    timestamp=datetime.now(timezone.utc).isoformat(),
                )
                m._entries.append(e)

            stats = m._get_rolling_stats()
            self.assertEqual(stats["total_polls"], 10)
            self.assertEqual(stats["error_rate"]["min"], 0.0)
            self.assertEqual(stats["error_rate"]["max"], 9.0)
            self.assertEqual(stats["total_warnings"], 5)

    def test_get_summary_line(self):
        """Summary line should include key metrics."""
        from gateway_monitor import GatewayMonitor, GatewayMetricEntry
        with tempfile.TemporaryDirectory() as tmpdir:
            m = self._make_monitor(Path(tmpdir))
            e = GatewayMetricEntry(
                metrics={
                    "error_rate_pct": 2.5,
                    "throughput_req_s": 10.0,
                    "active_connections": 3,
                },
                warnings=[],
                timestamp=datetime.now(timezone.utc).isoformat(),
            )
            m._entries.append(e)
            line = m.get_summary_line()
            self.assertIn("gateway=", line)
            self.assertIn("err_rate=2.5%", line)
            self.assertIn("conns=3", line)

    def test_start_stop_lifecycle(self):
        from gateway_monitor import GatewayMonitor
        with tempfile.TemporaryDirectory() as tmpdir:
            pid_file = Path(tmpdir) / "gateway.pid"
            pid_file.write_text(json.dumps({"pid": 12345}))
            state_file = Path(tmpdir) / "gateway_state.json"
            state_file.write_text(json.dumps({
                "gateway_state": "running",
                "platforms": {},
                "updated_at": "2026-01-01T00:00:00+00:00",
            }))
            m = self._make_monitor(Path(tmpdir))
            m.poll_interval = 1
            m.start()
            time.sleep(0.5)
            self.assertTrue(m.is_running)
            m.stop()
            self.assertFalse(m.is_running)


class TestUnifiedHealthDashboard(unittest.TestCase):
    """Tests for the combined system status dashboard."""

    def _make_dashboard(self, **kwargs):
        from daemon_monitor import DaemonHealthMonitor
        from gateway_monitor import GatewayMonitor
        from unified_health import UnifiedHealthDashboard
        with tempfile.TemporaryDirectory() as tmpdir:
            dm = DaemonHealthMonitor(**kwargs)
            gm = GatewayMonitor(**kwargs)
            return UnifiedHealthDashboard(dm, gm)

    def _make_dashboard_with(self, dm, gm):
        from unified_health import UnifiedHealthDashboard
        return UnifiedHealthDashboard(dm, gm)

    def test_both_healthy_returns_green(self):
        from daemon_monitor import DaemonHealthMonitor, DaemonHealthEntry
        from gateway_monitor import GatewayMonitor, GatewayMetricEntry
        from unified_health import UnifiedHealthDashboard, STATUS_GREEN

        with tempfile.TemporaryDirectory() as tmpdir:
            dm = DaemonHealthMonitor()
            gm = GatewayMonitor()
            dm._entries.append(DaemonHealthEntry("healthy", {}, datetime.now(timezone.utc).isoformat()))
            gm._entries.append(GatewayMetricEntry(
                {"gateway_state": "running", "error_rate_pct": 0, "throughput_req_s": 1, "active_connections": 1},
                [], datetime.now(timezone.utc).isoformat(),
            ))
            dashboard = self._make_dashboard_with(dm, gm)
            status = dashboard.get_status()
            self.assertEqual(status["system_status"], STATUS_GREEN)
            self.assertIn("healthy", status["system_status_reason"].lower())

    def test_daemon_down_returns_red(self):
        from daemon_monitor import DaemonHealthMonitor, DaemonHealthEntry
        from gateway_monitor import GatewayMonitor, GatewayMetricEntry
        from unified_health import UnifiedHealthDashboard, STATUS_RED

        with tempfile.TemporaryDirectory() as tmpdir:
            dm = DaemonHealthMonitor()
            gm = GatewayMonitor()
            dm._entries.append(DaemonHealthEntry("down", {"reason": "pid_missing"}, datetime.now(timezone.utc).isoformat()))
            gm._entries.append(GatewayMetricEntry(
                {"gateway_state": "running", "error_rate_pct": 0, "throughput_req_s": 1, "active_connections": 1},
                [], datetime.now(timezone.utc).isoformat(),
            ))
            dashboard = self._make_dashboard_with(dm, gm)
            status = dashboard.get_status()
            self.assertEqual(status["system_status"], STATUS_RED)

    def test_gateway_down_returns_red(self):
        from daemon_monitor import DaemonHealthMonitor, DaemonHealthEntry
        from gateway_monitor import GatewayMonitor, GatewayMetricEntry
        from unified_health import UnifiedHealthDashboard, STATUS_RED

        dm = DaemonHealthMonitor()
        gm = GatewayMonitor()
        dm._entries.append(DaemonHealthEntry("healthy", {}, datetime.now(timezone.utc).isoformat()))
        gm._entries.append(GatewayMetricEntry(
            {"gateway_state": "down", "error_rate_pct": 0, "throughput_req_s": 0, "active_connections": 0},
            ["error"], datetime.now(timezone.utc).isoformat(),
        ))
        dashboard = self._make_dashboard_with(dm, gm)
        status = dashboard.get_status()
        self.assertEqual(status["system_status"], STATUS_RED)

    def test_both_down_returns_red(self):
        from daemon_monitor import DaemonHealthMonitor, DaemonHealthEntry
        from gateway_monitor import GatewayMonitor, GatewayMetricEntry
        from unified_health import UnifiedHealthDashboard, STATUS_RED

        dm = DaemonHealthMonitor()
        gm = GatewayMonitor()
        dm._entries.append(DaemonHealthEntry("down", {}, datetime.now(timezone.utc).isoformat()))
        gm._entries.append(GatewayMetricEntry(
            {"gateway_state": "down", "error_rate_pct": 0, "throughput_req_s": 0, "active_connections": 0},
            [], datetime.now(timezone.utc).isoformat(),
        ))
        dashboard = self._make_dashboard_with(dm, gm)
        status = dashboard.get_status()
        self.assertEqual(status["system_status"], STATUS_RED)

    def test_degraded_returns_yellow(self):
        from daemon_monitor import DaemonHealthMonitor, DaemonHealthEntry
        from gateway_monitor import GatewayMonitor, GatewayMetricEntry
        from unified_health import UnifiedHealthDashboard, STATUS_YELLOW

        dm = DaemonHealthMonitor()
        gm = GatewayMonitor()
        dm._entries.append(DaemonHealthEntry("healthy", {}, datetime.now(timezone.utc).isoformat()))
        gm._entries.append(GatewayMetricEntry(
            {"gateway_state": "running", "error_rate_pct": 10, "throughput_req_s": 1, "active_connections": 1},
            ["error_rate_high: 10.0% > 5.0%"], datetime.now(timezone.utc).isoformat(),
        ))
        dashboard = self._make_dashboard_with(dm, gm)
        status = dashboard.get_status()
        self.assertEqual(status["system_status"], STATUS_YELLOW)

    def test_daemon_degraded_returns_yellow(self):
        from daemon_monitor import DaemonHealthMonitor, DaemonHealthEntry
        from gateway_monitor import GatewayMonitor, GatewayMetricEntry
        from unified_health import UnifiedHealthDashboard, STATUS_YELLOW

        dm = DaemonHealthMonitor()
        gm = GatewayMonitor()
        dm._entries.append(DaemonHealthEntry(
            "degraded", {"issues": ["high_cpu"]}, datetime.now(timezone.utc).isoformat()
        ))
        gm._entries.append(GatewayMetricEntry(
            {"gateway_state": "running", "error_rate_pct": 0, "throughput_req_s": 1, "active_connections": 1},
            [], datetime.now(timezone.utc).isoformat(),
        ))
        dashboard = self._make_dashboard_with(dm, gm)
        status = dashboard.get_status()
        self.assertEqual(status["system_status"], STATUS_YELLOW)

    def test_unknown_status_returns_yellow(self):
        from daemon_monitor import DaemonHealthMonitor
        from gateway_monitor import GatewayMonitor
        from unified_health import UnifiedHealthDashboard, STATUS_YELLOW

        dm = DaemonHealthMonitor()  # no entries => unknown
        gm = GatewayMonitor()       # no entries => unknown
        dashboard = self._make_dashboard_with(dm, gm)
        status = dashboard.get_status()
        self.assertEqual(status["system_status"], STATUS_YELLOW)

    def test_get_status_structure(self):
        """The full status payload should have all required keys."""
        from daemon_monitor import DaemonHealthMonitor
        from gateway_monitor import GatewayMonitor
        from unified_health import UnifiedHealthDashboard

        dm = DaemonHealthMonitor()
        gm = GatewayMonitor()
        dashboard = self._make_dashboard_with(dm, gm)
        status = dashboard.get_status()
        required_keys = ["daemon", "gateway", "system_status", "system_status_reason", "dashboard_uptime", "timestamp"]
        for key in required_keys:
            self.assertIn(key, status, f"Missing key: {key}")

    def test_compact_status_structure(self):
        """Compact status should have the minimal required keys."""
        from daemon_monitor import DaemonHealthMonitor
        from gateway_monitor import GatewayMonitor
        from unified_health import UnifiedHealthDashboard

        dm = DaemonHealthMonitor()
        gm = GatewayMonitor()
        dashboard = self._make_dashboard_with(dm, gm)
        compact = dashboard.get_compact_status()
        required_keys = ["system_status", "daemon_status", "gateway_status", "timestamp"]
        for key in required_keys:
            self.assertIn(key, compact, f"Missing key: {key}")

    def test_start_stop_both_monitors(self):
        """Dashboard start() should start both monitors; stop() should stop both."""
        from daemon_monitor import DaemonHealthMonitor, DaemonHealthEntry
        from gateway_monitor import GatewayMonitor
        from unified_health import UnifiedHealthDashboard

        with tempfile.TemporaryDirectory() as tmpdir:
            pid_file = Path(tmpdir) / "gateway.pid"
            pid_file.write_text(json.dumps({"pid": os.getpid()}))
            state_file = Path(tmpdir) / "gateway_state.json"
            state_file.write_text(json.dumps({
                "gateway_state": "running",
                "platforms": {},
                "updated_at": "2026-01-01T00:00:00+00:00",
            }))

            dm = DaemonHealthMonitor(poll_interval=1)
            dm.hermes_home = Path(tmpdir)
            gm = GatewayMonitor(poll_interval=1)
            gm.hermes_home = Path(tmpdir)
            gm.state_file = state_file
            gm.pid_file = pid_file

            dashboard = self._make_dashboard_with(dm, gm)
            dashboard.start()
            time.sleep(0.5)
            self.assertTrue(dm.is_running)
            self.assertTrue(gm.is_running)
            dashboard.stop()
            self.assertFalse(dm.is_running)
            self.assertFalse(gm.is_running)


class TestServerEndpoints(unittest.TestCase):
    """Tests for the FastAPI server endpoints."""

    @classmethod
    def setUpClass(cls):
        """Set up a temp Hermes home for the test server."""
        cls.tmpdir = tempfile.mkdtemp()
        pid_file = Path(cls.tmpdir) / "gateway.pid"
        pid_file.write_text(json.dumps({"pid": os.getpid()}))
        state_file = Path(cls.tmpdir) / "gateway_state.json"
        state_file.write_text(json.dumps({
            "gateway_state": "running",
            "active_agents": 1,
            "platforms": {"telegram": {"state": "connected", "updated_at": "2026-01-01T00:00:00+00:00"}},
            "updated_at": "2026-01-01T00:00:00+00:00",
        }))
        os.environ["HERMES_HOME"] = cls.tmpdir

    def test_health_endpoint_reachable(self):
        """The original /api/health endpoint should still work."""
        try:
            from server import app
            from fastapi.testclient import TestClient
            client = TestClient(app)
            resp = client.get("/api/health")
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["status"], "healthy")
            self.assertIn("agents", data)
        except ImportError:
            self.skipTest("TestClient or server not available")

    def test_unified_health_endpoint(self):
        """The /api/health/unified endpoint should return combined status."""
        try:
            from server import app
            from fastapi.testclient import TestClient
            client = TestClient(app)
            resp = client.get("/api/health/unified")
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertIn("system_status", data)
            self.assertIn("daemon", data)
            self.assertIn("gateway", data)
            self.assertIn("system_status_reason", data)
            self.assertIn(data["system_status"], ("green", "yellow", "red"))
        except ImportError:
            self.skipTest("TestClient or server not available")

    def test_compact_health_endpoint(self):
        """The /api/health/unified/compact endpoint should return minimal data."""
        try:
            from server import app
            from fastapi.testclient import TestClient
            client = TestClient(app)
            resp = client.get("/api/health/unified/compact")
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertIn("system_status", data)
            self.assertIn("daemon_status", data)
            self.assertIn("gateway_status", data)
        except ImportError:
            self.skipTest("TestClient or server not available")

    def test_unified_response_structure(self):
        """Unified health response should include daemon_status and gateway_status in sub-objects."""
        try:
            from server import app
            from fastapi.testclient import TestClient
            client = TestClient(app)
            resp = client.get("/api/health/unified")
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertIn("daemon_status", data["daemon"])
            self.assertIn("gateway_status", data["gateway"])
            self.assertIn("rolling_window", data["daemon"])
            self.assertIn("rolling_window", data["gateway"])
        except ImportError:
            self.skipTest("TestClient or server not available")


if __name__ == "__main__":
    unittest.main(verbosity=2)
