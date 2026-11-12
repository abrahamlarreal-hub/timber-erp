-- =====================================================================
-- Row level security, grants and realtime.
--  * Employees (staff / manager) can read everything.
--  * Master data (items, BOMs, suppliers, customers, settings) can be edited
--    directly by employees; settings only by managers.
--  * Transactions can ONLY be written through the business functions above.
--  * Customers can browse items / stock / locations and see their own orders.
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array['settings','customers','profiles','locations','suppliers','items','bom_lines','reason_codes',
    'inventory','inv_txns','gl_entries','sales_orders','sales_order_lines','returns','return_lines','purchase_orders',
    'po_lines','po_receipts','supplier_payments','production_orders','production_issues','activity_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy staff_read on public.%I for select to authenticated using (public.is_staff())', t);
  end loop;
end $$;

-- editable master data (employees)
do $$
declare t text;
begin
  foreach t in array array['customers','suppliers','items','bom_lines','locations','reason_codes'] loop
    execute format('create policy staff_insert on public.%I for insert to authenticated with check (public.is_staff())', t);
    execute format('create policy staff_update on public.%I for update to authenticated using (public.is_staff()) with check (public.is_staff())', t);
  end loop;
end $$;
create policy staff_delete on public.bom_lines for delete to authenticated using (public.is_staff());
create policy manager_update on public.settings for update to authenticated
  using (public.my_role() = 'manager') with check (public.my_role() = 'manager');
create policy manager_update_profiles on public.profiles for update to authenticated
  using (public.my_role() = 'manager') with check (public.my_role() = 'manager');

-- customer-facing read access
create policy cust_items on public.items for select to authenticated using (active and sellable);
create policy cust_locations on public.locations for select to authenticated using (true);
create policy cust_inventory on public.inventory for select to authenticated using (true);
create policy cust_settings on public.settings for select to authenticated using (key in ('tax_rate','company_name'));
create policy own_profile on public.profiles for select to authenticated using (id = auth.uid());
create policy own_customer on public.customers for select to authenticated using (id = public.my_customer_id());
create policy own_orders on public.sales_orders for select to authenticated using (customer_id = public.my_customer_id());
create policy own_order_lines on public.sales_order_lines for select to authenticated
  using (exists (select 1 from public.sales_orders o where o.id = order_id and o.customer_id = public.my_customer_id()));
create policy cust_bom on public.bom_lines for select to authenticated using (true);

-- the anonymous role gets nothing
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from public;
grant execute on all functions in schema public to authenticated, service_role;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.customers, public.suppliers, public.items, public.bom_lines,
      public.locations, public.reason_codes, public.settings, public.profiles to authenticated;
grant usage on all sequences in schema public to authenticated;

-- customer catalogue with live availability and "ready by" date
create or replace function public.customer_catalog() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'sku', i.sku, 'name', i.name, 'description', i.description, 'category', i.category,
    'price', i.price, 'uom', i.uom,
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
grant execute on function public.customer_catalog() to authenticated;

-- realtime: every connected user's screen refreshes when these change
alter publication supabase_realtime add table
  public.inventory, public.sales_orders, public.purchase_orders, public.production_orders,
  public.items, public.suppliers, public.settings, public.activity_log, public.customers, public.bom_lines;
