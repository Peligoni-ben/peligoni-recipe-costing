alter table if exists public.ingredients
  add column if not exists internal_code text;

create unique index if not exists ingredients_internal_code_unique
  on public.ingredients ((upper(regexp_replace(coalesce(internal_code, ''), '\s+', '', 'g'))))
  where coalesce(internal_code, '') <> '';
