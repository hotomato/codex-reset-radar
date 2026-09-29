import unittest
from datetime import datetime, timezone

from scripts.update_snapshot import build_snapshot


class SnapshotTests(unittest.TestCase):
    def test_latest_completion_is_kept_and_records_are_deduplicated(self):
        completion = {"id": "c1", "kind": "reset_completed", "resetType": "global"}
        payloads = {
            "records": {"ok": True, "data": {"items": [completion]}, "meta": {
                "generatedAt": "2026-09-29T10:00:00Z",
                "lastSuccessfulCheckAt": "2026-09-29T10:00:00Z",
            }},
            "latest": {"ok": True, "data": completion, "meta": {}},
            "status": {"status": {"indicator": "none", "description": "All Systems Operational"}, "page": {}},
            "incidents": {"incidents": [
                {"id": "i1", "name": "Issues with Codex", "status": "investigating",
                 "created_at": "2026-09-29T09:00:00Z"},
                {"id": "i2", "name": "Unrelated API issue", "status": "resolved",
                 "created_at": "2026-09-29T09:00:00Z"},
            ]},
        }
        result = build_snapshot(payloads, datetime(2026, 9, 29, 12, tzinfo=timezone.utc))
        self.assertEqual([record["id"] for record in result["records"]], ["c1"])
        self.assertEqual([incident["id"] for incident in result["incidents"]], ["i1"])
        self.assertEqual(result["sources"]["recordsLastSuccessfulCheckAt"], "2026-09-29T10:00:00Z")


if __name__ == "__main__":
    unittest.main()
