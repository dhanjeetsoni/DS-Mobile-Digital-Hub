revoke all on function public.record_gemini_key_usage(uuid, smallint, boolean, text, timestamptz, text) from public;
grant execute on function public.record_gemini_key_usage(uuid, smallint, boolean, text, timestamptz, text) to authenticated, service_role;
