-- Step 7.3 follow-up fix. Same class of bug as gemini_usage_revoke_anon_v28/v29:
-- Supabase's default privileges in this project grant EXECUTE on new public
-- functions to anon directly (not just via the PUBLIC pseudo-role), so a
-- plain "revoke all ... from public" in the v34 migration was not enough to
-- keep get_storage_usage_summary() off the anon role. Explicit fix:
revoke execute on function public.get_storage_usage_summary() from anon;
