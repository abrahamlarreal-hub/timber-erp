-- =====================================================================
-- 1) Ship what is available now and split the rest into a linked backorder
-- 2) 8-week cash-flow forecast (wow factor)
-- =====================================================================

alter table public.sales_orders add column if not exists backorder_of int references public.sales_orders(id);

create or replace function public.ship_available(p_id int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o record; l record; v_have numeric; v_ship numeric; v_rest jsonb := '[]'; v_any boolean := false;
        v_short boolean := false; v_bo int; v_bo_num text;
begin
  perform public.require_staff();
  select * into o from public.sales_orders where id = p_id for update;
  if o.status <> 'Placed' then raise exception 'Only Placed orders can be shipped'; end if;

  -- what can we ship from this location right now?
  for l in select * from public.sales_order_lines where order_id = p_id order by id loop
    select coalesce(qty, 0) into v_have from public.inventory where item_id = l.item_id and location_id = o.location_id;
    v_ship := least(l.qty, greatest(floor(coalesce(v_have, 0) * 1000) / 1000, 0));
    if v_ship > 0 then v_any := true; end if;
    if v_ship < l.qty then
      v_short := true;
      v_rest := v_rest || jsonb_build_object('item_id', l.item_id, 'qty', l.qty - v_ship,
                                             'unit_price', l.unit_price, 'discount_pct', l.discount_pct);
    end if;
  end loop;
  if not v_any then raise exception 'Nothing on this order is in stock at this location yet'; end if;

  if v_short then
    -- create the backorder for the remainder (keeps price, discount and requested date)
    v_bo := public.create_sales_order(o.customer_id, o.location_id, v_rest, case when o.source = 'WEB' then 'SO' else o.source end,
                                      o.discount_pct, o.due_date, 'Backorder of ' || o.number);
    update public.sales_orders set backorder_of = p_id where id = v_bo returning number into v_bo_num;
    -- shrink the original order to what ships now
    for l in select * from public.sales_order_lines where order_id = p_id loop
      select coalesce(qty, 0) into v_have from public.inventory where item_id = l.item_id and location_id = o.location_id;
      v_ship := least(l.qty, greatest(floor(coalesce(v_have, 0) * 1000) / 1000, 0));
      if v_ship <= 0 then delete from public.sales_order_lines where id = l.id;
      else update public.sales_order_lines set qty = v_ship where id = l.id; end if;
    end loop;
    perform public.recalc_sales_order(p_id);
    update public.sales_orders set notes = concat_ws(' | ', notes, 'Partial shipment — rest on ' || v_bo_num) where id = p_id;
  end if;

  perform public.fulfill_sales_order(p_id, null);
  if v_short then
    perform public.log_activity('sales', format('%s shipped partially; remainder backordered on %s', o.number, v_bo_num), 'sales_order', p_id);
  end if;
  return jsonb_build_object('shipped_order', p_id, 'backorder_id', v_bo, 'backorder_number', v_bo_num);
end $$;
grant execute on function public.ship_available(int) to authenticated;

-- ---------------------------------------------------------------------
-- Cash-flow forecast: where will cash be each week for the next N weeks?
--   + forecast store/portal sales (avg of last 8 weeks, cash at sale)
--   + collections of open wholesale invoices (fulfilled + 30 days)
--   + collections of confirmed wholesale orders (requested date + 30 days)
--   - supplier bills on their due dates (v_payables)
--   - open purchase orders (expected receipt + supplier terms)
--   - payroll (avg weekly wages), rent (on the 1st), other overhead
--   - sales tax remitted monthly (balance in Sales Tax Payable)
-- ---------------------------------------------------------------------
create or replace function public.cash_forecast(p_weeks int default 8) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.app_today(); v_cash numeric; v_weekly_sales numeric; v_weekly_wages numeric;
        v_weekly_other numeric; v_rent numeric; v_tax numeric; w int; s date; e date;
        v_in_sales numeric; v_in_ar numeric; v_in_so numeric; v_out_ap numeric; v_out_po numeric;
        v_out_pay numeric; v_out_rent numeric; v_out_other numeric; v_out_tax numeric;
        v_bal numeric; v_rows jsonb := '[]'; v_min numeric; v_min_week int;
begin
  perform public.require_staff();
  select coalesce(sum(debit - credit), 0) into v_cash from public.gl_entries where account = 'Cash';
  -- cash sales (POS + portal pickups), net of tax, avg per week over the last 8 weeks, plus tax collected
  select coalesce(sum(o.total), 0) / 8.0 into v_weekly_sales from public.sales_orders o
   where o.source in ('POS','WEB','EXCHANGE') and o.status in ('Fulfilled','Closed')
     and o.fulfilled_at >= public.day_start(v_today - 56) and o.fulfilled_at < public.day_start(v_today);
  v_weekly_wages := public.gl_sum('Wages', v_today - 84, v_today - 1) / 12.0;
  v_weekly_other := (public.gl_sum('Utilities', v_today - 84, v_today - 1) + public.gl_sum('Marketing', v_today - 84, v_today - 1)) / 12.0;
  select coalesce((select debit from public.gl_entries where account = 'Rent' order by ts desc limit 1), 0) into v_rent;
  select coalesce(sum(credit - debit), 0) into v_tax from public.gl_entries where account = 'Sales Tax Payable';
  v_bal := v_cash; v_min := v_cash; v_min_week := 0;

  for w in 1..greatest(1, least(p_weeks, 16)) loop
    s := v_today + 7 * (w - 1); e := s + 6;
    v_in_sales := round(v_weekly_sales, 2);
    -- open invoices: fulfilled wholesale orders not yet paid (overdue ones assumed collected in week 1)
    select coalesce(sum(o.total - coalesce((select sum(refund_amount) from public.returns r where r.sales_order_id = o.id), 0)), 0) into v_in_ar
      from public.sales_orders o
     where o.status = 'Fulfilled' and o.source in ('SO','WEB')
       and greatest((o.fulfilled_at at time zone 'America/Denver')::date + 30, v_today) between s and e;
    select coalesce(sum(o.total), 0) into v_in_so from public.sales_orders o
     where o.status = 'Placed' and o.source = 'SO' and greatest(o.due_date, v_today) + 30 between s and e;
    select coalesce(sum(balance), 0) into v_out_ap from public.v_payables
     where balance > 0.005 and greatest(due_date, v_today) between s and e;
    select coalesce(round(sum((pl.qty_ordered - pl.qty_received) * pl.unit_cost), 2), 0) into v_out_po
      from public.po_lines pl join public.purchase_orders po on po.id = pl.po_id join public.suppliers sp on sp.id = po.supplier_id
     where po.status in ('Sent','Partially Received') and pl.qty_ordered > pl.qty_received
       and greatest(po.expected_date, v_today) + sp.payment_terms_days between s and e;
    v_out_pay := round(v_weekly_wages, 2);
    v_out_rent := case when exists (select 1 from generate_series(s, e, '1 day') d where extract(day from d) = 1) then v_rent else 0 end;
    v_out_other := round(v_weekly_other, 2);
    -- Utah sales tax is remitted monthly: assume the balance is paid in the week containing the 20th
    v_out_tax := case when exists (select 1 from generate_series(s, e, '1 day') d where extract(day from d) = 20)
                      then case when w <= 4 then v_tax else round(v_weekly_sales * 4.3 * public.setting_num('tax_rate') / (1 + public.setting_num('tax_rate')), 2) end else 0 end;
    v_bal := v_bal + v_in_sales + v_in_ar + v_in_so - v_out_ap - v_out_po - v_out_pay - v_out_rent - v_out_other - v_out_tax;
    if v_bal < v_min then v_min := v_bal; v_min_week := w; end if;
    v_rows := v_rows || jsonb_build_object('week', w, 'start', s, 'end', e,
      'in_sales', v_in_sales, 'in_receivables', v_in_ar, 'in_orders', v_in_so,
      'out_payables', v_out_ap, 'out_open_pos', v_out_po, 'out_payroll', v_out_pay, 'out_rent', v_out_rent,
      'out_overhead', v_out_other, 'out_sales_tax', v_out_tax,
      'net', round(v_in_sales + v_in_ar + v_in_so - v_out_ap - v_out_po - v_out_pay - v_out_rent - v_out_other - v_out_tax, 2),
      'ending', round(v_bal, 2));
  end loop;

  return jsonb_build_object('today', v_today, 'opening_cash', round(v_cash, 2), 'weeks', v_rows,
    'lowest_balance', round(v_min, 2), 'lowest_week', v_min_week,
    'receivables_open', (select coalesce(sum(debit - credit), 0) from public.gl_entries where account = 'Accounts Receivable'),
    'payables_open', (select coalesce(sum(balance), 0) from public.v_payables where balance > 0.005),
    'assumptions', jsonb_build_object('weekly_cash_sales', round(v_weekly_sales, 2), 'weekly_payroll', round(v_weekly_wages, 2),
                                      'monthly_rent', v_rent, 'customer_terms_days', 30));
end $$;
grant execute on function public.cash_forecast(int) to authenticated;

revoke execute on function public.ship_available(int) from anon;
revoke execute on function public.cash_forecast(int) from anon;
