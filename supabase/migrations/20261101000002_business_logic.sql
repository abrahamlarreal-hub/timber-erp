-- =====================================================================
-- Business logic.  Every transaction runs inside ONE database function so
-- inventory, costing and the general ledger can never get out of sync.
-- =====================================================================

-- ---------- helpers -----------------------------------------------------
create or replace function public.setting_num(p_key text) returns numeric
language sql stable security definer set search_path = public as $$
  select value from public.settings where key = p_key
$$;

create or replace function public.current_user_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select coalesce(nullif(full_name,''), email) from public.profiles where id = auth.uid()),
    nullif(current_setting('app.sim_user', true), ''),
    'System')
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is not null then (select role from public.profiles where id = auth.uid())
    when coalesce(auth.role(), 'none') in ('service_role','none') then 'manager'  -- direct DB / service key
    else null end
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('staff','manager'), false)
$$;

create or replace function public.my_customer_id() returns int
language sql stable security definer set search_path = public as $$
  select customer_id from public.profiles where id = auth.uid()
$$;

create or replace function public.require_staff() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then
    raise exception 'Only employees can perform this action' using errcode = '42501';
  end if;
end $$;

create or replace function public.log_activity(p_kind text, p_msg text, p_ref_type text default null, p_ref_id int default null)
returns void language sql security definer set search_path = public as $$
  insert into public.activity_log(ts, user_name, kind, message, ref_type, ref_id)
  values (public.app_now(), public.current_user_name(), p_kind, p_msg, p_ref_type, p_ref_id)
$$;

create or replace function public.gl_post(p_account text, p_debit numeric, p_credit numeric,
  p_memo text, p_ref_type text, p_ref_id int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_debit,0) = 0 and coalesce(p_credit,0) = 0 then return; end if;
  -- normalise negatives to the other side
  if p_debit < 0 then p_credit := coalesce(p_credit,0) - p_debit; p_debit := 0; end if;
  if p_credit < 0 then p_debit := coalesce(p_debit,0) - p_credit; p_credit := 0; end if;
  insert into public.gl_entries(ts, account, debit, credit, memo, ref_type, ref_id)
  values (public.app_now(), p_account, round(coalesce(p_debit,0),2), round(coalesce(p_credit,0),2), p_memo, p_ref_type, p_ref_id);
end $$;

create or replace function public.loc_by_kind(p_kind text) returns int
language sql stable security definer set search_path = public as $$
  select id from public.locations where kind = p_kind order by id limit 1
$$;

