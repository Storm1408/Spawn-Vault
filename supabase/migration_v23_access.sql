-- SpawnVault 2.3: bloqueio de acesso à aplicação, reversível e sem eliminar contas.
-- Executar como proprietário, após as migrações v2, v21 e v22.
-- Não altera auth.users, passwords, user_roles, itens ou os SQL anteriores.
BEGIN;

CREATE TABLE IF NOT EXISTS public.spawnvault_user_access (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 blocked boolean NOT NULL DEFAULT false,
 reason text NOT NULL DEFAULT '' CHECK(length(reason)<=500),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE public.spawnvault_user_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.spawnvault_user_access FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.spawnvault_is_blocked()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.spawnvault_user_access WHERE user_id=(SELECT auth.uid()) AND blocked);
$$;
REVOKE ALL ON FUNCTION public.spawnvault_is_blocked() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.spawnvault_is_blocked() TO authenticated;

-- RPCs administrativas existentes reutilizam esta função e ficam igualmente protegidas.
CREATE OR REPLACE FUNCTION public.is_spawnvault_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND NOT public.spawnvault_is_blocked()
 AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=(SELECT auth.uid()) AND role='admin');
$$;
REVOKE ALL ON FUNCTION public.is_spawnvault_admin() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_spawnvault_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.spawnvault_access_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE access_row public.spawnvault_user_access%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão necessária' USING ERRCODE='42501'; END IF;
 SELECT * INTO access_row FROM public.spawnvault_user_access WHERE user_id=auth.uid();
 RETURN jsonb_build_object('blocked',coalesce(access_row.blocked,false),
 'reason',CASE WHEN coalesce(access_row.blocked,false) THEN coalesce(access_row.reason,'') ELSE '' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.spawnvault_list_user_access()
RETURNS TABLE(user_id uuid,email text,role text,blocked boolean,reason text,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.is_spawnvault_admin() THEN RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT u.id,u.email::text,coalesce(r.role,'user')::text,
 coalesce(a.blocked,false),coalesce(a.reason,''),a.updated_at
 FROM auth.users u LEFT JOIN public.user_roles r ON r.user_id=u.id
 LEFT JOIN public.spawnvault_user_access a ON a.user_id=u.id ORDER BY u.email;
END;
$$;

CREATE OR REPLACE FUNCTION public.spawnvault_set_user_block(target_user uuid,blocked_value boolean,block_reason text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_email text; target_role text; was_blocked boolean;
BEGIN
 -- Serializa operações de bloqueio e volta a validar o administrador após a espera.
 PERFORM pg_catalog.pg_advisory_xact_lock(236023,1);
 IF NOT public.is_spawnvault_admin() THEN RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE='42501'; END IF;
 IF blocked_value IS NULL THEN RAISE EXCEPTION 'Estado inválido'; END IF;
 IF length(coalesce(block_reason,''))>500 THEN RAISE EXCEPTION 'Motivo demasiado longo'; END IF;
 IF target_user=auth.uid() AND blocked_value THEN RAISE EXCEPTION 'Não podes bloquear a tua própria conta'; END IF;
 SELECT u.email,coalesce(r.role,'user'),coalesce(a.blocked,false)
 INTO target_email,target_role,was_blocked FROM auth.users u
 LEFT JOIN public.user_roles r ON r.user_id=u.id
 LEFT JOIN public.spawnvault_user_access a ON a.user_id=u.id WHERE u.id=target_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'Utilizador inexistente'; END IF;
 IF blocked_value AND NOT was_blocked AND target_role='admin' AND
 (SELECT count(*) FROM public.user_roles r LEFT JOIN public.spawnvault_user_access a ON a.user_id=r.user_id
 WHERE r.role='admin' AND NOT coalesce(a.blocked,false))<2
 THEN RAISE EXCEPTION 'Não podes bloquear o último administrador ativo'; END IF;
 INSERT INTO public.spawnvault_user_access(user_id,blocked,reason,updated_at,updated_by)
 VALUES(target_user,blocked_value,CASE WHEN blocked_value THEN btrim(coalesce(block_reason,'')) ELSE '' END,now(),auth.uid())
 ON CONFLICT(user_id) DO UPDATE SET blocked=EXCLUDED.blocked,reason=EXCLUDED.reason,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by;
 IF was_blocked IS DISTINCT FROM blocked_value THEN
  INSERT INTO public.item_audit(actor_id,actor_email,action,item_name)
  VALUES(auth.uid(),(SELECT email FROM auth.users WHERE id=auth.uid()),
  CASE WHEN blocked_value THEN 'users:BLOCK' ELSE 'users:UNBLOCK' END,target_email);
 END IF;
END;
$$;

-- A alteração de papéis partilha o mesmo bloqueio transacional, para impedir
-- que uma despromoção simultânea deixe o catálogo sem administrador ativo.
CREATE OR REPLACE FUNCTION public.spawnvault_set_user_role(target_user uuid,new_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(236023,1);
 IF NOT public.is_spawnvault_admin() THEN RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE='42501'; END IF;
 IF new_role IS NULL OR new_role NOT IN ('admin','user') THEN RAISE EXCEPTION 'Papel inválido'; END IF;
 IF target_user=auth.uid() AND new_role<>'admin' THEN RAISE EXCEPTION 'Não podes remover o teu próprio acesso de administrador'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=target_user) THEN RAISE EXCEPTION 'Utilizador inexistente'; END IF;
 IF new_role<>'admin' AND EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=target_user AND r.role='admin')
 AND NOT EXISTS(SELECT 1 FROM public.spawnvault_user_access a WHERE a.user_id=target_user AND a.blocked)
 AND (SELECT count(*) FROM public.user_roles r LEFT JOIN public.spawnvault_user_access a ON a.user_id=r.user_id WHERE r.role='admin' AND NOT coalesce(a.blocked,false))<2
 THEN RAISE EXCEPTION 'Não podes remover o último administrador ativo'; END IF;
 INSERT INTO public.user_roles(user_id,role) VALUES(target_user,new_role)
 ON CONFLICT(user_id) DO UPDATE SET role=EXCLUDED.role;
END;
$$;
REVOKE ALL ON FUNCTION public.spawnvault_set_user_role(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.spawnvault_set_user_role(uuid,text) TO authenticated;

REVOKE ALL ON FUNCTION public.spawnvault_access_status() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.spawnvault_list_user_access() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.spawnvault_set_user_block(uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.spawnvault_access_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.spawnvault_list_user_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.spawnvault_set_user_block(uuid,boolean,text) TO authenticated;

-- AND restritivo: preserva as políticas e permissões existentes dos utilizadores ativos.
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['items','groups','user_roles','item_audit','item_favorites','item_requests'] LOOP
  EXECUTE format('DROP POLICY IF EXISTS "SpawnVault active account" ON public.%I',tbl);
  EXECUTE format('CREATE POLICY "SpawnVault active account" ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.spawnvault_is_blocked())) WITH CHECK ((SELECT NOT public.spawnvault_is_blocked()))',tbl);
 END LOOP;
END $$;
-- Só o bucket da aplicação é restringido; outros buckets não são alterados.
DROP POLICY IF EXISTS "SpawnVault active image account" ON storage.objects;
CREATE POLICY "SpawnVault active image account" ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
 USING(bucket_id<>'item-images' OR (SELECT NOT public.spawnvault_is_blocked()))
 WITH CHECK(bucket_id<>'item-images' OR (SELECT NOT public.spawnvault_is_blocked()));

NOTIFY pgrst,'reload schema';
COMMIT;
