import hashlib
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


class Store:
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS events (
                    id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, user TEXT NOT NULL,
                    payload TEXT NOT NULL, analysis TEXT NOT NULL, source TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'open'
                );
                CREATE INDEX IF NOT EXISTS events_timestamp ON events(timestamp);
                CREATE TABLE IF NOT EXISTS audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL REFERENCES events(id),
                    timestamp TEXT NOT NULL, old_status TEXT NOT NULL, new_status TEXT NOT NULL, note TEXT NOT NULL
                );
            """)

    @contextmanager
    def connect(self):
        with sqlite3.connect(self.path, timeout=15) as db:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys=ON")
            yield db

    def add(self, events, scores, source):
        inserted = 0
        with self.connect() as db:
            for event, score in zip(events, scores):
                payload = event.model_dump(mode="json")
                serialized = json.dumps(payload, sort_keys=True)
                identity = hashlib.sha256(serialized.encode()).hexdigest()[:20]
                cursor = db.execute("INSERT OR IGNORE INTO events(id,timestamp,user,payload,analysis,source) VALUES(?,?,?,?,?,?)",
                    (identity, payload["timestamp"], event.user, serialized, json.dumps(score), source))
                inserted += cursor.rowcount
        return inserted

    @staticmethod
    def unpack(row):
        return {**json.loads(row["payload"]), **json.loads(row["analysis"]), "id": row["id"], "status": row["status"], "source": row["source"]}

    def events(self):
        with self.connect() as db:
            return [self.unpack(r) for r in db.execute("SELECT * FROM events ORDER BY timestamp DESC,id DESC")]

    def get(self, identity):
        with self.connect() as db:
            row = db.execute("SELECT * FROM events WHERE id=?", (identity,)).fetchone()
            if row is None:
                return None
            result = self.unpack(row)
            result["audit"] = [dict(r) for r in db.execute("SELECT timestamp,old_status,new_status,note FROM audit WHERE event_id=? ORDER BY id", (identity,))]
            return result

    def triage(self, identity, status, note):
        with self.connect() as db:
            # Acquire the write lock before reading to serialize concurrent decisions.
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT status,analysis FROM events WHERE id=?", (identity,)).fetchone()
            if row is None or json.loads(row["analysis"])["risk"] < 65:
                return False
            db.execute("UPDATE events SET status=? WHERE id=?", (status, identity))
            db.execute("INSERT INTO audit(event_id,timestamp,old_status,new_status,note) VALUES(?,?,?,?,?)",
                (identity, datetime.now(timezone.utc).isoformat(), row["status"], status, note))
        return True