-- ---------- core inventory posting --------------------------------------
-- Moves stock, maintains perpetual weighted-average cost and writes the
-- inventory ledger.  Returns the unit cost the movement was valued at.
create or replace function public.post_inv(p_item int, p_loc int, p_qty numeric, p_type text,
  p_unit_cost numeric default null, p_reason text default null, p_ref_type text default null,
  p_ref_id int default null, p_note text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_onhand numeric; v_total numeric; v_avg numeric; v_cost numeric;
  v_item text; v_loc text;
begin
  if p_qty is null or p_qty = 0 then return null; end if;
  insert into public.inventory(item_id, location_id, qty) values (p_item, p_loc, 0) on conflict do nothing;
  select avg_cost, name into v_avg, v_item from public.items where id = p_item for update;
  select qty into v_onhand from public.inventory where item_id = p_item and location_id = p_loc for update;

  if p_qty < 0 then
    if v_onhand + p_qty < -0.0005 then
      select name into v_loc from public.locations where id = p_loc;
      raise exception 'Insufficient stock: % at % (on hand %, need %)',
        v_item, v_loc, round(v_onhand, 2), round(-p_qty, 2) using errcode = 'P0001';
    end if;
    v_cost := coalesce(p_unit_cost, v_avg);
  else
    v_cost := coalesce(p_unit_cost, v_avg);
    select coalesce(sum(qty), 0) into v_total from public.inventory where item_id = p_item;
    v_total := greatest(v_total, 0);
    if v_total + p_qty > 0 then
      update public.items
         set avg_cost = round((v_total * v_avg + p_qty * v_cost) / (v_total + p_qty), 4)
       where id = p_item;
    end if;
  end if;

  update public.inventory set qty = qty + p_qty, updated_at = public.app_now()
   where item_id = p_item and location_id = p_loc;

  insert into public.inv_txns(ts, item_id, location_id, qty, unit_cost, txn_type, reason_code,
                              ref_type, ref_id, note, user_id, user_name)
  values (public.app_now(), p_item, p_loc, p_qty, v_cost, p_type, p_reason,
          p_ref_type, p_ref_id, p_note, auth.uid(), public.current_user_name());
  return v_cost;
end $$;

-- ---------- inventory operations ----------------------------------------
create or replace function public.transfer_inventory(p_item int, p_from int, p_to int, p_qty numeric, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_cost numeric; v_name text; v_f text; v_t text;
begin
  perform public.require_staff();
  if p_qty <= 0 then raise exception 'Transfer quantity must be positive'; end if;
  if p_from = p_to then raise exception 'Choose two different locations'; end if;
  v_cost := public.post_inv(p_item, p_from, -p_qty, 'transfer_out', null, null, 'transfer', null, p_note);
  perform public.post_inv(p_item, p_to, p_qty, 'transfer_in', v_cost, null, 'transfer', null, p_note);
  select name into v_name from public.items where id = p_item;
  select code into v_f from public.locations where id = p_from;
  select code into v_t from public.locations where id = p_to;
  perform public.log_activity('inventory', format('Transferred %s × %s from %s to %s', p_qty, v_name, v_f, v_t), 'item', p_item);
end $$;

-- p_qty_change is signed (+ found / - damaged etc.)
create or replace function public.adjust_inventory(p_item int, p_loc int, p_qty_change numeric, p_reason text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_cost numeric; v_name text; v_val numeric;
begin
  perform public.require_staff();
  if p_reason is null then raise exception 'A reason code is required for adjustments'; end if;
  if p_qty_change = 0 then return; end if;
  v_cost := public.post_inv(p_item, p_loc, p_qty_change, 'adjustment', null, p_reason, 'adjustment', null, p_note);
  v_val := round(p_qty_change * v_cost, 2);
  -- inventory up => credit adjustment expense; down => debit expense
  perform public.gl_post('Inventory', v_val, 0, 'Inventory adjustment ' || p_reason, 'adjustment', p_item);
  perform public.gl_post('Inventory Shrinkage & Adjustments', -v_val, 0, 'Inventory adjustment ' || p_reason, 'adjustment', p_item);
  select name into v_name from public.items where id = p_item;
  perform public.log_activity('inventory', format('Adjusted %s by %s (%s)', v_name, p_qty_change, p_reason), 'item', p_item);
end $$;

create or replace function public.cycle_count(p_item int, p_loc int, p_counted numeric, p_reason text default 'CC', p_note text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_onhand numeric; v_diff numeric;
begin
  perform public.require_staff();
  select coalesce(qty, 0) into v_onhand from public.inventory where item_id = p_item and location_id = p_loc;
  v_diff := p_counted - coalesce(v_onhand, 0);
  if v_diff <> 0 then
    perform public.adjust_inventory(p_item, p_loc, v_diff, p_reason, coalesce(p_note, 'Cycle count'));
  end if;
  return v_diff;
end $$;

-- ---------- sales -------------------------------------------------------
create or replace function public.recalc_sales_order(p_id int) returns void
language plpgsql security definer set search_path = public as $$
declare v_odisc numeric; v_tax numeric;
begin
  select discount_pct into v_odisc from public.sales_orders where id = p_id;
  v_tax := coalesce(public.setting_num('tax_rate'), 0);
  update public.sales_order_lines l
     set net_amount = round(l.qty * l.unit_price * (1 - l.discount_pct/100) * (1 - v_odisc/100), 2),
         tax_amount = round(round(l.qty * l.unit_price * (1 - l.discount_pct/100) * (1 - v_odisc/100), 2) * v_tax, 2)
   where l.order_id = p_id;
  update public.sales_orders o set
    subtotal = s.gross, discount = s.gross - s.net, tax = s.tax, total = s.net + s.tax
  from (select coalesce(sum(round(qty*unit_price,2)),0) gross, coalesce(sum(net_amount),0) net,
               coalesce(sum(tax_amount),0) tax
          from public.sales_order_lines where order_id = p_id) s
  where o.id = p_id;
end $$;

create or replace function public.create_sales_order(p_customer int, p_location int, p_lines jsonb,
  p_source text default 'SO', p_discount_pct numeric default 0, p_due date default null, p_notes text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_id int; r record; v_price numeric; v_num text; v_n int := 0;
begin
  if p_source <> 'WEB' then perform public.require_staff(); end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one item'; end if;
  if coalesce(p_discount_pct,0) < 0 or coalesce(p_discount_pct,0) > 100 then raise exception 'Discount must be 0-100%%'; end if;
  v_num := case p_source when 'POS' then 'POS-' || nextval('pos_seq')
                         when 'EXCHANGE' then 'EXC-' || nextval('pos_seq')
                         when 'WEB' then 'WEB-' || nextval('so_seq')
                         else 'SO-' || nextval('so_seq') end;
  insert into public.sales_orders(number, source, customer_id, location_id, status, order_date, due_date,
                                  discount_pct, notes, created_by, created_by_name)
  values (v_num, p_source, p_customer, p_location, 'Placed', public.app_now(),
          coalesce(p_due, public.app_today()), coalesce(p_discount_pct,0), p_notes, auth.uid(), public.current_user_name())
  returning id into v_id;

  for r in select * from jsonb_to_recordset(p_lines) as x(item_id int, qty numeric, unit_price numeric, discount_pct numeric) loop
    if r.qty is null or r.qty <= 0 then continue; end if;
    select price into v_price from public.items where id = r.item_id and active;
    if v_price is null then raise exception 'Unknown item %', r.item_id; end if;
    insert into public.sales_order_lines(order_id, item_id, qty, unit_price, discount_pct)
    values (v_id, r.item_id, r.qty,
            case when p_source = 'WEB' then v_price else coalesce(r.unit_price, v_price) end,
            case when p_source = 'WEB' then 0 else least(greatest(coalesce(r.discount_pct,0),0),100) end);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Add at least one item with a positive quantity'; end if;
  perform public.recalc_sales_order(v_id);
  if p_source in ('SO','WEB') then
    perform public.log_activity('sales', format('Sales order %s placed', v_num), 'sales_order', v_id);
  end if;
  return v_id;
end $$;

create or replace function public.fulfill_sales_order(p_id int, p_payment_method text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o record; l record; v_cost numeric; v_cogs numeric := 0; v_debit_acct text;
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

  v_debit_acct := case when o.source in ('POS','EXCHANGE') then 'Cash' else 'Accounts Receivable' end;
  perform public.gl_post(v_debit_acct, o.total, 0, 'Sale ' || o.number, 'sales_order', p_id);
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
end $$;

create or replace function public.close_sales_order(p_id int, p_payment_method text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o record; v_refunded numeric;
begin
  perform public.require_staff();
  select * into o from public.sales_orders where id = p_id for update;
  if o.status <> 'Fulfilled' then raise exception 'Only Fulfilled orders can be closed (order is %)', o.status; end if;
  if o.source in ('SO','WEB') then
    -- collect what is still owed (returns before payment already reduced A/R)
    select coalesce(sum(r.refund_amount),0) into v_refunded from public.returns r where r.sales_order_id = p_id;
    perform public.gl_post('Cash', o.total - v_refunded, 0, 'Payment ' || o.number, 'sales_order', p_id);
    perform public.gl_post('Accounts Receivable', 0, o.total - v_refunded, 'Payment ' || o.number, 'sales_order', p_id);
  end if;
  update public.sales_orders set status = 'Closed', closed_at = public.app_now(),
         payment_method = coalesce(p_payment_method, payment_method, 'Card') where id = p_id;
  if o.source in ('SO','WEB') then
    perform public.log_activity('sales', format('Order %s closed — payment received', o.number), 'sales_order', p_id);
  end if;
end $$;

create or replace function public.cancel_sales_order(p_id int, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select * into o from public.sales_orders where id = p_id for update;
  if not public.is_staff() and (o.customer_id is distinct from public.my_customer_id()) then
    raise exception 'Not allowed';
  end if;
  if o.status <> 'Placed' then raise exception 'Only Placed orders can be cancelled (use Returns for fulfilled orders)'; end if;
  update public.sales_orders set status = 'Cancelled', cancelled_at = public.app_now(),
         notes = concat_ws(' | ', notes, 'Cancelled: ' || p_reason) where id = p_id;
  perform public.log_activity('sales', format('Order %s cancelled', o.number), 'sales_order', p_id);
end $$;

-- Point of sale: create + fulfil + collect payment in one atomic step
create or replace function public.pos_checkout(p_customer int, p_location int, p_lines jsonb,
  p_discount_pct numeric default 0, p_payment_method text default 'Card')
returns int language plpgsql security definer set search_path = public as $$
declare v_id int; v_num text; v_total numeric;
begin
  perform public.require_staff();
  v_id := public.create_sales_order(p_customer, p_location, p_lines, 'POS', p_discount_pct, public.app_today(), null);
  perform public.fulfill_sales_order(v_id, p_payment_method);
  perform public.close_sales_order(v_id, p_payment_method);
  select number, total into v_num, v_total from public.sales_orders where id = v_id;
  perform public.log_activity('pos', format('POS sale %s — $%s', v_num, v_total), 'sales_order', v_id);
  return v_id;
end $$;

-- Customers place pickup orders from the portal
create or replace function public.place_customer_order(p_location int, p_lines jsonb, p_pickup date default null, p_notes text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_cust int; v_id int;
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
  return v_id;
end $$;

-- ---------- returns & exchanges -----------------------------------------
create or replace function public.process_return(p_order int, p_lines jsonb,
  p_exchange_lines jsonb default null, p_notes text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  o record; l record; r record; v_rid int; v_num text; v_loc int; v_qa int;
  v_net numeric := 0; v_tax numeric := 0; v_cost numeric := 0; v_rn numeric; v_rt numeric;
  v_ex int; v_ex_total numeric := 0; v_credit_acct text; v_count int := 0;
begin
  perform public.require_staff();
  select * into o from public.sales_orders where id = p_order for update;
  if o.id is null then raise exception 'Order not found'; end if;
  if o.status not in ('Fulfilled','Closed') then raise exception 'Only fulfilled/closed sales can be returned'; end if;
  v_qa := public.loc_by_kind('quarantine');
  v_num := 'RMA-' || nextval('rt_seq');
  insert into public.returns(number, sales_order_id, kind, ts, notes, created_by_name)
  values (v_num, p_order, case when p_exchange_lines is not null and jsonb_array_length(p_exchange_lines) > 0
                               then 'Exchange' else 'Return' end,
          public.app_now(), p_notes, public.current_user_name())
  returning id into v_rid;

  for r in select * from jsonb_to_recordset(p_lines) as x(so_line_id int, qty numeric, reason_code text, disposition text) loop
    if coalesce(r.qty,0) <= 0 then continue; end if;
    select * into l from public.sales_order_lines where id = r.so_line_id and order_id = p_order for update;
    if l.id is null then raise exception 'Line does not belong to this order'; end if;
    if r.qty > l.qty - l.qty_returned then
      raise exception 'Cannot return % — only % left returnable on this line', r.qty, l.qty - l.qty_returned;
    end if;
    if r.reason_code is null then raise exception 'Reason code required for each returned line'; end if;
    v_loc := case when r.disposition = 'Quality Hold' then v_qa else o.location_id end;
    v_rn := round(l.net_amount / l.qty * r.qty, 2);
    v_rt := round(l.tax_amount / l.qty * r.qty, 2);
    perform public.post_inv(l.item_id, v_loc, r.qty, 'return', l.unit_cost, r.reason_code, 'return', v_rid, v_num);
    insert into public.return_lines(return_id, so_line_id, item_id, qty, reason_code, disposition, location_id,
                                    refund_net, refund_tax, unit_cost)
    values (v_rid, l.id, l.item_id, r.qty, r.reason_code, coalesce(r.disposition,'Restock'), v_loc, v_rn, v_rt, l.unit_cost);
    update public.sales_order_lines set qty_returned = qty_returned + r.qty where id = l.id;
    v_net := v_net + v_rn; v_tax := v_tax + v_rt; v_cost := v_cost + round(r.qty * l.unit_cost, 2);
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then raise exception 'Select at least one item to return'; end if;

  -- reverse revenue (contra-revenue account) and cost of goods sold
  v_credit_acct := case when o.status = 'Fulfilled' and o.source in ('SO','WEB') then 'Accounts Receivable' else 'Cash' end;
  perform public.gl_post('Sales Returns & Allowances', v_net, 0, 'Return ' || v_num, 'return', v_rid);
  perform public.gl_post('Sales Tax Payable', v_tax, 0, 'Return ' || v_num, 'return', v_rid);
  perform public.gl_post(v_credit_acct, 0, v_net + v_tax, 'Return ' || v_num, 'return', v_rid);
  perform public.gl_post('Inventory', v_cost, 0, 'Return ' || v_num, 'return', v_rid);
  perform public.gl_post('Cost of Goods Sold', 0, v_cost, 'Return ' || v_num, 'return', v_rid);

  update public.returns set refund_amount = v_net + v_tax where id = v_rid;

  if p_exchange_lines is not null and jsonb_array_length(p_exchange_lines) > 0 then
    v_ex := public.create_sales_order(o.customer_id, o.location_id, p_exchange_lines, 'EXCHANGE', 0, public.app_today(),
                                      'Exchange for ' || o.number || ' / ' || v_num);
    perform public.fulfill_sales_order(v_ex, 'Exchange');
    perform public.close_sales_order(v_ex, 'Exchange');
    select total into v_ex_total from public.sales_orders where id = v_ex;
    update public.returns set exchange_order_id = v_ex, net_due_from_customer = v_ex_total - (v_net + v_tax) where id = v_rid;
  else
    update public.returns set net_due_from_customer = -(v_net + v_tax) where id = v_rid;
  end if;

  perform public.log_activity('returns', format('%s processed for %s (refund $%s)', v_num, o.number, v_net + v_tax), 'return', v_rid);
  return v_rid;
end $$;

-- ---------- purchasing --------------------------------------------------
create or replace function public.send_purchase_order(p_id int) returns void
language plpgsql security definer set search_path = public as $$
declare p record; v_lt int;
begin
  perform public.require_staff();
  select * into p from public.purchase_orders where id = p_id for update;
  if p.status <> 'Draft' then raise exception 'Only Draft POs can be sent'; end if;
  select lead_time_days into v_lt from public.suppliers where id = p.supplier_id;
  update public.purchase_orders
     set status = 'Sent', order_date = public.app_today(), quoted_lead_days = v_lt,
         expected_date = public.app_today() + v_lt
   where id = p_id;
  perform public.log_activity('purchasing', format('PO %s sent to supplier (expected %s)', p.number, public.app_today() + v_lt), 'purchase_order', p_id);
end $$;

create or replace function public.create_purchase_order(p_supplier int, p_location int, p_lines jsonb,
  p_send boolean default true, p_notes text default null, p_source text default 'Manual')
returns int language plpgsql security definer set search_path = public as $$
declare v_id int; r record; v_cost numeric; v_num text; v_n int := 0;
begin
  perform public.require_staff();
  v_num := 'PO-' || nextval('po_seq');
  insert into public.purchase_orders(number, supplier_id, location_id, status, created_at, notes, source, created_by_name)
  values (v_num, p_supplier, p_location, 'Draft', public.app_now(), p_notes, p_source, public.current_user_name())
  returning id into v_id;
  for r in select * from jsonb_to_recordset(p_lines) as x(item_id int, qty numeric, unit_cost numeric) loop
    if coalesce(r.qty,0) <= 0 then continue; end if;
    select standard_cost into v_cost from public.items where id = r.item_id;
    insert into public.po_lines(po_id, item_id, qty_ordered, unit_cost)
    values (v_id, r.item_id, r.qty, coalesce(r.unit_cost, v_cost));
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Add at least one line to the PO'; end if;
  perform public.log_activity('purchasing', format('PO %s created', v_num), 'purchase_order', v_id);
  if p_send then perform public.send_purchase_order(v_id); end if;
  return v_id;
end $$;

create or replace function public.receive_purchase_order(p_id int, p_lines jsonb, p_location int default null)
returns void language plpgsql security definer set search_path = public as $$
declare p record; r record; l record; v_loc int; v_n int := 0; v_val numeric := 0; v_open numeric;
begin
  perform public.require_staff();
  select * into p from public.purchase_orders where id = p_id for update;
  if p.status not in ('Sent','Partially Received') then raise exception 'PO % is %, cannot receive', p.number, p.status; end if;
  v_loc := coalesce(p_location, p.location_id);
  for r in select * from jsonb_to_recordset(p_lines) as x(po_line_id int, qty numeric) loop
    if coalesce(r.qty,0) <= 0 then continue; end if;
    select * into l from public.po_lines where id = r.po_line_id and po_id = p_id for update;
    if l.id is null then raise exception 'Line not on this PO'; end if;
    if l.qty_received + r.qty > l.qty_ordered then
      raise exception 'Receiving % would exceed ordered qty (% ordered, % already received)', r.qty, l.qty_ordered, l.qty_received;
    end if;
    perform public.post_inv(l.item_id, v_loc, r.qty, 'receipt', l.unit_cost, null, 'purchase_order', p_id, p.number);
    insert into public.po_receipts(po_id, po_line_id, item_id, location_id, qty, unit_cost, received_at, received_by_name)
    values (p_id, l.id, l.item_id, v_loc, r.qty, l.unit_cost, public.app_now(), public.current_user_name());
    update public.po_lines set qty_received = qty_received + r.qty where id = l.id;
    update public.items set standard_cost = l.unit_cost where id = l.item_id;
    v_val := v_val + round(r.qty * l.unit_cost, 2);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Enter a quantity to receive'; end if;

  perform public.gl_post('Inventory', v_val, 0, 'Receipt ' || p.number, 'purchase_order', p_id);
  perform public.gl_post('Accounts Payable', 0, v_val, 'Receipt ' || p.number, 'purchase_order', p_id);

  select coalesce(sum(qty_ordered - qty_received),0) into v_open from public.po_lines where po_id = p_id;
  update public.purchase_orders
     set status = case when v_open <= 0 then 'Received' else 'Partially Received' end,
         first_receipt_date = coalesce(first_receipt_date, public.app_today()),
         last_receipt_date = public.app_today()
   where id = p_id;
  perform public.log_activity('purchasing', format('Received %s line(s) on %s ($%s)', v_n, p.number, v_val), 'purchase_order', p_id);
end $$;

create or replace function public.close_purchase_order(p_id int) returns void
language plpgsql security definer set search_path = public as $$
declare p record;
begin
  perform public.require_staff();
  select * into p from public.purchase_orders where id = p_id for update;
  if p.status in ('Closed','Cancelled') then raise exception 'PO already %', p.status; end if;
  if p.status in ('Draft') or (p.status = 'Sent' and p.first_receipt_date is null) then
    update public.purchase_orders set status = 'Cancelled', closed_at = public.app_now() where id = p_id;
    perform public.log_activity('purchasing', format('PO %s cancelled', p.number), 'purchase_order', p_id);
  else
    update public.purchase_orders set status = 'Closed', closed_at = public.app_now() where id = p_id;
    perform public.log_activity('purchasing', format('PO %s closed', p.number), 'purchase_order', p_id);
  end if;
end $$;

create or replace function public.pay_supplier(p_po int, p_amount numeric, p_method text default 'ACH')
returns void language plpgsql security definer set search_path = public as $$
declare p record; v_owed numeric;
begin
  perform public.require_staff();
  select * into p from public.purchase_orders where id = p_po for update;
  select coalesce((select sum(round(qty*unit_cost,2)) from public.po_receipts where po_id = p_po),0)
       - coalesce((select sum(amount) from public.supplier_payments where po_id = p_po),0) into v_owed;
  if p_amount <= 0 then raise exception 'Payment must be positive'; end if;
  if p_amount > v_owed + 0.005 then raise exception 'Payment $% exceeds balance owed $%', p_amount, v_owed; end if;
  insert into public.supplier_payments(po_id, amount, paid_at, method, created_by_name)
  values (p_po, p_amount, public.app_now(), p_method, public.current_user_name());
  perform public.gl_post('Accounts Payable', p_amount, 0, 'Payment ' || p.number, 'purchase_order', p_po);
  perform public.gl_post('Cash', 0, p_amount, 'Payment ' || p.number, 'purchase_order', p_po);
  -- fully received and fully paid => close
  if p.status = 'Received' and v_owed - p_amount <= 0.005 then
    update public.purchase_orders set status = 'Closed', closed_at = public.app_now() where id = p_po;
  end if;
  perform public.log_activity('purchasing', format('Paid $%s on %s', p_amount, p.number), 'purchase_order', p_po);
end $$;

-- ---------- production --------------------------------------------------
create or replace function public.create_production_order(p_item int, p_qty numeric, p_location int,
  p_due date default null, p_notes text default null, p_source text default 'Manual')
returns int language plpgsql security definer set search_path = public as $$
declare v_id int; v_num text; v_name text;
begin
  perform public.require_staff();
  if not exists (select 1 from public.bom_lines where parent_item_id = p_item) then
    raise exception 'This item has no bill of material — add one before building it';
  end if;
  if p_qty <= 0 then raise exception 'Quantity must be positive'; end if;
  v_num := 'MO-' || nextval('mo_seq');
  insert into public.production_orders(number, item_id, location_id, qty_planned, created_at, due_date, notes, source, created_by_name)
  values (v_num, p_item, p_location, p_qty, public.app_now(), p_due, p_notes, p_source, public.current_user_name())
  returning id into v_id;
  select name into v_name from public.items where id = p_item;
  perform public.log_activity('production', format('Production order %s created: %s × %s', v_num, p_qty, v_name), 'production_order', v_id);
  return v_id;
end $$;

-- Issue components (backflush per BOM) and start the clock
create or replace function public.start_production_order(p_id int, p_qty_started numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare m record; b record; v_q numeric; v_cost numeric; v_total numeric := 0; v_short text := '';
        v_have numeric; v_started numeric;
begin
  perform public.require_staff();
  select * into m from public.production_orders where id = p_id for update;
  if m.status <> 'Planned' then raise exception 'Order % is %, only Planned orders can be started', m.number, m.status; end if;
  v_started := coalesce(p_qty_started, m.qty_planned);
  if v_started <= 0 then raise exception 'Quantity started must be positive'; end if;

  -- friendly shortage message listing every short component
  for b in select bl.*, i.name, i.uom from public.bom_lines bl join public.items i on i.id = bl.component_item_id
            where bl.parent_item_id = m.item_id loop
    select coalesce(qty,0) into v_have from public.inventory where item_id = b.component_item_id and location_id = m.location_id;
    if coalesce(v_have,0) < b.qty_per * v_started - 0.0005 then
      v_short := v_short || format('%s: need %s, have %s; ', b.name, round(b.qty_per*v_started,2), round(coalesce(v_have,0),2));
    end if;
  end loop;
  if v_short <> '' then raise exception 'Component shortage at this location — %', v_short; end if;

  for b in select * from public.bom_lines where parent_item_id = m.item_id loop
    v_q := round(b.qty_per * v_started, 3);
    v_cost := public.post_inv(b.component_item_id, m.location_id, -v_q, 'production_issue', null, null, 'production_order', p_id, m.number);
    insert into public.production_issues(production_order_id, item_id, qty, unit_cost) values (p_id, b.component_item_id, v_q, v_cost);
    v_total := v_total + round(v_q * v_cost, 2);
  end loop;

  perform public.gl_post('Work in Process', v_total, 0, 'Issue ' || m.number, 'production_order', p_id);
  perform public.gl_post('Inventory', 0, v_total, 'Issue ' || m.number, 'production_order', p_id);
  update public.production_orders
     set status = 'In Progress', qty_started = v_started, started_at = public.app_now(),
         component_cost = v_total, unit_cost = round(v_total / v_started, 4)
   where id = p_id;
  perform public.log_activity('production', format('%s started — components issued ($%s)', m.number, v_total), 'production_order', p_id);
end $$;

create or replace function public.complete_production_order(p_id int, p_good numeric, p_scrapped numeric default 0,
  p_reworked numeric default 0, p_reason text default null, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare m record; v_good_val numeric; v_scrap_val numeric;
begin
  perform public.require_staff();
  select * into m from public.production_orders where id = p_id for update;
  if m.status <> 'In Progress' then raise exception 'Order % is %, only In Progress orders can be completed', m.number, m.status; end if;
  p_scrapped := coalesce(p_scrapped,0); p_reworked := coalesce(p_reworked,0);
  if p_good < 0 or p_scrapped < 0 or p_reworked < 0 then raise exception 'Quantities cannot be negative'; end if;
  if abs((p_good + p_scrapped) - m.qty_started) > 0.0005 then
    raise exception 'Good (%) + scrapped (%) must equal quantity started (%)', p_good, p_scrapped, m.qty_started;
  end if;
  if p_reworked > p_good then raise exception 'Reworked units are a subset of good units'; end if;
  if (p_scrapped > 0 or p_reworked > 0) and p_reason is null then
    raise exception 'A quality reason code is required when units are scrapped or reworked';
  end if;

  v_good_val := round(p_good * m.unit_cost, 2);
  v_scrap_val := m.component_cost - v_good_val;
  if p_good > 0 then
    perform public.post_inv(m.item_id, m.location_id, p_good, 'production_receipt', m.unit_cost, null, 'production_order', p_id, m.number);
  end if;
  perform public.gl_post('Inventory', v_good_val, 0, 'Complete ' || m.number, 'production_order', p_id);
  perform public.gl_post('Production Scrap', v_scrap_val, 0, 'Scrap ' || m.number, 'production_order', p_id);
  perform public.gl_post('Work in Process', 0, m.component_cost, 'Complete ' || m.number, 'production_order', p_id);

  update public.production_orders
     set status = 'Completed', qty_good = p_good, qty_scrapped = p_scrapped, qty_reworked = p_reworked,
         quality_reason = p_reason, finished_at = public.app_now(), notes = coalesce(p_notes, notes)
   where id = p_id;
  perform public.log_activity('production', format('%s completed: %s good, %s scrapped', m.number, p_good, p_scrapped), 'production_order', p_id);
end $$;

create or replace function public.cancel_production_order(p_id int) returns void
language plpgsql security definer set search_path = public as $$
declare m record; i record;
begin
  perform public.require_staff();
  select * into m from public.production_orders where id = p_id for update;
  if m.status = 'Planned' then
    update public.production_orders set status = 'Cancelled' where id = p_id;
  elsif m.status = 'In Progress' then
    for i in select * from public.production_issues where production_order_id = p_id loop
      perform public.post_inv(i.item_id, m.location_id, i.qty, 'production_issue', i.unit_cost, null, 'production_order', p_id, 'Cancel ' || m.number);
    end loop;
    perform public.gl_post('Inventory', m.component_cost, 0, 'Cancel ' || m.number, 'production_order', p_id);
    perform public.gl_post('Work in Process', 0, m.component_cost, 'Cancel ' || m.number, 'production_order', p_id);
    update public.production_orders set status = 'Cancelled', finished_at = public.app_now() where id = p_id;
  else
    raise exception 'Order is already %', m.status;
  end if;
  perform public.log_activity('production', format('%s cancelled', m.number), 'production_order', p_id);
end $$;

-- ---------- operating expenses (for a complete P&L) ---------------------
create or replace function public.record_expense(p_account text, p_amount numeric, p_memo text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_staff();
  if p_account not in ('Rent','Wages','Utilities','Marketing','Other Operating Expense') then
    raise exception 'Unknown expense account';
  end if;
  perform public.gl_post(p_account, p_amount, 0, p_memo, 'expense', null);
  perform public.gl_post('Cash', 0, p_amount, p_memo, 'expense', null);
  perform public.log_activity('finance', format('Expense recorded: %s $%s', p_account, p_amount));
end $$;

-- ---------- sign-up: create profile, link customers ---------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_role text := 'customer'; v_cust int; v_code text; v_name text;
begin
  v_code := new.raw_user_meta_data->>'access_code';
  v_name := coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1));
  if v_code is not null and v_code <> '' then
    if v_code = (select text_value from public.settings where key = 'manager_access_code') then v_role := 'manager';
    elsif v_code = (select text_value from public.settings where key = 'staff_access_code') then v_role := 'staff';
    else raise exception 'Invalid employee access code';
    end if;
  end if;
  if v_role = 'customer' then
    select id into v_cust from public.customers where lower(email) = lower(new.email);
    if v_cust is null then
      insert into public.customers(name, email, phone, customer_type)
      values (v_name, new.email, new.raw_user_meta_data->>'phone', 'Retail') returning id into v_cust;
    end if;
  end if;
  insert into public.profiles(id, email, full_name, role, customer_id) values (new.id, new.email, v_name, v_role, v_cust);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();
