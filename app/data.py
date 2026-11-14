"""Deterministic, fictional activity. No real logs or credentials are included."""
from datetime import datetime, timedelta, timezone
import random

from .schemas import Event

USERS = ["alex.chen", "maya.patel", "jordan.lee", "sam.rivera", "priya.shah", "noah.wilson", "ava.morgan", "liam.brooks"]
COUNTRIES = ["US", "IN", "GB", "US", "IN", "CA", "GB", "US"]


def normal_events(count=800, seed=42, anchor=None):
    rng = random.Random(seed)
    anchor = anchor or datetime(2026, 1, 15, tzinfo=timezone.utc)
    result = []
    for i in range(count):
        u = rng.randrange(len(USERS))
        stamp = (anchor - timedelta(days=rng.randrange(7))).replace(
            hour=rng.randrange(8, 20), minute=rng.randrange(60), second=i % 60, microsecond=0
        )
        result.append(Event(timestamp=stamp, user=USERS[u], source_ip=f"192.0.2.{u+10}",
            country=COUNTRIES[u], device=["MacBook / Chrome", "Windows / Edge", "Linux / Firefox"][u % 3],
            outcome="success" if rng.random() > 0.08 else "failed", failure_count=rng.randrange(3),
            data_out_mb=round(rng.uniform(0.1, 35), 2), new_device=False))
    return result


def anomalous_events(count=20, seed=24, anchor=None):
    rng = random.Random(seed)
    anchor = anchor or datetime(2026, 1, 15, tzinfo=timezone.utc)
    result = []
    for i in range(count):
        u = i % len(USERS)
        scenario = i % 4
        hour = 14 if scenario == 1 else 16 if scenario == 3 else 2 + i % 3
        stamp = (anchor - timedelta(days=i % 7)).replace(hour=hour, minute=rng.randrange(60), second=i % 60, microsecond=0)
        result.append(Event(timestamp=stamp, user=USERS[u], source_ip=f"203.0.113.{i+10}",
            country="DE" if scenario in (0, 2) else COUNTRIES[u], device="Unrecognized / Chromium",
            outcome="failed" if scenario == 1 else "success", failure_count=rng.randrange(20, 65) if scenario in (0, 1) else 0,
            data_out_mb=round(rng.uniform(800, 4000), 2) if scenario in (0, 2, 3) else 1.5,
            new_device=scenario != 1))
    return result


def demo_events():
    # Anchor at yesterday so the full generated activity is in the past.
    anchor = datetime.now(timezone.utc) - timedelta(days=1)
    return normal_events(420, seed=72, anchor=anchor) + anomalous_events(20, anchor=anchor)
