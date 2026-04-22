create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  ingredient_name text not null,
  ingredient_item_code text,
  internal_code text,
  unit_cost numeric(12,4) not null default 0,
  purchase_vat_rate numeric(12,4) not null default 0.13,
  pack_size text,
  supplier text,
  category text,
  last_updated date,
  entry_type text not null default 'ingredient',
  linked_recipe_id text,
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.ingredients
  add column if not exists purchase_vat_rate numeric(12,4) not null default 0.13;

create unique index if not exists ingredients_code_unique
  on public.ingredients ((upper(regexp_replace(coalesce(ingredient_item_code, ''), '\s+', '', 'g'))))
  where coalesce(ingredient_item_code, '') <> '';

create unique index if not exists ingredients_internal_code_unique
  on public.ingredients ((upper(regexp_replace(coalesce(internal_code, ''), '\s+', '', 'g'))))
  where coalesce(internal_code, '') <> '';

create table if not exists public.recipes (
  id text primary key,
  restaurant text,
  available_venues jsonb not null default '[]'::jsonb,
  service_suitability jsonb not null default '[]'::jsonb,
  name text not null,
  category text,
  selling_item_code text,
  current_sale_price numeric(12,4) not null default 0,
  roundup numeric(12,4) not null default 0,
  recipe_type text not null default 'dish',
  batch_yield numeric(12,4),
  batch_yield_type text,
  portion_count numeric(12,4),
  method jsonb not null default '[]'::jsonb,
  presentation_notes text,
  recipe_complete boolean not null default false,
  pricing_complete boolean not null default false,
  is_live boolean not null default false,
  is_locked boolean not null default false,
  workflow_stage text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.recipes
  add column if not exists available_venues jsonb not null default '[]'::jsonb,
  add column if not exists service_suitability jsonb not null default '[]'::jsonb;

create index if not exists recipes_restaurant_idx on public.recipes (restaurant);
create index if not exists recipes_type_idx on public.recipes (recipe_type);

create table if not exists public.recipe_components (
  id uuid primary key default gen_random_uuid(),
  recipe_id text not null references public.recipes(id) on delete cascade,
  component_order integer not null default 0,
  ingredient_name text,
  ingredient_item_code text,
  qty numeric(12,4) not null default 0,
  cost numeric(12,4) not null default 0,
  source_type text,
  source_recipe_id text,
  source_unit_cost numeric(12,4),
  source_yield_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recipe_components_recipe_idx on public.recipe_components (recipe_id);

create table if not exists public.menus (
  id text primary key,
  name text not null,
  venue text,
  guest_count integer not null default 0,
  target_gp numeric(12,4) not null default 0,
  is_live boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.menu_lines (
  id uuid primary key default gen_random_uuid(),
  menu_id text not null references public.menus(id) on delete cascade,
  recipe_id text references public.recipes(id) on delete set null,
  line_order integer not null default 0,
  course_label text,
  dish_name text,
  description text,
  restaurant text,
  line_cost numeric(12,4) not null default 0,
  line_sale_price numeric(12,4) not null default 0,
  category text,
  created_at timestamptz not null default now()
);

alter table if exists public.menu_lines
  add column if not exists course_label text,
  add column if not exists dish_name text,
  add column if not exists description text,
  add column if not exists restaurant text,
  add column if not exists line_cost numeric(12,4) not null default 0,
  add column if not exists line_sale_price numeric(12,4) not null default 0,
  add column if not exists category text;

create index if not exists menu_lines_menu_idx on public.menu_lines (menu_id);

create table if not exists public.dish_index (
  id text primary key,
  source_tab text,
  venue text,
  course text,
  dish_name text not null,
  old_flag text,
  linked_recipe_id text references public.recipes(id) on delete set null,
  review_state text,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bch_audit (
  id text primary key,
  code text not null,
  component_name text,
  classification text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.edit_sessions (
  id text primary key,
  entity_type text not null,
  entity_id text not null,
  user_id uuid not null,
  user_email text,
  user_name text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists edit_sessions_entity_idx on public.edit_sessions (entity_type, entity_id);

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
