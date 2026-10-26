-- SpawnVault 2.4.1. Aplicar após migration_v24.sql.
-- Preserva UUIDs, emails, passwords, papéis, bloqueios e dados existentes.
BEGIN;
CREATE TABLE IF NOT EXISTS public.spawnvault_accounts (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 username text NOT NULL CHECK(username ~ '^[A-Za-z0-9_$][A-Za-z0-9._$-]{2,39}$'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS spawnvault_username_unique ON public.spawnvault_accounts(lower(username));
ALTER TABLE public.spawnvault_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.spawnvault_accounts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.spawnvault_accounts TO authenticated;
GRANT ALL ON public.spawnvault_accounts TO service_role;
DROP POLICY IF EXISTS "SpawnVault account names" ON public.spawnvault_accounts;
CREATE POLICY "SpawnVault account names" ON public.spawnvault_accounts FOR SELECT TO authenticated
 USING(NOT public.spawnvault_is_blocked() AND (user_id=(SELECT auth.uid()) OR public.is_spawnvault_admin()));

-- Migração determinística dos nomes; colisões recebem um sufixo, sem perder contas.
DO $$ DECLARE u record; candidate text; stem text; n integer; BEGIN
 FOR u IN SELECT id,email,raw_user_meta_data FROM auth.users ORDER BY id LOOP
  IF EXISTS(SELECT 1 FROM public.spawnvault_accounts WHERE user_id=u.id) THEN CONTINUE; END IF;
  stem=left(regexp_replace(coalesce(nullif(btrim(u.raw_user_meta_data->>'username'),''),nullif(btrim(u.raw_user_meta_data->>'user_name'),''),nullif(split_part(u.email,'@',1),''),'user'),'[^A-Za-z0-9._$-]','_','g'),30);
  IF stem !~ '^[A-Za-z0-9_$]' THEN stem='u_'||stem; END IF;
  IF length(stem)<3 THEN stem='user_'||stem; END IF;
  candidate=stem;n=0;
  WHILE EXISTS(SELECT 1 FROM public.spawnvault_accounts WHERE lower(username)=lower(candidate)) LOOP
   n=n+1;candidate=left(stem,25)||'_'||left(replace(u.id::text,'-',''),8)||CASE WHEN n>1 THEN n::text ELSE '' END;
  END LOOP;
  INSERT INTO public.spawnvault_accounts(user_id,username) VALUES(u.id,candidate);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.spawnvault_list_accounts()
RETURNS TABLE(user_id uuid,email text,role text,username text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.is_spawnvault_admin() THEN RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT u.id,u.email::text,coalesce(r.role,'user')::text,a.username
 FROM auth.users u LEFT JOIN public.user_roles r ON r.user_id=u.id
 LEFT JOIN public.spawnvault_accounts a ON a.user_id=u.id ORDER BY lower(a.username),u.id;
END;
$$;
REVOKE ALL ON FUNCTION public.spawnvault_list_accounts() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.spawnvault_list_accounts() TO authenticated;

CREATE OR REPLACE FUNCTION public.spawnvault_set_username(target_user uuid,new_username text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old_username text;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(236023,1);
 IF NOT public.is_spawnvault_admin() THEN RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE='42501'; END IF;
 IF new_username IS NULL OR new_username !~ '^[A-Za-z0-9_$][A-Za-z0-9._$-]{2,39}$' THEN RAISE EXCEPTION 'Username inválido: usa 3 a 40 letras, números, ponto, _, $ ou -'; END IF;
 SELECT username INTO old_username FROM public.spawnvault_accounts WHERE user_id=target_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Utilizador inexistente'; END IF;
 UPDATE public.spawnvault_accounts SET username=new_username WHERE user_id=target_user;
 IF old_username IS DISTINCT FROM new_username THEN
  INSERT INTO public.item_audit(actor_id,actor_email,action,item_name)
  VALUES(auth.uid(),(SELECT email FROM auth.users WHERE id=auth.uid()),'users:USERNAME',old_username||' → '||new_username);
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.spawnvault_set_username(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.spawnvault_set_username(uuid,text) TO authenticated;

-- Apenas a função de servidor resolve usernames para emails. Nunca disponibiliza emails anónimos.
CREATE OR REPLACE FUNCTION public.spawnvault_resolve_login(login_username text)
RETURNS TABLE(user_id uuid,email text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT a.user_id,u.email::text FROM public.spawnvault_accounts a JOIN auth.users u ON u.id=a.user_id
 WHERE lower(a.username)=lower(login_username);
$$;
REVOKE ALL ON FUNCTION public.spawnvault_resolve_login(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.spawnvault_resolve_login(text) TO service_role;

-- Limites persistentes, partilhados por todas as instâncias da função de login.
CREATE TABLE IF NOT EXISTS public.spawnvault_login_limits (
 bucket text PRIMARY KEY,window_start timestamptz NOT NULL,hits integer NOT NULL
);
ALTER TABLE public.spawnvault_login_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.spawnvault_login_limits FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.spawnvault_take_login_limit(bucket_key text,max_hits integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE count_hits integer;
BEGIN
 IF length(bucket_key)>150 OR max_hits NOT IN (20,60) THEN RAISE EXCEPTION 'Limite inválido'; END IF;
 INSERT INTO public.spawnvault_login_limits(bucket,window_start,hits) VALUES(bucket_key,now(),1)
 ON CONFLICT(bucket) DO UPDATE SET
  window_start=CASE WHEN spawnvault_login_limits.window_start<now()-interval '15 minutes' THEN now() ELSE spawnvault_login_limits.window_start END,
  hits=CASE WHEN spawnvault_login_limits.window_start<now()-interval '15 minutes' THEN 1 ELSE spawnvault_login_limits.hits+1 END
 RETURNING hits INTO count_hits;
 DELETE FROM public.spawnvault_login_limits WHERE window_start<now()-interval '1 day';
 RETURN count_hits<=max_hits;
END;
$$;
REVOKE ALL ON FUNCTION public.spawnvault_take_login_limit(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.spawnvault_take_login_limit(text,integer) TO service_role;

-- Inscrição pública não cria contas. Só aceita dados privados enviados pela função administrativa.
-- Não verifica passwords nem escreve diretamente credenciais: essa tarefa pertence ao Supabase Auth.
CREATE OR REPLACE FUNCTION public.spawnvault_provision_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE creator uuid; requested_role text; chosen_username text;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(236023,1);
 BEGIN creator=(NEW.raw_app_meta_data->>'spawnvault_created_by')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'As contas são criadas apenas pela administração do SpawnVault'; END;
 IF creator IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=creator AND r.role='admin')
 OR EXISTS(SELECT 1 FROM public.spawnvault_user_access a WHERE a.user_id=creator AND a.blocked)
 THEN RAISE EXCEPTION 'As contas são criadas apenas pela administração do SpawnVault'; END IF;
 chosen_username=NEW.raw_app_meta_data->>'spawnvault_username';requested_role=NEW.raw_app_meta_data->>'spawnvault_role';
 IF chosen_username IS NULL OR chosen_username !~ '^[A-Za-z0-9_$][A-Za-z0-9._$-]{2,39}$'
 OR requested_role IS NULL OR requested_role NOT IN ('user','moderator','admin') THEN RAISE EXCEPTION 'Dados da conta inválidos'; END IF;
 INSERT INTO public.spawnvault_accounts(user_id,username) VALUES(NEW.id,chosen_username);
 INSERT INTO public.user_roles(user_id,role) VALUES(NEW.id,requested_role);
 INSERT INTO public.item_audit(actor_id,actor_email,action,item_name)
 VALUES(creator,(SELECT email FROM auth.users WHERE id=creator),'users:CREATE',chosen_username);
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.spawnvault_provision_account() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS spawnvault_provision_account ON auth.users;
CREATE TRIGGER spawnvault_provision_account AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.spawnvault_provision_account();

-- Os pedidos passam a usar o username de acesso, protegido contra alterações pelo utilizador.
CREATE OR REPLACE FUNCTION public.spawnvault_list_requests()
RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR public.spawnvault_is_blocked() THEN RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT to_jsonb(r)||jsonb_build_object(
  'requester_username',coalesce(u.username,r.requested_by::text),
  'reviewer_username',v.username,
  'is_archived',EXISTS(SELECT 1 FROM public.item_request_archives a WHERE a.request_id=r.id AND a.user_id=auth.uid()))
 FROM public.item_requests r LEFT JOIN public.spawnvault_accounts u ON u.user_id=r.requested_by
 LEFT JOIN public.spawnvault_accounts v ON v.user_id=r.reviewed_by
 WHERE r.requested_by=auth.uid() OR public.is_spawnvault_staff() ORDER BY r.created_at DESC,r.id;
END;
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
