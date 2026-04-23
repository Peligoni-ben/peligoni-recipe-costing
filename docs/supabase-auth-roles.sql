create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'viewer' check (role in ('manager', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'viewer')
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_profile();

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()),
    'viewer'
  );
$$;

grant select on public.profiles to authenticated;

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.current_app_role() = 'manager');

drop policy if exists "profiles_update_manager" on public.profiles;
create policy "profiles_update_manager"
on public.profiles
for update
to authenticated
using (public.current_app_role() = 'manager')
with check (public.current_app_role() = 'manager');

alter table public.venues enable row level security;
alter table public.ingredients enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_components enable row level security;
alter table public.menus enable row level security;
alter table public.menu_lines enable row level security;
alter table public.dish_index enable row level security;
alter table public.bch_audit enable row level security;
alter table public.ingredient_naming_rules enable row level security;

drop policy if exists "venues_read_authenticated" on public.venues;
create policy "venues_read_authenticated"
on public.venues
for select
to authenticated
using (true);

drop policy if exists "venues_write_editor_manager" on public.venues;
create policy "venues_write_editor_manager"
on public.venues
for all
to authenticated
using (public.current_app_role() in ('manager', 'editor'))
with check (public.current_app_role() in ('manager', 'editor'));

drop policy if exists "ingredients_read_authenticated" on public.ingredients;
create policy "ingredients_read_authenticated"
on public.ingredients
for select
to authenticated
using (true);

drop policy if exists "ingredients_write_editor_manager" on public.ingredients;
create policy "ingredients_write_editor_manager"
on public.ingredients
for all
to authenticated
using (public.current_app_role() in ('manager', 'editor'))
with check (public.current_app_role() in ('manager', 'editor'));

drop policy if exists "recipes_read_authenticated" on public.recipes;
create policy "recipes_read_authenticated"
on public.recipes
for select
to authenticated
using (true);

drop policy if exists "recipes_write_editor_manager" on public.recipes;
create policy "recipes_write_editor_manager"
on public.recipes
for all
to authenticated
using (public.current_app_role() in ('manager', 'editor'))
with check (public.current_app_role() in ('manager', 'editor'));

drop policy if exists "recipe_components_read_authenticated" on public.recipe_components;
create policy "recipe_components_read_authenticated"
on public.recipe_components
for select
to authenticated
using (true);

drop policy if exists "recipe_components_write_editor_manager" on public.recipe_components;
create policy "recipe_components_write_editor_manager"
on public.recipe_components
for all
to authenticated
using (public.current_app_role() in ('manager', 'editor'))
with check (public.current_app_role() in ('manager', 'editor'));

grant execute on function public.save_recipe_bundle(jsonb, jsonb, timestamptz) to authenticated;

drop policy if exists "menus_read_authenticated" on public.menus;
create policy "menus_read_authenticated"
on public.menus
for select
to authenticated
using (true);

drop policy if exists "menus_write_editor_manager" on public.menus;
create policy "menus_write_editor_manager"
on public.menus
for all
to authenticated
using (public.current_app_role() in ('manager', 'editor'))
with check (public.current_app_role() in ('manager', 'editor'));

drop policy if exists "menu_lines_read_authenticated" on public.menu_lines;
create policy "menu_lines_read_authenticated"
on public.menu_lines
for select
to authenticated
using (true);

drop policy if exists "menu_lines_write_editor_manager" on public.menu_lines;
create policy "menu_lines_write_editor_manager"
on public.menu_lines
for all
to authenticated
using (public.current_app_role() in ('manager', 'editor'))
with check (public.current_app_role() in ('manager', 'editor'));

drop policy if exists "dish_index_read_authenticated" on public.dish_index;
create policy "dish_index_read_authenticated"
on public.dish_index
for select
to authenticated
using (true);

drop policy if exists "dish_index_write_editor_manager" on public.dish_index;
create policy "dish_index_write_editor_manager"
on public.dish_index
for all
to authenticated
using (public.current_app_role() in ('manager', 'editor'))
with check (public.current_app_role() in ('manager', 'editor'));

drop policy if exists "bch_audit_read_authenticated" on public.bch_audit;
create policy "bch_audit_read_authenticated"
on public.bch_audit
for select
to authenticated
using (true);

drop policy if exists "bch_audit_write_editor_manager" on public.bch_audit;
create policy "bch_audit_write_editor_manager"
on public.bch_audit
for all
to authenticated
using (public.current_app_role() in ('manager', 'editor'))
with check (public.current_app_role() in ('manager', 'editor'));

drop policy if exists "ingredient_naming_rules_read_authenticated" on public.ingredient_naming_rules;
create policy "ingredient_naming_rules_read_authenticated"
on public.ingredient_naming_rules
for select
to authenticated
using (true);

drop policy if exists "ingredient_naming_rules_write_editor_manager" on public.ingredient_naming_rules;
create policy "ingredient_naming_rules_write_editor_manager"
on public.ingredient_naming_rules
for all
to authenticated
using (public.current_app_role() in ('manager', 'editor'))
with check (public.current_app_role() in ('manager', 'editor'));

-- After running this file:
-- 1. Create users in Supabase Authentication > Users.
-- 2. Promote your first manager manually, for example:
--    update public.profiles set role = 'manager' where email = 'you@example.com';
