"""Hybrid anomaly ranking. Context signals explain rules, not causal model attribution."""
from collections import defaultdict
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.metrics import precision_recall_fscore_support

from .data import normal_events, anomalous_events

FEATURES = ["log failure count", "log outbound MB", "new device", "outside 08–20 UTC", "unseen account country", "unknown account"]


class Detector:
    def __init__(self):
        training = normal_events(800, seed=42)
        self.countries = defaultdict(set)
        for event in training:
            self.countries[event.user].add(event.country)
        self.model = IsolationForest(n_estimators=120, contamination="auto", random_state=42, n_jobs=1)
        self.model.fit(self.features(training))
        calibration = normal_events(240, seed=84)
        self.calibration = np.sort(-self.model.score_samples(self.features(calibration)))
        self.metadata = self.evaluate()

    def features(self, events):
        return np.array([[np.log1p(e.failure_count), np.log1p(e.data_out_mb), int(e.new_device),
            int(not 8 <= e.timestamp.hour < 20), int(e.country not in self.countries.get(e.user, set())),
            int(e.user not in self.countries)] for e in events], dtype=float)

    def score_many(self, events):
        if not events:
            return []
        raw = -self.model.score_samples(self.features(events))
        results = []
        for e, anomaly in zip(events, raw):
            percentile = float(np.searchsorted(self.calibration, anomaly, side="right") / len(self.calibration))
            signals = []
            weights = []
            def add(condition, label, detail, weight):
                if condition:
                    signals.append({"label": label, "detail": detail})
                    weights.append(weight)
            add(e.failure_count >= 10, "Repeated failures", f"{e.failure_count} failed attempts in the source's observation window.", 35)
            add(e.new_device, "New device", "The source marked this device as previously unseen.", 20)
            add(not 8 <= e.timestamp.hour < 20, "Unusual hour", "Activity outside the demo baseline window of 08:00–20:00 UTC.", 10)
            add(e.user in self.countries and e.country not in self.countries[e.user], "Unfamiliar location", f"{e.country} is absent from this account's training baseline.", 20)
            add(e.data_out_mb >= 500, "Large data transfer", f"{e.data_out_mb:,.1f} MB outbound; contextual threshold is 500 MB.", 35)
            add(e.user not in self.countries, "Unknown account", "No training baseline exists for this account; interpret the score cautiously.", 15)
            risk = round(min(100, 0.35 * percentile * 100 + min(65, sum(weights))))
            severity = "critical" if risk >= 95 else "high" if risk >= 85 else "medium" if risk >= 65 else "low"
            results.append({"risk": risk, "severity": severity, "anomaly_percentile": round(percentile * 100, 1), "signals": signals})
        return results

    def evaluate(self):
        normal = normal_events(240, seed=123)
        # Legitimate large backups are hard negatives: high volume alone is not an attack.
        backups = [e.model_copy(update={"data_out_mb": 900.0 + i * 10, "failure_count": 0, "outcome": "success"})
                   for i, e in enumerate(normal_events(20, seed=124))]
        normal += backups
        attacks = anomalous_events(40, seed=321)
        scores = self.score_many(normal + attacks)
        actual = [0] * len(normal) + [1] * len(attacks)
        predicted = [int(s["risk"] >= 65) for s in scores]
        precision, recall, f1, _ = precision_recall_fscore_support(actual, predicted, average="binary", zero_division=0)
        return {"name": "Isolation Forest + context rules", "version": "1.0", "seed": 42,
            "training_events": 800, "calibration_events": 240, "evaluation_events": len(actual),
            "evaluation_anomalies": 40, "precision": round(float(precision), 4), "recall": round(float(recall), 4),
            "evaluation_hard_negatives": len(backups),
            "f1": round(float(f1), 4), "features": FEATURES, "threshold": 65,
            "method": "35% calibrated anomaly percentile + contextual rule points (capped at 65). Score is a ranking, not a probability.",
            "limitations": "Controlled synthetic benchmark with a fixed UTC work window and 20 legitimate large-transfer hard negatives. Not validated on real enterprise traffic. Context signals are rule explanations, not feature attribution. Unknown accounts need an organization-specific baseline."}
