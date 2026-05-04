create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  venue_type text,
  service_pattern text,
  primary_services jsonb not null default '[]'::jsonb,
  secondary_services jsonb not null default '[]'::jsonb,
  event_uses jsonb not null default '[]'::jsonb,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.venues
  add column if not exists venue_type text,
  add column if not exists service_pattern text,
  add column if not exists primary_services jsonb not null default '[]'::jsonb,
  add column if not exists secondary_services jsonb not null default '[]'::jsonb,
  add column if not exists event_uses jsonb not null default '[]'::jsonb,
  add column if not exists is_archived boolean not null default false;

create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  ingredient_name text not null,
  ingredient_item_code text,
  internal_code text,
  unit_cost numeric(12,4) not null default 0,
  cost_unit text,
  units_in_pack numeric(12,4) not null default 1,
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
  add column if not exists purchase_vat_rate numeric(12,4) not null default 0.13,
  add column if not exists cost_unit text,
  add column if not exists units_in_pack numeric(12,4) not null default 1;

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
  menu_description text,
  prep_notes text,
  plating_notes text,
  chef_notes text,
  finished_dish_image text,
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
  add column if not exists service_suitability jsonb not null default '[]'::jsonb,
  add column if not exists menu_description text,
  add column if not exists prep_notes text,
  add column if not exists plating_notes text,
  add column if not exists chef_notes text,
  add column if not exists finished_dish_image text;

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

create or replace function public.save_recipe_bundle(
  p_recipe jsonb,
  p_components jsonb default '[]'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns table(recipe_row jsonb, component_rows jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipe public.recipes%rowtype;
  v_component_rows jsonb := '[]'::jsonb;
begin
  if coalesce(trim(p_recipe->>'id'), '') = '' then
    raise exception 'Recipe id is required.';
  end if;

  if p_expected_updated_at is not null then
    if not exists (
      select 1
      from public.recipes
      where id = p_recipe->>'id'
        and updated_at = p_expected_updated_at
    ) then
      raise exception 'STALE_RECIPE_WRITE';
    end if;
  end if;

  insert into public.recipes (
    id,
    restaurant,
    available_venues,
    service_suitability,
    name,
    category,
    selling_item_code,
    menu_description,
    prep_notes,
    plating_notes,
    chef_notes,
    finished_dish_image,
    current_sale_price,
    roundup,
    recipe_type,
    batch_yield,
    batch_yield_type,
    portion_count,
    method,
    presentation_notes,
    recipe_complete,
    pricing_complete,
    is_live,
    is_locked,
    workflow_stage,
    updated_at
  )
  values (
    p_recipe->>'id',
    nullif(trim(p_recipe->>'restaurant'), ''),
    coalesce(p_recipe->'available_venues', '[]'::jsonb),
    coalesce(p_recipe->'service_suitability', '[]'::jsonb),
    coalesce(nullif(trim(p_recipe->>'name'), ''), 'Untitled recipe'),
    nullif(trim(p_recipe->>'category'), ''),
    nullif(trim(p_recipe->>'selling_item_code'), ''),
    nullif(trim(p_recipe->>'menu_description'), ''),
    nullif(trim(p_recipe->>'prep_notes'), ''),
    nullif(trim(p_recipe->>'plating_notes'), ''),
    nullif(trim(p_recipe->>'chef_notes'), ''),
    nullif(trim(p_recipe->>'finished_dish_image'), ''),
    coalesce(nullif(p_recipe->>'current_sale_price', '')::numeric, 0),
    coalesce(nullif(p_recipe->>'roundup', '')::numeric, 0),
    coalesce(nullif(trim(p_recipe->>'recipe_type'), ''), 'dish'),
    nullif(p_recipe->>'batch_yield', '')::numeric,
    nullif(trim(p_recipe->>'batch_yield_type'), ''),
    nullif(p_recipe->>'portion_count', '')::numeric,
    coalesce(p_recipe->'method', '[]'::jsonb),
    nullif(trim(p_recipe->>'presentation_notes'), ''),
    coalesce(nullif(p_recipe->>'recipe_complete', '')::boolean, false),
    coalesce(nullif(p_recipe->>'pricing_complete', '')::boolean, false),
    coalesce(nullif(p_recipe->>'is_live', '')::boolean, false),
    coalesce(nullif(p_recipe->>'is_locked', '')::boolean, false),
    coalesce(nullif(trim(p_recipe->>'workflow_stage'), ''), 'draft'),
    coalesce(nullif(p_recipe->>'updated_at', '')::timestamptz, now())
  )
  on conflict (id) do update
  set
    restaurant = excluded.restaurant,
    available_venues = excluded.available_venues,
    service_suitability = excluded.service_suitability,
    name = excluded.name,
    category = excluded.category,
    selling_item_code = excluded.selling_item_code,
    menu_description = excluded.menu_description,
    prep_notes = excluded.prep_notes,
    plating_notes = excluded.plating_notes,
    chef_notes = excluded.chef_notes,
    finished_dish_image = excluded.finished_dish_image,
    current_sale_price = excluded.current_sale_price,
    roundup = excluded.roundup,
    recipe_type = excluded.recipe_type,
    batch_yield = excluded.batch_yield,
    batch_yield_type = excluded.batch_yield_type,
    portion_count = excluded.portion_count,
    method = excluded.method,
    presentation_notes = excluded.presentation_notes,
    recipe_complete = excluded.recipe_complete,
    pricing_complete = excluded.pricing_complete,
    is_live = excluded.is_live,
    is_locked = excluded.is_locked,
    workflow_stage = excluded.workflow_stage,
    updated_at = excluded.updated_at
  returning * into v_recipe;

  delete from public.recipe_components
  where recipe_id = v_recipe.id;

  if jsonb_typeof(coalesce(p_components, '[]'::jsonb)) = 'array' then
    insert into public.recipe_components (
      recipe_id,
      component_order,
      ingredient_name,
      ingredient_item_code,
      qty,
      cost,
      source_type,
      source_recipe_id,
      source_unit_cost,
      source_yield_type
    )
    select
      v_recipe.id,
      coalesce(nullif(item->>'component_order', '')::integer, ord - 1),
      nullif(trim(item->>'ingredient_name'), ''),
      nullif(trim(item->>'ingredient_item_code'), ''),
      coalesce(nullif(item->>'qty', '')::numeric, 0),
      coalesce(nullif(item->>'cost', '')::numeric, 0),
      nullif(trim(item->>'source_type'), ''),
      nullif(trim(item->>'source_recipe_id'), ''),
      nullif(item->>'source_unit_cost', '')::numeric,
      nullif(trim(item->>'source_yield_type'), '')
    from jsonb_array_elements(coalesce(p_components, '[]'::jsonb)) with ordinality as payload(item, ord);
  end if;

  select coalesce(jsonb_agg(to_jsonb(rc) order by rc.component_order), '[]'::jsonb)
  into v_component_rows
  from public.recipe_components rc
  where rc.recipe_id = v_recipe.id;

  return query
  select to_jsonb(v_recipe), v_component_rows;
end;
$$;

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
