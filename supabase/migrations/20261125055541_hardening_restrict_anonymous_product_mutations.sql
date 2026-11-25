-- Keep the public app update manifest callable; product mutations require a signed-in caller.
REVOKE EXECUTE ON FUNCTION public.set_product_review_status(uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.upsert_product_catalog(uuid,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,boolean,numeric,boolean,integer,boolean,text,text,jsonb,numeric,numeric,boolean,boolean,numeric,jsonb,jsonb,jsonb,text) FROM PUBLIC, anon;
