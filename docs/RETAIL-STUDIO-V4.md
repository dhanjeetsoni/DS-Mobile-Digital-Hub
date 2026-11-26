# Retail Studio V4 candidate
- Eagerly bundle 39 formerly lazy screens/modal; remove blocking route Suspense fallback. This trades some cold-start payload for immediate first-tap navigation. Scanner permission is still handled when opened.
- Stable vendor scanner chunk, theme-aware visual polish, compact mobile navigation, more consistent pricing and report typography.
- Browser regression observes transient route loader text across the existing registry; true data loading and errors are not hidden.
- Dependency remediation job on the isolated hardening branch updates lockfile only after moderate+ audit, typecheck, Vitest, static and production build pass. Native jobs consume exact validated source SHA.
- No test data reset or production update publishing from this commit. Physical device testing and cloud business transaction checks remain separate.
