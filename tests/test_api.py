import csv
import io
import json
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient

from app.main import create_app
from app.store import Store


class TraceGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "events.db"
        self.app = create_app(self.path)
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def template(self):
        return self.client.get("/api/template").text

    def upload(self, text):
        return self.client.post("/api/import", files={"file": ("events.csv", text, "text/csv")})

    def test_demo_overview_and_search_match_stored_data(self):
        overview = self.client.get("/api/overview").json()
        self.assertEqual(overview["events"], 440)
        self.assertEqual(overview["accounts"], 8)
        self.assertEqual(sum(overview["severity"].values()), 440)
        self.assertEqual(sum(sum(day[k] for k in ["low", "medium", "high", "critical"]) for day in overview["activity"]), 440)
        data = self.client.get("/api/events", params={"search": "alex.chen", "limit": 100}).json()
        self.assertTrue(data["total"] > 0)
        self.assertTrue(all(e["user"] == "alex.chen" for e in data["items"]))

    def test_scoring_is_deterministic_and_separates_injected_activity(self):
        from app.data import normal_events, anomalous_events
        detector = self.app.state.detector
        clean = detector.score_many(normal_events(30, seed=910))
        anomalies = detector.score_many(anomalous_events(12, seed=911))
        self.assertLess(max(x["risk"] for x in clean), 65)
        self.assertGreaterEqual(min(x["risk"] for x in anomalies), 65)
        self.assertEqual(anomalies, detector.score_many(anomalous_events(12, seed=911)))
        self.assertTrue(all(x["signals"] for x in anomalies))
        self.assertEqual(self.client.get("/api/model").json()["evaluation_events"], 300)

    def test_import_is_idempotent_and_preserves_triage_history(self):
        first = self.upload(self.template())
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["inserted"], 1)
        events = self.client.get("/api/events", params={"alerts_only": True, "limit": 100}).json()["items"]
        event = next(x for x in events if x["source"] == "csv-import")
        response = self.client.patch(f'/api/alerts/{event["id"]}', json={"status": "investigating", "note": "Check with the account owner."})
        self.assertEqual(response.status_code, 200)
        duplicate = self.upload(self.template()).json()
        self.assertEqual(duplicate, {"received": 1, "inserted": 0, "duplicates": 1})
        restored = Store(self.path).get(event["id"])
        self.assertEqual(restored["status"], "investigating")
        self.assertEqual(restored["audit"][0]["note"], "Check with the account owner.")

    def test_import_is_atomic_on_invalid_second_row(self):
        text = self.template()
        row = list(csv.DictReader(io.StringIO(text)))[0]
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=list(row))
        writer.writeheader()
        writer.writerow(row)
        writer.writerow({**row, "data_out_mb": "NaN"})
        response = self.upload(output.getvalue())
        self.assertEqual(response.status_code, 422)
        self.assertIn("Row 3", response.json()["detail"])
        self.assertEqual(self.client.get("/api/overview").json()["events"], 440)

    def test_schema_rejects_naive_timestamps_bad_ips_and_extra_columns(self):
        original = list(csv.DictReader(io.StringIO(self.template())))[0]
        for updates in [{"timestamp": "2026-11-14T02:30:00"}, {"source_ip": "not-an-ip"}, {"failure_count": "-1"}, {"country": "ZZZ"}, {"outcome": "maybe"}, {"extra": "bad"}]:
            with self.subTest(updates=updates):
                row = {**original, **updates}
                out = io.StringIO()
                writer = csv.DictWriter(out, fieldnames=list(row))
                writer.writeheader()
                writer.writerow(row)
                self.assertEqual(self.upload(out.getvalue()).status_code, 422)

    def test_file_limits_encoding_and_empty_batches(self):
        self.assertEqual(self.upload(b"a" * (2 * 1024 * 1024 + 1)).status_code, 413)
        self.assertEqual(self.upload(b"\xff\xfe").status_code, 422)
        self.assertEqual(self.upload(self.template().splitlines()[0] + "\n").status_code, 422)
        self.assertEqual(self.client.get("/api/events", params={"limit": 1000}).status_code, 422)

    def test_triage_persists_and_updates_metrics(self):
        overview = self.client.get("/api/overview").json()
        event = overview["top_alerts"][0]
        response = self.client.patch(f'/api/alerts/{event["id"]}', json={"status": "resolved", "note": "Confirmed expected test activity."})
        self.assertEqual(response.json()["audit"][0]["old_status"], "open")
        updated = self.client.get("/api/overview").json()
        self.assertEqual(updated["active_alerts"], overview["active_alerts"] - 1)
        self.assertEqual(updated["resolved_alerts"], 1)
        self.assertEqual(Store(self.path).get(event["id"])["status"], "resolved")
        self.assertEqual(self.client.patch(f'/api/alerts/{event["id"]}', json={"status": "invalid"}).status_code, 422)
        self.assertEqual(self.client.patch('/api/alerts/missing', json={"status": "resolved"}).status_code, 404)

    def test_export_neutralizes_spreadsheet_formulas(self):
        original = list(csv.DictReader(io.StringIO(self.template())))[0]
        row = {**original, "device": "=HYPERLINK(\"bad\")"}
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=list(row))
        writer.writeheader()
        writer.writerow(row)
        self.assertEqual(self.upload(output.getvalue()).status_code, 200)
        report = self.client.get("/api/export", params={"search": "HYPERLINK"}).text
        exported = list(csv.DictReader(io.StringIO(report)))
        self.assertTrue(exported[0]["device"].startswith("'="))

    def test_restart_does_not_seed_over_existing_data(self):
        self.assertEqual(self.upload(self.template()).status_code, 200)
        another = create_app(self.path)
        with TestClient(another) as client:
            self.assertEqual(client.get("/api/overview").json()["events"], 441)
        empty_path = Path(self.temp.name) / "empty.db"
        with TestClient(create_app(empty_path, seed_demo=False)) as client:
            self.assertEqual(client.get("/api/overview").json()["events"], 0)


if __name__ == "__main__":
    unittest.main()
