-- Update: demand forecasting + product photos + catalog with pictures.
-- Safe to run on the existing database (no reset needed). Paste into Supabase SQL Editor → Run.

-- =====================================================================
-- Forecasting data, product photos, product groups (safe to re-run)
-- =====================================================================

-- ---------- product photos -------------------------------------------
alter table public.items add column if not exists image_url text;

-- public bucket for product photos; only employees can upload/replace/delete
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif','image/heic'])
on conflict (id) do update set public = true;

drop policy if exists "product images staff insert" on storage.objects;
drop policy if exists "product images staff update" on storage.objects;
drop policy if exists "product images staff delete" on storage.objects;
drop policy if exists "product images read" on storage.objects;
create policy "product images read" on storage.objects for select to public using (bucket_id = 'product-images');
create policy "product images staff insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and public.is_staff());
create policy "product images staff update" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and public.is_staff()) with check (bucket_id = 'product-images' and public.is_staff());
create policy "product images staff delete" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and public.is_staff());

-- ---------- weekly usage history (input to forecasting) ----------------
-- Week 1 = oldest. Each week ends the day before today (last complete days).
-- Usage = units sold + units consumed by production − units returned.
create or replace function public.weekly_usage(p_weeks int default 26) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.app_today(); v_from date; r jsonb;
begin
  perform public.require_staff();
  p_weeks := greatest(8, least(coalesce(p_weeks, 26), 52));
  v_from := v_today - 7 * p_weeks;
  with wk as (select generate_series(0, p_weeks - 1) as k),
  u as (
    select t.item_id, ((t.ts at time zone 'America/Denver')::date - v_from) / 7 as k,
           sum(-t.qty) filter (where t.txn_type in ('sale','return')) as sold,
           sum(-t.qty) as used
      from public.inv_txns t
     where t.txn_type in ('sale','production_issue','return')
       and t.ts >= public.day_start(v_from) and t.ts < public.day_start(v_today)
     group by 1, 2),
  grid as (
    select i.id as item_id, wk.k, coalesce(u.sold, 0) as sold, coalesce(u.used, 0) as used
      from public.items i cross join wk left join u on u.item_id = i.id and u.k = wk.k
     where i.active)
  select jsonb_build_object(
    'today', v_today,
    'weeks', (select jsonb_agg(v_from + 7 * k order by k) from wk),
    'items', (select jsonb_agg(jsonb_build_object(
                'item_id', g.item_id,
                'sold', (select jsonb_agg(round(g2.sold, 2) order by g2.k) from grid g2 where g2.item_id = g.item_id),
                'used', (select jsonb_agg(round(g2.used, 2) order by g2.k) from grid g2 where g2.item_id = g.item_id)))
              from (select distinct item_id from grid) g))
  into r;
  return r;
end $$;
revoke execute on function public.weekly_usage(int) from public, anon;
grant execute on function public.weekly_usage(int) to authenticated;

-- ---------- customer catalogue now includes the photo ---------------------
create or replace function public.customer_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'sku', i.sku, 'name', i.name, 'description', i.description, 'category', i.category,
    'item_type', i.item_type, 'price', i.price, 'uom', i.uom, 'image_url', i.image_url,
    'stock', (select coalesce(jsonb_agg(jsonb_build_object('location_id', l.id, 'location', l.name, 'code', l.code,
                                     'qty', greatest(0, coalesce(inv.qty,0))) order by l.id), '[]')
                from public.locations l left join public.inventory inv on inv.location_id = l.id and inv.item_id = i.id
               where l.pickup),
    'available', greatest(0, st.on_hand - coalesce((select sum(sl.qty) from public.sales_order_lines sl
                 join public.sales_orders so on so.id = sl.order_id where so.status = 'Placed' and sl.item_id = i.id), 0)),
    'ready_by', public.est_available_date(i.id, 1)
  ) order by i.category, i.name), '[]')
  from public.items i join public.v_item_stock st on st.item_id = i.id
  where i.active and i.sellable
$$;
revoke execute on function public.customer_catalog() from public, anon;
grant execute on function public.customer_catalog() to authenticated;

-- make PostgREST pick up the new column/function immediately
notify pgrst, 'reload schema';
