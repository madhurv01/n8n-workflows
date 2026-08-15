-- SmartInventoryAgent — inventory table
-- Run this in the Supabase SQL editor before importing the workflow.

create table if not exists public.inventory_items (
  id                       bigint generated always as identity primary key,
  sku                      text not null,
  item_name                text not null,
  location_name            text not null,          -- must match Agent Config -> location_name in the workflow
  stock_quantity           numeric not null default 0,
  reorder_threshold        numeric not null default 0,
  recommended_reorder_qty  numeric not null default 0,
  expedite_shipping        boolean not null default false,
  priority_level           text not null default 'NORMAL', -- NORMAL | LOW_STOCK_ONLY | LOW | MODERATE | HIGH | SEVERE
  weather_risk_level       text,
  weather_risk_reasons     text,
  last_weather_check       timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists inventory_items_location_idx on public.inventory_items (location_name);
create unique index if not exists inventory_items_sku_location_idx on public.inventory_items (sku, location_name);

-- keep updated_at fresh on every change
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists inventory_items_set_updated_at on public.inventory_items;
create trigger inventory_items_set_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

-- sample seed rows for the default "Mumbai Warehouse" location used in Agent Config
insert into public.inventory_items (sku, item_name, location_name, stock_quantity, reorder_threshold)
values
  ('SKU-1001', 'Umbrellas', 'Mumbai Warehouse', 40, 50),
  ('SKU-1002', 'Rain Ponchos', 'Mumbai Warehouse', 20, 30),
  ('SKU-1003', 'Bottled Water (24pk)', 'Mumbai Warehouse', 200, 100),
  ('SKU-1004', 'Portable Generators', 'Mumbai Warehouse', 5, 10)
on conflict (sku, location_name) do nothing;

-- Enable RLS and allow the service-role key (used by n8n) full access.
alter table public.inventory_items enable row level security;

create policy if not exists "service role full access"
  on public.inventory_items
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
