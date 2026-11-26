# Production reliability pass — 2026-11-25

Changes are staged on an isolated hardening branch. Native builds are gated on TypeScript, Vitest, static audit, production build and Chromium smoke tests. No existing feature is intentionally removed.

- Offline catalog: scope by store/profile, paginate, fail on cloud errors, atomic snapshot+metadata, no private-table fallback, honest download status.
- Offline PIN: persistent per-profile/revision retry limit; this is UI/device defense in depth, not a substitute for OS-backed encrypted storage or server authorization.
- Live queue policy inspection confirmed creator policies are RESTRICTIVE: do not remove the existing permissive store gate.
- Historical 53-unit FIFO discrepancy and abandoned sale require source receipts/physical count; never invent stock costs or replay blindly.
- Existing default local owner PIN, migration timestamp drift, independent backup restore, auth leaked-password settings, complete native hardware testing, live update publishing and all-module business regression tests remain release blockers. Do not declare production readiness solely from compilation.
