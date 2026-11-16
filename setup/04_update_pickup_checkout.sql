-- Update: pickup checkout (discounts + Card/Cash when the customer collects).
-- Safe to run on the existing database (no reset needed). Run AFTER 03_update_payments_pickup.sql.

-- =====================================================================
-- Pickup checkout: when a customer collects a "pay at pickup" order, the
-- cashier can apply per-item / order discounts, take Card or Cash, and the
-- order is fulfilled (inventory, revenue, COGS) and paid in one step.
-- Prepaid orders are simply handed over (their price can't change).
-- Safe to re-run.
-- =====================================================================
create or replace function public.checkout_pickup(p_id int, p_lines jsonb default '[]'::jsonb,
  p_discount_pct numeric default null, p_payment_method text default 'Card')
returns int language plpgsql security definer set search_path = public as $$
declare o record; r record;
begin
  perform public.require_staff();
  select * into o from public.sales_orders where id = p_id for update;
  if o.id is null then raise exception 'Order not found'; end if;
  if o.status <> 'Placed' then raise exception 'Order % is already %', o.number, o.status; end if;
  if o.source not in ('SO','WEB') then raise exception 'Only customer orders can be checked out at pickup'; end if;
  if coalesce(p_payment_method, '') not in ('Card', 'Cash', 'Prepaid') then raise exception 'Choose Card or Cash'; end if;

  if coalesce(o.prepaid_amount, 0) = 0 then
    -- price adjustments at the counter (only before payment)
    for r in select * from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb)) as x(line_id int, discount_pct numeric) loop
      update public.sales_order_lines
         set discount_pct = least(greatest(coalesce(r.discount_pct, 0), 0), 100)
       where id = r.line_id and order_id = p_id;
    end loop;
    if p_discount_pct is not null then
      update public.sales_orders set discount_pct = least(greatest(p_discount_pct, 0), 100) where id = p_id;
    end if;
    perform public.recalc_sales_order(p_id);
  end if;

  perform public.fulfill_sales_order(p_id, case when coalesce(o.prepaid_amount, 0) > 0 then null else p_payment_method end);
  -- prepaid orders close automatically inside fulfil; others collect payment now
  if (select status from public.sales_orders where id = p_id) = 'Fulfilled' then
    perform public.close_sales_order(p_id, p_payment_method);
  end if;
  perform public.log_activity('sales', format('%s picked up%s', o.number,
    case when coalesce(o.prepaid_amount, 0) > 0 then ' (paid online)' else ' — paid by ' || lower(p_payment_method) end), 'sales_order', p_id);
  return p_id;
end $$;
revoke execute on function public.checkout_pickup(int, jsonb, numeric, text) from public, anon;
grant execute on function public.checkout_pickup(int, jsonb, numeric, text) to authenticated;
notify pgrst, 'reload schema';
