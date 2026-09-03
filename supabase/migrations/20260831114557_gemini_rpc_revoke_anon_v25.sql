revoke execute on function public.save_gemini_api_key(smallint, text, text) from anon;
revoke execute on function public.get_gemini_key_status() from anon;
-- also lock down the search_path on the trigger helper (advisor flagged it as mutable)
alter function public.touch_gemini_updated_at() set search_path = public;
