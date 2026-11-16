-- Update: pay now vs. pay at pickup (portal + POS), prepaid accounting via Customer Deposits.
-- Safe to run on the existing database (no reset needed). Paste into Supabase SQL Editor -> Run.

-- =====================================================================
-- Pay now vs. pay at pickup  (safe to re-run)
--  * Customers can prepay online: Dr Cash / Cr Customer Deposits (a
--    liability - the money isn't revenue until the goods are picked up).
--  * At pickup, a prepaid order is fulfilled against Customer Deposits and
--    closed automatically (revenue, COGS and inventory post as usual).
--  * Cancelling a prepaid order refunds it.
--  * The POS can reserve a cart as a "pay at pickup" order.
-- =====================================================================

alter table public.sales_orders add column if not exists prepaid_amount numeric(12,2) not null default 0;

-- ---------- fulfil: prepaid orders draw down Customer Deposits ----------
create or replace function public.fulfill_sales_order(p_id int, p_payment_method text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o record; l record; v_cost numeric; v_cogs numeric := 0; v_prepaid numeric;
begin
  perform public.require_staff();
  select * into o from public.sales_orders where id = p_id for update;
  if o.id is null then raise exception 'Order not found'; end if;
  if o.status <> 'Placed' then raise exception 'Order % is %, only Placed orders can be fulfilled', o.number, o.status; end if;

  for l in select * from public.sales_order_lines where order_id = p_id order by id loop
    v_cost := public.post_inv(l.item_id, o.location_id, -l.qty, 'sale', null, null, 'sales_order', p_id, o.number);
    update public.sales_order_lines set unit_cost = v_cost where id = l.id;
    v_cogs := v_cogs + round(l.qty * v_cost, 2);
  end loop;

  v_prepaid := least(coalesce(o.prepaid_amount, 0), o.total);
  if o.source in ('POS','EXCHANGE') then
    perform public.gl_post('Cash', o.total, 0, 'Sale ' || o.number, 'sales_order', p_id);
  else
    perform public.gl_post('Customer Deposits', v_prepaid, 0, 'Sale ' || o.number || ' (prepaid)', 'sales_order', p_id);
    perform public.gl_post('Accounts Receivable', o.total - v_prepaid, 0, 'Sale ' || o.number, 'sales_order', p_id);
  end if;
  perform public.gl_post('Sales Discounts', o.discount, 0, 'Sale ' || o.number, 'sales_order', p_id);
  perform public.gl_post('Sales Revenue', 0, o.subtotal, 'Sale ' || o.number, 'sales_order', p_id);
  perform public.gl_post('Sales Tax Payable', 0, o.tax, 'Sale ' || o.number, 'sales_order', p_id);
  perform public.gl_post('Cost of Goods Sold', v_cogs, 0, 'Sale ' || o.number, 'sales_order', p_id);
  perform public.gl_post('Inventory', 0, v_cogs, 'Sale ' || o.number, 'sales_order', p_id);

  update public.sales_orders set status = 'Fulfilled', fulfilled_at = public.app_now(), cogs = v_cogs,
         payment_method = coalesce(p_payment_method, payment_method)
   where id = p_id;
  if o.source in ('SO','WEB') then
    perform public.log_activity('sales', format('Order %s fulfilled ($%s)', o.number, o.total), 'sales_order', p_id);
  end if;
  -- already paid in full online -> nothing left to collect
  if o.source in ('SO','WEB') and v_prepaid >= o.total and o.total > 0 then
    update public.sales_orders set status = 'Closed', closed_at = public.app_now() where id = p_id;
  end if;
end $$;

-- ---------- close: collect only what is still owed ----------------------
create or replace function public.close_sales_order(p_id int, p_payment_method text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o record; v_refunded numeric; v_due numeric;
begin
  perform public.require_staff();
  select * into o from public.sales_orders where id = p_id for update;
  if o.status <> 'Fulfilled' then raise exception 'Only Fulfilled orders can be closed (order is %)', o.status; end if;
  if o.source in ('SO','WEB') then
    select coalesce(sum(r.refund_amount),0) into v_refunded from public.returns r where r.sales_order_id = p_id;
    v_due := o.total - v_refunded - least(coalesce(o.prepaid_amount, 0), o.total);
    perform public.gl_post('Cash', v_due, 0, 'Payment ' || o.number, 'sales_order', p_id);
    perform public.gl_post('Accounts Receivable', 0, v_due, 'Payment ' || o.number, 'sales_order', p_id);
  end if;
  update public.sales_orders set status = 'Closed', closed_at = public.app_now(),
         payment_method = coalesce(p_payment_method, nullif(payment_method, 'Pay at pickup'), 'Card') where id = p_id;
  if o.source in ('SO','WEB') then
    perform public.log_activity('sales', format('Order %s closed — payment received', o.number), 'sales_order', p_id);
  end if;
end $$;

-- ---------- cancel: refund a prepayment ----------------------------------
create or replace function public.cancel_sales_order(p_id int, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select * into o from public.sales_orders where id = p_id for update;
  if not public.is_staff() and (o.customer_id is distinct from public.my_customer_id()) then
    raise exception 'Not allowed';
  end if;
  if o.status <> 'Placed' then raise exception 'Only Placed orders can be cancelled (use Returns for fulfilled orders)'; end if;
  if coalesce(o.prepaid_amount, 0) > 0 then
    perform public.gl_post('Customer Deposits', o.prepaid_amount, 0, 'Refund prepayment ' || o.number, 'sales_order', p_id);
    perform public.gl_post('Cash', 0, o.prepaid_amount, 'Refund prepayment ' || o.number, 'sales_order', p_id);
  end if;
  update public.sales_orders set status = 'Cancelled', cancelled_at = public.app_now(),
         notes = concat_ws(' | ', notes, 'Cancelled: ' || p_reason,
                           case when coalesce(o.prepaid_amount, 0) > 0 then 'Prepayment refunded $' || o.prepaid_amount end)
   where id = p_id;
  perform public.log_activity('sales', format('Order %s cancelled%s', o.number,
    case when coalesce(o.prepaid_amount, 0) > 0 then ' — prepayment refunded' else '' end), 'sales_order', p_id);
end $$;

-- ---------- customer portal: choose pay now or pay at pickup -------------
drop function if exists public.place_customer_order(int, jsonb, date, text);
create or replace function public.place_customer_order(p_location int, p_lines jsonb, p_pickup date default null,
  p_notes text default null, p_pay_now boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare v_cust int; v_id int; v_total numeric; v_num text;
begin
  v_cust := public.my_customer_id();
  if v_cust is null then
    if public.is_staff() then raise exception 'Use Sales Orders to enter orders for customers'; end if;
    raise exception 'Your login is not linked to a customer account';
  end if;
  if not exists (select 1 from public.locations where id = p_location and pickup) then
    raise exception 'That location is not a pickup location';
  end if;
  v_id := public.create_sales_order(v_cust, p_location, p_lines, 'WEB', 0,
            greatest(coalesce(p_pickup, public.app_today() + 1), public.app_today()), p_notes);
  select total, number into v_total, v_num from public.sales_orders where id = v_id;
  if p_pay_now then
    -- demo: no real card processing; records the prepayment
    perform public.gl_post('Cash', v_total, 0, 'Online prepayment ' || v_num, 'sales_order', v_id);
    perform public.gl_post('Customer Deposits', 0, v_total, 'Online prepayment ' || v_num, 'sales_order', v_id);
    update public.sales_orders set prepaid_amount = v_total, payment_method = 'Card (paid online)' where id = v_id;
    perform public.log_activity('sales', format('%s paid online ($%s) — pickup order', v_num, v_total), 'sales_order', v_id);
  else
    update public.sales_orders set payment_method = 'Pay at pickup' where id = v_id;
  end if;
  return v_id;
end $$;
revoke execute on function public.place_customer_order(int, jsonb, date, text, boolean) from public, anon;
grant execute on function public.place_customer_order(int, jsonb, date, text, boolean) to authenticated;

-- ---------- POS: reserve the cart for pickup, pay when collected ---------
create or replace function public.pos_reserve_for_pickup(p_customer int, p_location int, p_lines jsonb,
  p_discount_pct numeric default 0, p_pickup date default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_id int; v_num text;
begin
  perform public.require_staff();
  if p_customer is null then raise exception 'Choose the customer who will pick up and pay'; end if;
  v_id := public.create_sales_order(p_customer, p_location, p_lines, 'SO', p_discount_pct,
            greatest(coalesce(p_pickup, public.app_today() + 1), public.app_today()), 'Reserved at the store — pay at pickup');
  update public.sales_orders set payment_method = 'Pay at pickup' where id = v_id returning number into v_num;
  perform public.log_activity('sales', format('%s reserved for pickup — customer pays when collecting', v_num), 'sales_order', v_id);
  return v_id;
end $$;
revoke execute on function public.pos_reserve_for_pickup(int, int, jsonb, numeric, date) from public, anon;
grant execute on function public.pos_reserve_for_pickup(int, int, jsonb, numeric, date) to authenticated;

-- customers' "My orders" shows how each order is paid
notify pgrst, 'reload schema';
