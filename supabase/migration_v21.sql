-- SpawnVault 2.1: executar UMA VEZ no SQL Editor, após migration_v2.sql.
-- Faz cópia de segurança antes de executar. Mantém os itens existentes.
BEGIN;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS image_path text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('item-images', 'item-images', false, 3145728, ARRAY['image/png','image/jpeg','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET public=false, file_size_limit=3145728,
 allowed_mime_types=ARRAY['image/png','image/jpeg','image/webp','image/gif'];

DROP POLICY IF EXISTS "SpawnVault image read" ON storage.objects;
DROP POLICY IF EXISTS "SpawnVault image add" ON storage.objects;
DROP POLICY IF EXISTS "SpawnVault image delete" ON storage.objects;
CREATE POLICY "SpawnVault image read" ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id='item-images');
CREATE POLICY "SpawnVault image add" ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (bucket_id='item-images' AND public.is_spawnvault_admin());
CREATE POLICY "SpawnVault image delete" ON storage.objects FOR DELETE TO authenticated
 USING (bucket_id='item-images' AND public.is_spawnvault_admin());

-- Registo de alterações; apenas administradores o consultam.
CREATE TABLE IF NOT EXISTS public.item_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 actor_id uuid,
 actor_email text,
 action text NOT NULL,
 item_id uuid,
 item_name text
);
ALTER TABLE public.item_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SpawnVault audit read" ON public.item_audit;
CREATE POLICY "SpawnVault audit read" ON public.item_audit FOR SELECT TO authenticated
 USING (public.is_spawnvault_admin());
REVOKE ALL ON public.item_audit FROM anon,authenticated;
GRANT SELECT ON public.item_audit TO authenticated;

CREATE OR REPLACE FUNCTION public.spawnvault_audit_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE record_id uuid; record_name text;
BEGIN
 IF TG_OP='DELETE' THEN record_id=OLD.id;record_name=OLD.name;
 ELSE record_id=NEW.id;record_name=NEW.name; END IF;
 INSERT INTO public.item_audit(actor_id,actor_email,action,item_id,item_name)
 VALUES (auth.uid(),(SELECT email FROM auth.users WHERE id=auth.uid()),TG_OP,record_id,record_name);
 RETURN COALESCE(NEW,OLD);
END;
$$;
DROP TRIGGER IF EXISTS spawnvault_items_audit ON public.items;
CREATE TRIGGER spawnvault_items_audit AFTER INSERT OR UPDATE OR DELETE ON public.items
 FOR EACH ROW EXECUTE FUNCTION public.spawnvault_audit_item();

-- Lista de utilizadores limitada a administradores.
CREATE OR REPLACE FUNCTION public.spawnvault_list_users()
RETURNS TABLE(user_id uuid,email text,role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT public.is_spawnvault_admin() THEN RAISE EXCEPTION 'Acesso não autorizado'; END IF;
 RETURN QUERY SELECT u.id,u.email::text,coalesce(r.role,'user')::text
 FROM auth.users u LEFT JOIN public.user_roles r ON r.user_id=u.id ORDER BY u.email;
END;
$$;
CREATE OR REPLACE FUNCTION public.spawnvault_set_user_role(target_user uuid,new_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT public.is_spawnvault_admin() THEN RAISE EXCEPTION 'Acesso não autorizado'; END IF;
 IF new_role NOT IN ('admin','user') THEN RAISE EXCEPTION 'Papel inválido'; END IF;
 IF target_user=auth.uid() AND new_role<>'admin' THEN RAISE EXCEPTION 'Não podes remover o teu próprio acesso de administrador'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=target_user) THEN RAISE EXCEPTION 'Utilizador inexistente'; END IF;
 INSERT INTO public.user_roles(user_id,role) VALUES(target_user,new_role)
 ON CONFLICT(user_id) DO UPDATE SET role=EXCLUDED.role;
END;
$$;
REVOKE ALL ON FUNCTION public.spawnvault_list_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.spawnvault_set_user_role(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.spawnvault_list_users() TO authenticated;
GRANT EXECUTE ON FUNCTION public.spawnvault_set_user_role(uuid,text) TO authenticated;
COMMIT;
