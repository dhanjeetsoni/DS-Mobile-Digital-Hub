-- Scope new cloud queue records to their authenticated creator.
-- Legacy entries intentionally remain unassigned and visible to owner/manager review.
ALTER TABLE public.sync_queue ADD COLUMN queued_by uuid;
ALTER TABLE public.sync_queue ALTER COLUMN queued_by SET DEFAULT auth.uid();
CREATE INDEX sync_queue_creator_status_idx ON public.sync_queue(store_id,queued_by,status,created_at);
CREATE POLICY sync_queue_creator_read ON public.sync_queue AS RESTRICTIVE FOR SELECT TO authenticated
 USING (queued_by=(SELECT auth.uid()) OR public.can_manage_store_profiles(store_id));
CREATE POLICY sync_queue_creator_insert ON public.sync_queue AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (queued_by=(SELECT auth.uid()));
CREATE POLICY sync_queue_creator_update ON public.sync_queue AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (queued_by=(SELECT auth.uid()) OR public.can_manage_store_profiles(store_id))
 WITH CHECK (queued_by=(SELECT auth.uid()) OR public.can_manage_store_profiles(store_id));
CREATE POLICY sync_queue_creator_delete ON public.sync_queue AS RESTRICTIVE FOR DELETE TO authenticated
 USING (queued_by=(SELECT auth.uid()) OR public.can_manage_store_profiles(store_id));
CREATE OR REPLACE FUNCTION public.keep_sync_queue_identity() RETURNS trigger
 LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('authenticated','anon') AND
 (NEW.queued_by IS DISTINCT FROM OLD.queued_by OR NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.operation_id IS DISTINCT FROM OLD.operation_id) THEN
 RAISE EXCEPTION 'Queue identity cannot be changed';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.keep_sync_queue_identity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER hardening_queue_identity BEFORE UPDATE ON public.sync_queue FOR EACH ROW EXECUTE FUNCTION public.keep_sync_queue_identity();
