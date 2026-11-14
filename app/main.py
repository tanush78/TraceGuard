import csv
import io
import os
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from .data import demo_events
from .detector import Detector
from .schemas import Event, Triage
from .store import Store

STATIC = Path(__file__).parent / "static"
COLUMNS = list(Event.model_fields)
MAX_BYTES = 2 * 1024 * 1024


def csv_response(rows, columns, filename):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        # Prevent spreadsheet formula interpretation in user-supplied text.
        writer.writerow({k: ("'" + str(v) if str(v).lstrip().startswith(("=", "+", "-", "@")) else v) for k, v in row.items() if k in columns})
    return Response(output.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def create_app(db_path=None, seed_demo=None):
    api = FastAPI(title="TraceGuard API", version="1.0.0", description="Single-analyst behavioral security demo. All included activity is synthetic.")
    store = Store(db_path or os.getenv("TRACEGUARD_DB", "data/traceguard.db"))
    detector = Detector()
    if seed_demo is None:
        seed_demo = os.getenv("TRACEGUARD_SEED_DEMO", "true").lower() == "true"
    if seed_demo and not store.events():
        events = demo_events()
        store.add(events, detector.score_many(events), "synthetic-demo")
    api.state.store = store
    api.state.detector = detector

    @api.middleware("http")
    async def headers(request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    @api.get("/api/health")
    def health():
        return {"status": "ok", "version": "1.0.0"}

    @api.get("/api/overview")
    def overview():
        events = store.events()
        alerts = [e for e in events if e["risk"] >= 65]
        active = [a for a in alerts if a["status"] != "resolved"]
        end = max((datetime.fromisoformat(e["timestamp"]).date() for e in events), default=datetime.now().date())
        dates = [(end - timedelta(days=d)).isoformat() for d in reversed(range(7))]
        activity = [{"date": day, "low": 0, "medium": 0, "high": 0, "critical": 0} for day in dates]
        by_date = {x["date"]: x for x in activity}
        for e in events:
            day = e["timestamp"][:10]
            if day in by_date:
                by_date[day][e["severity"]] += 1
        severity = dict(Counter(e["severity"] for e in events))
        return {"events": len(events), "accounts": len({e["user"] for e in events}), "active_alerts": len(active),
            "critical_alerts": sum(a["severity"] == "critical" for a in active), "resolved_alerts": sum(a["status"] == "resolved" for a in alerts),
            "severity": severity, "activity": activity, "latest_event": events[0]["timestamp"] if events else None,
            "demo_events": sum(e["source"] == "synthetic-demo" for e in events),
            "top_alerts": sorted(active, key=lambda x: (x["risk"], x["timestamp"]), reverse=True)[:5]}

    def filtered(alerts_only, search, severity, status):
        items = store.events()
        if alerts_only:
            items = [x for x in items if x["risk"] >= 65]
        if search:
            needle = search.casefold()
            items = [x for x in items if needle in " ".join(str(x[k]) for k in ["user", "source_ip", "country", "device"]).casefold()]
        if severity:
            items = [x for x in items if x["severity"] == severity]
        if status:
            items = [x for x in items if x["status"] == status]
        return items

    @api.get("/api/events")
    def events(search: str = Query("", max_length=100), severity: str = "", status: str = "", alerts_only: bool = False,
               offset: int = Query(0, ge=0), limit: int = Query(25, ge=1, le=100)):
        items = filtered(alerts_only, search, severity, status)
        return {"items": items[offset:offset+limit], "total": len(items), "offset": offset, "limit": limit}

    @api.get("/api/events/{identity}")
    def event(identity: str):
        result = store.get(identity)
        if result is None:
            raise HTTPException(404, "Event not found")
        return result

    @api.patch("/api/alerts/{identity}")
    def triage(identity: str, change: Triage):
        if not store.triage(identity, change.status, change.note):
            raise HTTPException(404, "Alert not found")
        return store.get(identity)

    @api.get("/api/model")
    def model():
        return detector.metadata

    @api.get("/api/export")
    def export(search: str = "", severity: str = "", status: str = "", alerts_only: bool = True):
        return csv_response(filtered(alerts_only, search, severity, status), COLUMNS + ["id", "risk", "severity", "status", "source"], "traceguard-report.csv")

    @api.get("/api/template")
    def template():
        sample = Event(timestamp="2026-11-14T02:30:00Z", user="alex.chen", source_ip="203.0.113.10", country="DE",
            device="Unrecognized / Chrome", outcome="success", failure_count=24, data_out_mb=980, new_device=True)
        return csv_response([sample.model_dump(mode="json")], COLUMNS, "traceguard-template.csv")

    @api.post("/api/import")
    async def import_events(file: UploadFile = File(...)):
        raw = await file.read(MAX_BYTES + 1)
        await file.close()
        if len(raw) > MAX_BYTES:
            raise HTTPException(413, "CSV exceeds the 2 MB limit")
        try:
            reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""), strict=True)
            if reader.fieldnames is None or len(reader.fieldnames) != len(COLUMNS) or set(reader.fieldnames) != set(COLUMNS):
                raise ValueError("CSV headers must match the downloadable template exactly")
            incoming = []
            for line, row in enumerate(reader, start=2):
                if len(incoming) >= 5000:
                    raise ValueError("CSV exceeds the 5,000-row limit")
                try:
                    incoming.append(Event.model_validate(row))
                except ValidationError as error:
                    detail = error.errors()[0]
                    raise ValueError(f"Row {line}, {'.'.join(map(str, detail['loc']))}: {detail['msg']}") from error
            if not incoming:
                raise ValueError("CSV contains no event rows")
        except (UnicodeDecodeError, csv.Error, ValueError) as error:
            raise HTTPException(422, str(error)) from error
        # Validation completes before any writes: an invalid batch is never partially imported.
        added = store.add(incoming, detector.score_many(incoming), "csv-import")
        return {"received": len(incoming), "inserted": added, "duplicates": len(incoming)-added}

    @api.get("/", include_in_schema=False)
    def index():
        return FileResponse(STATIC / "index.html")

    api.mount("/static", StaticFiles(directory=STATIC), name="static")
    return api
