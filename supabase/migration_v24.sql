-- SpawnVault 2.4.0. Executar após as migrações v2, v21, v22 e v23.
-- Preserva contas e dados. Arquivo pessoal; decisões e criação são transacionais.
BEGIN;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_check CHECK(role IN ('admin','moderator','user'));

CREATE OR REPLACE FUNCTION public.is_spawnvault_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND NOT public.spawnvault_is_blocked()
 AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=(SELECT auth.uid()) AND role IN ('admin','moderator'));
$$;
REVOKE ALL ON FUNCTION public.is_spawnvault_staff() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_spawnvault_staff() TO authenticated;

-- Serializa a verificação de spawns iguais também entre criações simultâneas.
CREATE OR REPLACE FUNCTION public.spawnvault_prevent_duplicate_spawn() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.deleted_at IS NULL THEN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lower(btrim(NEW.spawn_name)),236024));
  IF EXISTS(SELECT 1 FROM public.items i WHERE i.id<>NEW.id AND i.deleted_at IS NULL
   AND lower(btrim(i.spawn_name))=lower(btrim(NEW.spawn_name)))
  THEN RAISE EXCEPTION 'Já existe um item ativo com este spawn'; END IF;
 END IF;
 RETURN NEW;
END;
$$;

-- Moderadores criam itens ativos, mas não alteram/eliminam itens nem gerem grupos.
DROP POLICY IF EXISTS "SpawnVault staff create items" ON public.items;
CREATE POLICY "SpawnVault staff create items" ON public.items FOR INSERT TO authenticated
 WITH CHECK(public.is_spawnvault_staff() AND created_by=(SELECT auth.uid()) AND deleted_at IS NULL);
DROP POLICY IF EXISTS "SpawnVault staff upload images" ON storage.objects;
CREATE POLICY "SpawnVault staff upload images" ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='item-images' AND public.is_spawnvault_staff() AND owner_id=(SELECT auth.uid()::text));
DROP POLICY IF EXISTS "SpawnVault staff clean own images" ON storage.objects;
CREATE OR REPLACE FUNCTION public.spawnvault_image_in_use(image_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.items WHERE image_path=image_name);
$$;
REVOKE ALL ON FUNCTION public.spawnvault_image_in_use(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.spawnvault_image_in_use(text) TO authenticated;
CREATE POLICY "SpawnVault staff clean own images" ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='item-images' AND public.is_spawnvault_staff() AND owner_id=(SELECT auth.uid()::text)
 AND NOT public.spawnvault_image_in_use(name));

DROP POLICY IF EXISTS "SpawnVault requests read" ON public.item_requests;
CREATE POLICY "SpawnVault requests read" ON public.item_requests FOR SELECT TO authenticated
 USING(requested_by=(SELECT auth.uid()) OR public.is_spawnvault_staff());
DROP POLICY IF EXISTS "SpawnVault requests cancel own" ON public.item_requests;
CREATE POLICY "SpawnVault requests cancel own" ON public.item_requests FOR DELETE TO authenticated
 USING(requested_by=(SELECT auth.uid()) AND status='pending');
GRANT DELETE ON public.item_requests TO authenticated;

-- Compatível com clientes anteriores: o servidor fixa sempre a identidade da decisão.
CREATE OR REPLACE FUNCTION public.spawnvault_validate_request_review()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT public.is_spawnvault_staff() OR OLD.status<>'pending' OR NEW.status NOT IN ('approved','rejected')
 THEN RAISE EXCEPTION 'O pedido já foi analisado ou não tens permissão'; END IF;
 IF (NEW.id,NEW.name,NEW.spawn_name,NEW.reason,NEW.requested_by,NEW.created_at)
 IS DISTINCT FROM (OLD.id,OLD.name,OLD.spawn_name,OLD.reason,OLD.requested_by,OLD.created_at)
 THEN RAISE EXCEPTION 'Não podes alterar os dados do pedido'; END IF;
 NEW.reviewed_by=auth.uid(); NEW.reviewed_at=now(); RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS spawnvault_request_review_guard ON public.item_requests;
CREATE TRIGGER spawnvault_request_review_guard BEFORE UPDATE ON public.item_requests
 FOR EACH ROW EXECUTE FUNCTION public.spawnvault_validate_request_review();

