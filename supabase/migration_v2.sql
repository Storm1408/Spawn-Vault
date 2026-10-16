-- SpawnVault v2: executar UMA VEZ no SQL Editor do Supabase (como proprietário).
-- Mantém os itens existentes. Faz uma cópia de segurança antes de executar.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user'))
);

CREATE OR REPLACE FUNCTION public.is_spawnvault_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = (SELECT auth.uid()) AND role = 'admin');
$$;
REVOKE ALL ON FUNCTION public.is_spawnvault_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_spawnvault_admin() TO authenticated;

CREATE TABLE IF NOT EXISTS public.groups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
 created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS groups_name_casefold_idx ON public.groups (lower(btrim(name)));
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS group_id uuid;

-- Migrar as categorias existentes para grupos sem perder os itens.
INSERT INTO public.groups(name)
SELECT DISTINCT btrim(coalesce(nullif(category,''),'Sem grupo'))
FROM public.items
ON CONFLICT DO NOTHING;
UPDATE public.items AS i SET group_id=g.id
FROM public.groups AS g
WHERE i.group_id IS NULL
  AND lower(btrim(g.name))=lower(btrim(coalesce(nullif(i.category,''),'Sem grupo')));

-- Evitar grupos em falta se ainda não houver itens.
ALTER TABLE public.items DROP CONSTRAINT IF EXISTS items_group_id_fkey;
ALTER TABLE public.items ADD CONSTRAINT items_group_id_fkey
 FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE RESTRICT;
ALTER TABLE public.items ALTER COLUMN group_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS items_group_id_idx ON public.items(group_id);

-- Os utilizadores não podem atribuir a si próprios o papel de administrador.
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read items" ON public.items;
DROP POLICY IF EXISTS "Authenticated users can add items" ON public.items;
DROP POLICY IF EXISTS "Authenticated users can update items" ON public.items;
DROP POLICY IF EXISTS "Authenticated users can delete items" ON public.items;
DROP POLICY IF EXISTS "SpawnVault read items" ON public.items;
DROP POLICY IF EXISTS "SpawnVault add items" ON public.items;
DROP POLICY IF EXISTS "SpawnVault update items" ON public.items;
DROP POLICY IF EXISTS "SpawnVault delete items" ON public.items;
CREATE POLICY "SpawnVault read items" ON public.items FOR SELECT TO authenticated USING (true);
CREATE POLICY "SpawnVault add items" ON public.items FOR INSERT TO authenticated
 WITH CHECK (public.is_spawnvault_admin() AND created_by=(SELECT auth.uid()));
CREATE POLICY "SpawnVault update items" ON public.items FOR UPDATE TO authenticated
 USING (public.is_spawnvault_admin()) WITH CHECK (public.is_spawnvault_admin());
CREATE POLICY "SpawnVault delete items" ON public.items FOR DELETE TO authenticated
 USING (public.is_spawnvault_admin());

DROP POLICY IF EXISTS "SpawnVault read groups" ON public.groups;
DROP POLICY IF EXISTS "SpawnVault add groups" ON public.groups;
DROP POLICY IF EXISTS "SpawnVault update groups" ON public.groups;
DROP POLICY IF EXISTS "SpawnVault delete groups" ON public.groups;
CREATE POLICY "SpawnVault read groups" ON public.groups FOR SELECT TO authenticated USING (true);
CREATE POLICY "SpawnVault add groups" ON public.groups FOR INSERT TO authenticated
 WITH CHECK (public.is_spawnvault_admin() AND created_by=(SELECT auth.uid()));
CREATE POLICY "SpawnVault update groups" ON public.groups FOR UPDATE TO authenticated
 USING (public.is_spawnvault_admin()) WITH CHECK (public.is_spawnvault_admin());
CREATE POLICY "SpawnVault delete groups" ON public.groups FOR DELETE TO authenticated
 USING (public.is_spawnvault_admin());

DROP POLICY IF EXISTS "SpawnVault own role" ON public.user_roles;
CREATE POLICY "SpawnVault own role" ON public.user_roles FOR SELECT TO authenticated
 USING (user_id=(SELECT auth.uid()));
REVOKE ALL ON public.user_roles FROM anon, authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.items TO authenticated;
COMMIT;

-- DEPOIS de executar este ficheiro, promover manualmente o administrador:
-- 1. Authentication > Users > copiar o UUID da tua conta.
-- 2. Substituir UUID_DO_ADMINISTRADOR e executar a instrução seguinte SEM os '--':
-- INSERT INTO public.user_roles(user_id,role) VALUES ('UUID_DO_ADMINISTRADOR','admin')
-- ON CONFLICT (user_id) DO UPDATE SET role=EXCLUDED.role;
-- Os restantes utilizadores não precisam de registo: por omissão são 'user'.
