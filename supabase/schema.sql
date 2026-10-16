-- Executar no SQL Editor do projeto Supabase.
create extension if not exists pgcrypto;

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  spawn_name text not null check (length(trim(spawn_name)) between 1 and 120),
  category text not null default '',
  description text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists items_name_idx on public.items (lower(name));
create index if not exists items_spawn_idx on public.items (lower(spawn_name));
create index if not exists items_category_idx on public.items (category);

alter table public.items enable row level security;

-- Utilizadores autenticados podem consultar o catálogo partilhado.
create policy "Authenticated users can read items"
on public.items for select to authenticated using (true);

-- Utilizadores autenticados podem criar itens.
create policy "Authenticated users can add items"
on public.items for insert to authenticated with check (auth.uid() = created_by);

-- Nesta versão, qualquer utilizador autenticado pode editar ou apagar itens.
-- Restringe estas políticas se quiseres separar administradores e editores.
create policy "Authenticated users can update items"
on public.items for update to authenticated using (true) with check (true);

create policy "Authenticated users can delete items"
on public.items for delete to authenticated using (true);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists items_updated_at on public.items;
create trigger items_updated_at before update on public.items
for each row execute function public.set_updated_at();
