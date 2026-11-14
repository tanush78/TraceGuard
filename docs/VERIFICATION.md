# Verification

Checked on 14 November 2026. No public deployment or paid service was activated.

## API and model

`python -m unittest discover -s tests -v` — **9 tests passed** on Python 3.12.

Coverage includes dashboard aggregation, deterministic anomaly ranking, search, atomic rejection of invalid batches, schema constraints, upload limits, duplicate suppression, persisted triage, restart behavior, and neutralization of spreadsheet formulas.

`python scripts/evaluate.py` — the controlled synthetic evaluation reports precision **0.6667**, recall **1.0000**, and F1 **0.8000** on 300 generated events. Twenty legitimate high-volume transfers are deliberately included as hard negatives. This result illustrates false-positive tradeoffs in the prototype; it is not a real-world intrusion detection benchmark.

## Browser

`npm run test:ui` — **passed** with Playwright 1.62.1 and the environment's Chromium browser.

Exercised dashboard rendering, opening an investigation, saving a note and status, filtering, search and empty states, CSV import/export, detection-model metadata, and 390-pixel mobile layout. Verified that note text containing HTML is rendered as text. No JavaScript page errors were observed. Screenshots in this directory were inspected after capture.

## Container

Built the Python 3.12 slim image and ran a smoke check with freshly resolved compatible dependencies. Confirmed a non-root runtime, healthy HTTP API, 440 seeded events, and a saved triage decision. The managed execution environment required its existing CA bundle to be passed to the dependency-install build step as an ephemeral BuildKit secret; TLS verification remained enabled, and the session trust bundle was not added to the project or image layers.

The container was stopped after verification. No hosted instance was created.

## Scope

These checks establish the tested local workflows. Authentication, multi-analyst authorization, performance under large datasets, real-log detection quality, and public deployment security remain outside the current prototype.
