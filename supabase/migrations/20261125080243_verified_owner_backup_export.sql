-- Export the owner's verified business checkpoint without exposing the private recovery schema.
CREATE OR REPLACE FUNCTION public.export_shop_checkpoint() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE shop uuid; backup_id uuid; b ds_recovery.business_backups%ROWTYPE;
BEGIN
 SELECT store_id INTO shop FROM public.profiles WHERE id=auth.uid() AND role='owner';
 IF shop IS NULL OR NOT public.current_account_allowed() THEN RAISE EXCEPTION 'owner required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(shop::text||':checkpoint',0));
 backup_id:=ds_recovery.capture_business(shop,'owner download');
 PERFORM ds_recovery.verify_business_backup(backup_id);
 SELECT * INTO STRICT b FROM ds_recovery.business_backups WHERE id=backup_id AND store_id=shop;
 RETURN jsonb_build_object('format','dsmdh-business-v1','storeId',shop,'backupId',b.id,'exportedAt',b.created_at,'sha256',b.sha256,'counts',b.counts,'payload',b.payload);
END $$;
REVOKE ALL ON FUNCTION public.export_shop_checkpoint() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.export_shop_checkpoint() TO authenticated;
-- Trigger functions need no client EXECUTE grant.
REVOKE EXECUTE ON FUNCTION public.enforce_sale_item_product_store_match(),public.enqueue_invoice_telegram(),public.handle_new_user(),public.notify_low_stock(),public.rls_auto_enable(),public.schedule_warranty_claim_reminder(),public.sync_products_staff_view(),public.sync_products_staff_view_phase6_photos() FROM PUBLIC,anon,authenticated;
