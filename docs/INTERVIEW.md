# Explaining TraceGuard in an interview

## A concise introduction

“TraceGuard is a local security analytics prototype. I built a FastAPI service that validates activity events, applies an Isolation Forest and explicit context rules, and persists event and investigation history in SQLite. The dashboard lets an analyst inspect the reason for a signal and record a decision. The current evaluation uses synthetic events, so I do not present it as a validated intrusion detection system.”

Use that as an outline after you have run and understood the implementation. Be clear that AI assistance was used to build the initial version if asked about your process.

## A demonstration that shows engineering depth

1. Import the template file twice and show that the second import adds no events.
2. Open the imported alert and explain the anomaly percentile versus the contextual rule points.
3. Save a note and mark the alert Investigating. Refresh the page to show persistence.
4. Resolve the alert and show the active count changing.
5. Import an invalid two-row file to demonstrate that neither row is partially written.
6. Explain why the synthetic evaluation cannot prove generalization to real security logs.

## Questions worth preparing for

**Why Isolation Forest?** It provides an unsupervised baseline for unusual numerical feature combinations without requiring labelled attack data for training. Shorter isolation paths correspond to unusual samples. Here, independent clean samples calibrate an empirical anomaly percentile.

**Why add context rules?** A generic anomaly score lacks operational meaning. Explicit thresholds make policy checks inspectable. This hybrid also has limitations: hand-picked points are not a learned probability, and the source must supply reliable contextual fields.

**How do you prevent train/test leakage?** Training, clean calibration, and synthetic evaluation use separate samples and fixed distinct seeds. Account countries are learned only from the training baseline. Samples still share the same generator, which limits the strength of the evaluation.

**What does an explanation actually mean?** The signal list explains rule triggers. It does not explain causal behavior or assign contributions to individual Isolation Forest features. I avoid labelling these as SHAP or feature-importance explanations.

**What makes imports idempotent?** The validated event is serialized with stable keys and normalized timestamp/IP fields, then hashed. That identity is a primary key. Duplicate inserts are ignored and do not overwrite an existing triage status or audit history.

**What happens if the second CSV row is invalid?** All rows are validated before database writes. A valid batch is inserted in one transaction. The API reports the row and field on validation failure.

**What about concurrent analyst decisions?** The database acquires a write lock before reading the old triage status, updating it, and appending the audit record. This keeps the old/new status transition consistent. Multi-analyst identity and optimistic conflict handling would be future work.

**Why SQLite?** It gives durable transactions with minimal local setup. For a multi-user deployment, I would evaluate PostgreSQL, access controls, migrations, indexed filtering/pagination, and a durable background ingestion pipeline. The current store reads all events for filtering and aggregation; this is deliberately a small local prototype rather than an approach for millions of events.

**What protections exist for imported text?** Pydantic validates input, parameterized SQL prevents query interpolation, the frontend escapes dynamic content before rendering, and CSV exports neutralize spreadsheet formulas. Uploads have byte and row limits. These are individual controls, not a claim of comprehensive security certification.

**What would you do next?** Replace the fictional baseline with documented organization-specific clean data, define account-local time windows, aggregate real source telemetry, evaluate false positives, add analyst authentication and authorization, and monitor drift. Start with validation before adding more algorithms.

## Resume bullet you can use after understanding the project

- Built a Python/FastAPI security analytics prototype combining Isolation Forest anomaly ranking with contextual rules, atomic CSV ingestion, deduplication, and SQLite-backed investigation history; implemented a responsive analyst dashboard and automated API/browser checks.

Do not claim a production deployment, real attack detection rate, user count, or time savings that have not been measured.
