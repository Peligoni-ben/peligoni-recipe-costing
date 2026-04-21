create table if not exists public.ingredient_naming_rules (
  id text primary key,
  rule_field text not null,
  rule_label text not null,
  trigger_text text not null,
  rule_value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ingredient_naming_rules_trigger_unique
  on public.ingredient_naming_rules (rule_field, trigger_text);

alter table public.ingredient_naming_rules enable row level security;

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
