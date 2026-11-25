# Recovery, maintenance and release runbook

## What is protected
- Private `ds_recovery.business_backups` stores checksummed per-shop business checkpoints for 30 tables.
- Owner's Offline & Cloud Sync Center can create a checkpoint (30-minute reuse) and view real aggregate integrity status.
- Restore and reset are deliberately operator-only, not accessible from the normal app or anonymous API. They create a pre-change checkpoint, preserve accounts, access policy, AI keys, Telegram connection, app versions and audit history, and preserve shop settings/categories on reset.
- The in-database checkpoint does NOT cover disaster loss of the entire project, Auth identities, secrets or storage object bytes. Keep an independent encrypted database export and separate Supabase Storage/R2 object backups. Do not commit customer or KYC data, database dumps, credentials, or backups to GitHub.
- See Supabase Database > Backups and https://supabase.com/docs/guides/platform/backups. A backup file should be restored into an isolated project before declaring disaster recovery complete.

## Operator procedure: no live reset until separately authorized
1. Stop sales, purchases, returns, and all owner/staff devices; export any account-scoped pending data and resolve conflicts. Sign out on all devices. Prevent old offline clients and external worker jobs from writing during maintenance.
2. Verify the independent backup and the current shop ID in the SQL editor. Use a maintenance window; recovery takes transaction locks on business tables. Check the backup integrity and row counts.
3. Create and verify a checkpoint using `SELECT ds_recovery.capture_business('<shop uuid>'::uuid,'pre-maintenance');` then `SELECT ds_recovery.verify_business_backup('<checkpoint uuid>'::uuid);`.
4. Only after explicit approval for the target shop, use `SELECT ds_recovery.replace_business('<shop uuid>'::uuid,NULL,'RESET:<shop uuid>');`. Restore is `SELECT ds_recovery.replace_business('<shop uuid>'::uuid,'<checkpoint uuid>'::uuid,'RESTORE:<shop uuid>:<checkpoint uuid>');`.
5. Check products and FIFO, sales and invoice counts, owner/staff projections, financial totals, and version advancement. Clear/reset old local caches and offline queues on *every* device before resuming; keep exported recovery files secure until reviewed. Restored pending queue rows and Telegram deliveries are quarantined for manual review rather than replayed automatically.
6. Do not delete storage objects as part of a business reset. Review them separately only after an independent backup and explicit authorization. Reconnect devices and workers after verifying the reset/restore.

## Release acceptance
- GitHub CI: TypeScript, Vitest, static audit, built Chromium browser smoke (local owner/staff navigation, counter-service billing).
- Live SQL rollback checks: sale/purchase/FIFO, idempotency, return/exchange/warranty, customer/supplier payments, partial payments and finance, PIN and role isolation, price/gift validation, remote logout, invoice correction/cancellation, backup confirmation and restore. Use synthetic fixtures and roll back; never leave test records in the real shop.
- Native build artifacts must be inspected and installed on actual Windows and Android devices before a public release. Verify owner/staff real login, PIN and biometric, scanner/IMEI, camera, thermal printer, offline restart/reconnect and simultaneous multi-device operations, AI providers, Telegram, WhatsApp and R2/Supabase Storage. These tests are not replaced by the browser build.
- Existing 53-unit FIFO discrepancy and abandoned sale are historical reconciliation items; do not fabricate batches or replay without verified source evidence. A clean-shop reset is a separate decision.
- Security Advisor: review warnings rather than removing intended RPC grants or weakening RLS to make the dashboard green. Release publishing is limited to the private release-admin allowlist; only the platform manifest remains intentionally public.
