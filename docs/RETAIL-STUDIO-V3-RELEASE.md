# Retail Studio v3 candidate
- Shared premium visual refresh for existing modules, 11 themes (22 palettes), responsive POS, catalog, login, navigation, forms and tables. No module intentionally removed.
- Standalone owner setup uses a chosen PIN (rejects common defaults), confirmation and persistence. Local PIN is still device-local protection, not OS encrypted vault or a server credential.
- CI verifies persistent PIN setup and records dependency audit. Browser screenshots are separate from native release packages.
- Existing shop records are test data per owner. Do not run destructive reset until devices are signed out, queues cleared/exported and the owner explicitly authorizes the target reset. Preserve auth, configuration, keys and storage. See recovery runbook.
- Native hardware, all live transactional business workflows, dependency remediation and production publishing must be independently verified before go-live.
