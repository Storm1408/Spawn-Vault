-- SpawnVault 2.2 — executar APÓS migration_v2.sql e migration_v21.sql.
-- Fazer cópia de segurança das tabelas items, groups, user_roles e storage antes de aplicar.
-- Migração preserva os itens e os UUID existentes. Pode ser repetida sem recriar dados.
BEGIN;

-- Hierarquia: grupos principais (parent_id NULL) e subgrupos (parent_id UUID).
ALTER TABLE public.groups ADD COLUMN IF NOT EXISTS parent_id uuid;
ALTER TABLE public.groups DROP CONSTRAINT IF EXISTS groups_parent_id_fkey;
ALTER TABLE public.groups ADD CONSTRAINT groups_parent_id_fkey FOREIGN KEY(parent_id) REFERENCES public.groups(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS groups_parent_id_idx ON public.groups(parent_id);

-- Converter grupos antigos em subgrupos de um grupo principal, sem perder associações.
DO $$
DECLARE root_id uuid;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.groups WHERE parent_id IS NOT NULL)
    AND EXISTS (SELECT 1 FROM public.groups WHERE parent_id IS NULL AND name <> 'Catálogo anterior') THEN
  SELECT id INTO root_id FROM public.groups WHERE name='Catálogo anterior' AND parent_id IS NULL LIMIT 1;
  IF root_id IS NULL THEN
   INSERT INTO public.groups(name) VALUES ('Catálogo anterior') RETURNING id INTO root_id;
  END IF;
  UPDATE public.groups SET parent_id=root_id WHERE parent_id IS NULL AND id<>root_id;
 END IF;
END $$;

-- Impedir que um subgrupo seja pai e que existam ciclos na hierarquia.
CREATE OR REPLACE FUNCTION public.spawnvault_validate_group() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.parent_id IS NOT NULL THEN
  IF NEW.id=NEW.parent_id OR NOT EXISTS (SELECT 1 FROM public.groups p WHERE p.id=NEW.parent_id AND p.parent_id IS NULL)
  THEN RAISE EXCEPTION 'O pai tem de ser um grupo principal'; END IF;
  IF EXISTS (SELECT 1 FROM public.groups c WHERE c.parent_id=NEW.id)
  THEN RAISE EXCEPTION 'Não podes transformar um grupo principal com subgrupos num subgrupo'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS spawnvault_groups_validate ON public.groups;
CREATE TRIGGER spawnvault_groups_validate BEFORE INSERT OR UPDATE OF parent_id ON public.groups
 FOR EACH ROW EXECUTE FUNCTION public.spawnvault_validate_group();

-- Os itens só podem pertencer a subgrupos.
CREATE OR REPLACE FUNCTION public.spawnvault_validate_item_group() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.groups g WHERE g.id=NEW.group_id AND g.parent_id IS NOT NULL)
 THEN RAISE EXCEPTION 'Seleciona um subgrupo válido'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS spawnvault_items_group_validate ON public.items;
CREATE TRIGGER spawnvault_items_group_validate BEFORE INSERT OR UPDATE OF group_id ON public.items
 FOR EACH ROW EXECUTE FUNCTION public.spawnvault_validate_item_group();

-- Reciclagem: eliminar passa a ser uma atualização de deleted_at.
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS items_deleted_at_idx ON public.items(deleted_at);
DROP POLICY IF EXISTS "SpawnVault read items" ON public.items;
CREATE POLICY "SpawnVault read items" ON public.items FOR SELECT TO authenticated
 USING (deleted_at IS NULL OR public.is_spawnvault_admin());

-- Prevenir nomes de spawn duplicados, inclusive em pedidos simultâneos.
-- Itens já duplicados podem continuar a existir; novas duplicações ficam bloqueadas.
CREATE OR REPLACE FUNCTION public.spawnvault_prevent_duplicate_spawn() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.deleted_at IS NULL AND EXISTS(
   SELECT 1 FROM public.items i WHERE i.id<>NEW.id AND i.deleted_at IS NULL
   AND lower(btrim(i.spawn_name))=lower(btrim(NEW.spawn_name))
 ) THEN RAISE EXCEPTION 'Já existe um item ativo com este spawn'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS spawnvault_items_unique_spawn ON public.items;
CREATE TRIGGER spawnvault_items_unique_spawn BEFORE INSERT OR UPDATE OF spawn_name,deleted_at ON public.items
 FOR EACH ROW EXECUTE FUNCTION public.spawnvault_prevent_duplicate_spawn();

-- Favoritos privados por utilizador.
CREATE TABLE IF NOT EXISTS public.item_favorites (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,item_id)
);
ALTER TABLE public.item_favorites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SpawnVault favorites own" ON public.item_favorites;
CREATE POLICY "SpawnVault favorites own" ON public.item_favorites FOR ALL TO authenticated
 USING(user_id=(SELECT auth.uid())) WITH CHECK(user_id=(SELECT auth.uid()));
GRANT SELECT,INSERT,DELETE ON public.item_favorites TO authenticated;

-- Sugestões: cada utilizador vê os seus pedidos; administradores veem todos.
CREATE TABLE IF NOT EXISTS public.item_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 spawn_name text NOT NULL CHECK(length(btrim(spawn_name)) BETWEEN 1 AND 120),
 reason text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.item_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "SpawnVault requests read" ON public.item_requests;
DROP POLICY IF EXISTS "SpawnVault requests create" ON public.item_requests;
DROP POLICY IF EXISTS "SpawnVault requests review" ON public.item_requests;
CREATE POLICY "SpawnVault requests read" ON public.item_requests FOR SELECT TO authenticated
 USING(requested_by=(SELECT auth.uid()) OR public.is_spawnvault_admin());
CREATE POLICY "SpawnVault requests create" ON public.item_requests FOR INSERT TO authenticated
 WITH CHECK(requested_by=(SELECT auth.uid()) AND status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL);
CREATE POLICY "SpawnVault requests review" ON public.item_requests FOR UPDATE TO authenticated
 USING(public.is_spawnvault_admin()) WITH CHECK(public.is_spawnvault_admin());
GRANT SELECT,INSERT,UPDATE ON public.item_requests TO authenticated;

-- Histórico existente da v2.1 mantém o registo das alterações a itens.
-- Acrescentar registo de grupos e pedidos sem alterar os dados anteriores.
CREATE OR REPLACE FUNCTION public.spawnvault_audit_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE label text; entity_id uuid;
BEGIN
 IF TG_OP='DELETE' THEN label=OLD.name;entity_id=OLD.id;
 ELSE label=NEW.name;entity_id=NEW.id; END IF;
 INSERT INTO public.item_audit(actor_id,actor_email,action,item_id,item_name)
 VALUES(auth.uid(),(SELECT email FROM auth.users WHERE id=auth.uid()),TG_TABLE_NAME||':'||TG_OP,entity_id,label);
 RETURN COALESCE(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS spawnvault_groups_audit ON public.groups;
CREATE TRIGGER spawnvault_groups_audit AFTER INSERT OR UPDATE OR DELETE ON public.groups
 FOR EACH ROW EXECUTE FUNCTION public.spawnvault_audit_change();
DROP TRIGGER IF EXISTS spawnvault_requests_audit ON public.item_requests;
CREATE TRIGGER spawnvault_requests_audit AFTER INSERT OR UPDATE OR DELETE ON public.item_requests
 FOR EACH ROW EXECUTE FUNCTION public.spawnvault_audit_change();

COMMIT;

-- Publicação Realtime (requer privilégios do proprietário):
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='items') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.items;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='groups') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.groups;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='item_requests') THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.item_requests;
 END IF;
END $$;