CREATE OR REPLACE FUNCTION public.spawnvault_review_request(request_id uuid,decision text,item_data jsonb DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE req public.item_requests%ROWTYPE; item_id uuid;
BEGIN
 IF NOT public.is_spawnvault_staff() THEN RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE='42501'; END IF;
 IF decision IS NULL OR decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Decisão inválida'; END IF;
 SELECT * INTO req FROM public.item_requests WHERE id=request_id FOR UPDATE;
 IF NOT FOUND OR req.status<>'pending' THEN RAISE EXCEPTION 'O pedido foi eliminado ou já foi analisado'; END IF;
 IF decision='approved' THEN
  IF item_data IS NULL THEN RAISE EXCEPTION 'Preenche os dados do item'; END IF;
  INSERT INTO public.items(name,spawn_name,group_id,category,description,image_path,created_by)
  VALUES(btrim(item_data->>'name'),btrim(item_data->>'spawn_name'),(item_data->>'group_id')::uuid,
   coalesce(item_data->>'category',''),coalesce(item_data->>'description',''),nullif(item_data->>'image_path',''),auth.uid())
  RETURNING id INTO item_id;
 END IF;
 UPDATE public.item_requests SET status=decision WHERE id=request_id;
 RETURN item_id;
END;
$$;
REVOKE ALL ON FUNCTION public.spawnvault_review_request(uuid,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.spawnvault_review_request(uuid,text,jsonb) TO authenticated;

CREATE TABLE IF NOT EXISTS public.item_request_archives (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL REFERENCES public.item_requests(id) ON DELETE CASCADE,
 archived_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,request_id)
);
ALTER TABLE public.item_request_archives ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SpawnVault own archives read" ON public.item_request_archives;
CREATE POLICY "SpawnVault own archives read" ON public.item_request_archives FOR SELECT TO authenticated
 USING(user_id=(SELECT auth.uid()) AND NOT public.spawnvault_is_blocked());
DROP POLICY IF EXISTS "SpawnVault own archives create" ON public.item_request_archives;
CREATE POLICY "SpawnVault own archives create" ON public.item_request_archives FOR INSERT TO authenticated
 WITH CHECK(user_id=(SELECT auth.uid()) AND NOT public.spawnvault_is_blocked()
 AND EXISTS(SELECT 1 FROM public.item_requests r WHERE r.id=request_id AND r.status IN ('approved','rejected')));
DROP POLICY IF EXISTS "SpawnVault own archives remove" ON public.item_request_archives;
CREATE POLICY "SpawnVault own archives remove" ON public.item_request_archives FOR DELETE TO authenticated
 USING(user_id=(SELECT auth.uid()) AND NOT public.spawnvault_is_blocked());
GRANT SELECT,INSERT,DELETE ON public.item_request_archives TO authenticated;

-- Identidades apenas para pedidos visíveis ao chamador. Não expõe a lista de contas/emails.
CREATE OR REPLACE FUNCTION public.spawnvault_list_requests()
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR public.spawnvault_is_blocked() THEN RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT to_jsonb(r)||jsonb_build_object(
  'requester_username',coalesce(nullif(btrim(u.raw_user_meta_data->>'username'),''),nullif(btrim(u.raw_user_meta_data->>'user_name'),''),nullif(btrim(u.raw_user_meta_data->>'display_name'),''),nullif(split_part(u.email,'@',1),''),r.requested_by::text),
  'reviewer_username',CASE WHEN r.reviewed_by IS NULL THEN NULL ELSE coalesce(nullif(btrim(v.raw_user_meta_data->>'username'),''),nullif(btrim(v.raw_user_meta_data->>'user_name'),''),nullif(btrim(v.raw_user_meta_data->>'display_name'),''),nullif(split_part(v.email,'@',1),''),r.reviewed_by::text) END,
  'is_archived',EXISTS(SELECT 1 FROM public.item_request_archives a WHERE a.request_id=r.id AND a.user_id=auth.uid()))
 FROM public.item_requests r LEFT JOIN auth.users u ON u.id=r.requested_by LEFT JOIN auth.users v ON v.id=r.reviewed_by
 WHERE r.requested_by=auth.uid() OR public.is_spawnvault_staff() ORDER BY r.created_at DESC,r.id;
END;
$$;
REVOKE ALL ON FUNCTION public.spawnvault_list_requests() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.spawnvault_list_requests() TO authenticated;

-- Mesmas proteções da v2.3, incluindo a serialização com os bloqueios de contas.
CREATE OR REPLACE FUNCTION public.spawnvault_set_user_role(target_user uuid,new_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(236023,1);
 IF NOT public.is_spawnvault_admin() THEN RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE='42501'; END IF;
 IF new_role IS NULL OR new_role NOT IN ('admin','moderator','user') THEN RAISE EXCEPTION 'Papel inválido'; END IF;
 IF target_user=auth.uid() AND new_role<>'admin' THEN RAISE EXCEPTION 'Não podes remover o teu próprio acesso de administrador'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=target_user) THEN RAISE EXCEPTION 'Utilizador inexistente'; END IF;
 IF new_role<>'admin' AND EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=target_user AND r.role='admin')
 AND NOT EXISTS(SELECT 1 FROM public.spawnvault_user_access a WHERE a.user_id=target_user AND a.blocked)
 AND (SELECT count(*) FROM public.user_roles r LEFT JOIN public.spawnvault_user_access a ON a.user_id=r.user_id WHERE r.role='admin' AND NOT coalesce(a.blocked,false))<2
 THEN RAISE EXCEPTION 'Não podes remover o último administrador ativo'; END IF;
 INSERT INTO public.user_roles(user_id,role) VALUES(target_user,new_role) ON CONFLICT(user_id) DO UPDATE SET role=EXCLUDED.role;
END;
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
