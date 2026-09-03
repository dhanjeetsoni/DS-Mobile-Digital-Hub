-- store_state_tombstone_trigger() is a trigger function, not meant to be
-- called directly. Supabase's advisor flagged it as reachable via
-- /rest/v1/rpc/store_state_tombstone_trigger for both anon and authenticated
-- (PostgREST exposes every function in the public schema as an RPC by
-- default). Calling it directly would already fail at runtime (trigger
-- functions require trigger context), but revoking EXECUTE removes the
-- attack surface/noise entirely and matches how every other internal helper
-- in this migration was already locked down.
revoke all on function public.store_state_tombstone_trigger() from public, anon, authenticated;
