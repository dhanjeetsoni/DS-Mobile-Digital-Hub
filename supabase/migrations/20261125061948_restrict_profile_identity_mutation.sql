-- Preserve profile self-read for logout, restrict administrative profile mutations.
REVOKE UPDATE (id,store_id,role,created_at,created_by,email,staff_login_id,last_active_at,last_offline_download_at) ON public.profiles FROM authenticated;
CREATE OR REPLACE FUNCTION public.can_manage_store_profiles(p_store_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.store_id=p_store_id AND
 (p.role='owner' OR (p.role='manager' AND p.access_enabled IS TRUE AND (p.access_mode='no_restriction' OR p.access_expires_at>now()))));
$$;
REVOKE ALL ON FUNCTION public.can_manage_store_profiles(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_manage_store_profiles(uuid) TO authenticated;
DROP POLICY profiles_owner_manager_update_staff ON public.profiles;
CREATE POLICY profiles_owner_manager_update_staff ON public.profiles FOR UPDATE TO authenticated
 USING (role IN ('staff','manager') AND public.can_manage_store_profiles(store_id))
 WITH CHECK (role IN ('staff','manager') AND public.can_manage_store_profiles(store_id));
