-- =====================================================================
-- Analytics, inventory policy, supplier scorecard, reports and MRP.
-- Everything is computed live from transactions + editable settings.
-- =====================================================================

create or replace function public.fq(x numeric) returns text
language sql immutable as $$
  select case when x is null then '—' when x = trunc(x) then trunc(x)::text else rtrim(round(x, 2)::text, '0') end
$$;

create or replace function public.day_start(d date) returns timestamptz
language sql immutable as $$ select (d::timestamp at time zone 'America/Denver') $$;

-- ---------- stock by item ------------------------------------------------
create or replace view public.v_item_stock with (security_invoker = true) as
select i.id as item_id,
       coalesce(sum(inv.qty) filter (where l.kind <> 'quarantine'), 0) as on_hand,
       coalesce(sum(inv.qty) filter (where l.kind = 'quarantine'), 0)  as on_hold,
       coalesce(sum(inv.qty), 0) as total_qty
  from public.items i
  left join public.inventory inv on inv.item_id = i.id
  left join public.locations l on l.id = inv.location_id
 group by i.id;

-- ---------- usage statistics from the transaction history --------------
-- usage = units sold + units consumed by production - units returned
create or replace view public.v_item_usage with (security_invoker = true) as
with p as (select coalesce(public.setting_num('history_days'), 180)::int as n, public.app_today() as today),
daily as (
  select t.item_id, (t.ts at time zone 'America/Denver')::date as d, sum(-t.qty) as used
    from public.inv_txns t, p
   where t.txn_type in ('sale','production_issue','return')
     and t.ts >= public.day_start(p.today - p.n) and t.ts < public.day_start(p.today)
   group by 1, 2)
select i.id as item_id, p.n as history_days,
       coalesce(sum(d.used), 0) as total_used,
       coalesce(sum(d.used), 0) / p.n as avg_daily,
       sqrt(greatest(0,
         (coalesce(sum(d.used * d.used), 0) - p.n * power(coalesce(sum(d.used), 0) / p.n, 2)) / greatest(p.n - 1, 1)
       )) as sd_daily
  from public.items i cross join p
  left join daily d on d.item_id = i.id
 group by i.id, p.n;

-- ---------- earliest date we can have qty available --------------------
create or replace function public.est_available_date(p_item int, p_qty numeric default 1) returns date
language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.app_today(); v_onhand numeric; v_alloc numeric; v_po date; v_mo date;
        i record; v_comp_lt int;
begin
  select * into i from public.items where id = p_item;
  select on_hand into v_onhand from public.v_item_stock where item_id = p_item;
  select coalesce(sum(l.qty),0) into v_alloc from public.sales_order_lines l join public.sales_orders o on o.id = l.order_id
   where o.status = 'Placed' and l.item_id = p_item;
  if coalesce(v_onhand,0) - v_alloc >= p_qty then return v_today; end if;
  select min(po.expected_date) into v_po from public.po_lines pl join public.purchase_orders po on po.id = pl.po_id
   where pl.item_id = p_item and po.status in ('Sent','Partially Received') and pl.qty_ordered > pl.qty_received;
  select min(coalesce(due_date, v_today + i.lead_time_days)) into v_mo from public.production_orders
   where item_id = p_item and status in ('Planned','In Progress');
  if v_po is not null or v_mo is not null then
    return greatest(least(coalesce(v_po, v_mo), coalesce(v_mo, v_po)), v_today + 1);
  end if;
  if exists (select 1 from public.bom_lines where parent_item_id = p_item) then
    -- build: production lead time + longest lead time of any component that is short
    select coalesce(max(c.lead_time_days), 0) into v_comp_lt
      from public.bom_lines b join public.items c on c.id = b.component_item_id
      join public.v_item_stock s on s.item_id = c.id
     where b.parent_item_id = p_item and s.on_hand < b.qty_per * p_qty;
    return v_today + i.lead_time_days + v_comp_lt;
  end if;
  return v_today + i.lead_time_days;
end $$;

-- ---------- inventory policy: ROP, safety stock, EOQ, periodic review ----
create or replace view public.v_inventory_policy with (security_invoker = true) as
with s as (
  select public.setting_num('ordering_cost') as order_cost,
         public.setting_num('holding_cost_rate') as hold_rate,
         public.setting_num('service_level_z') as z,
         public.setting_num('review_period_days') as review_days,
         public.app_today() as today),
onorder as (
  select pl.item_id, sum(pl.qty_ordered - pl.qty_received) as q, min(po.expected_date) as next_expected
    from public.po_lines pl join public.purchase_orders po on po.id = pl.po_id
   where po.status in ('Sent','Partially Received') and pl.qty_ordered > pl.qty_received
   group by 1),
inprod as (
  select item_id, sum(case when status = 'Planned' then qty_planned else qty_started end) as q
    from public.production_orders where status in ('Planned','In Progress') group by 1),
alloc as (
  select l.item_id, sum(l.qty) as q,
         sum(l.qty) filter (where o.due_date <= public.app_today()) as q_due
    from public.sales_order_lines l join public.sales_orders o on o.id = l.order_id
   where o.status = 'Placed' group by 1),
base as (
  select i.id as item_id, i.sku, i.name, i.category, i.item_type, i.uom, i.lead_time_days, i.supplier_id,
         sup.name as supplier_name, i.min_order_qty, i.reorder_point_override, i.safety_stock_override,
         exists (select 1 from public.bom_lines b where b.parent_item_id = i.id) as is_made,
         st.on_hand, st.on_hold,
         coalesce(oo.q, 0) + coalesce(ip.q, 0) as on_order,
         oo.next_expected,
         coalesce(al.q, 0) as allocated, coalesce(al.q_due, 0) as allocated_due,
         u.avg_daily, u.sd_daily, u.total_used, u.history_days,
         case when i.avg_cost > 0 then i.avg_cost else i.standard_cost end as unit_cost,
         s.*
    from public.items i
    join s on true
    join public.v_item_stock st on st.item_id = i.id
    join public.v_item_usage u on u.item_id = i.id
    left join public.suppliers sup on sup.id = i.supplier_id
    left join onorder oo on oo.item_id = i.id
    left join inprod ip on ip.item_id = i.id
    left join alloc al on al.item_id = i.id
   where i.active),
calc as (
  select b.*,
         b.avg_daily * 365 as annual_demand,
         b.hold_rate * b.unit_cost as holding_cost_unit,
         b.avg_daily * b.lead_time_days as lt_demand,
         coalesce(b.safety_stock_override, b.z * b.sd_daily * sqrt(b.lead_time_days::numeric)) as safety_stock,
         b.on_hand + b.on_order - b.allocated as position
    from base b),
calc2 as (
  select c.*,
         case when c.annual_demand > 0 and c.holding_cost_unit > 0
              then sqrt(2 * c.annual_demand * c.order_cost / c.holding_cost_unit) else 0 end as eoq,
         ceil(c.lt_demand + c.safety_stock) as rop_computed,
         coalesce(c.reorder_point_override, ceil(c.lt_demand + c.safety_stock)) as reorder_point,
         ceil(c.avg_daily * (c.review_days + c.lead_time_days) + c.safety_stock) as order_up_to
    from calc c)
select item_id, sku, name, category, item_type, uom, is_made, supplier_id, supplier_name, lead_time_days,
       round(unit_cost, 4) as unit_cost,
       round(on_hand, 2) as on_hand, round(on_hold, 2) as on_hold, round(on_order, 2) as on_order,
       round(allocated, 2) as allocated, round(position, 2) as position, next_expected,
       history_days, round(total_used, 2) as total_used,
       round(avg_daily, 3) as avg_daily, round(sd_daily, 3) as sd_daily,
       round(annual_demand, 0) as annual_demand,
       round(holding_cost_unit, 3) as holding_cost_unit, order_cost,
       ceil(eoq) as eoq,
       round(lt_demand, 1) as lt_demand, round(safety_stock, 1) as safety_stock,
       rop_computed, reorder_point, reorder_point_override is not null as rop_overridden,
       order_up_to, review_days,
       greatest(0, order_up_to - position) as periodic_order_qty,
       (position <= reorder_point and reorder_point > 0) as needs_reorder,
       case when position <= reorder_point and reorder_point > 0
            then greatest(ceil(eoq), ceil(reorder_point - position), min_order_qty) else 0 end as suggested_qty,
       case when avg_daily <= 0 then null
            when position <= reorder_point then today
            else today + floor((position - reorder_point) / avg_daily)::int end as order_by_date,
       case when avg_daily > 0 then round(on_hand / avg_daily, 1) end as days_of_supply,
       round(allocated_due, 2) as allocated_due,
       greatest(0, allocated_due - on_hand) as backordered_qty,
       case when allocated_due > on_hand then public.est_available_date(item_id, allocated_due - on_hand + 0.001) end as backorder_eta,
       -- EOQ cost check: annual ordering + holding cost at EOQ
       case when eoq > 0 then round(annual_demand / eoq * order_cost + eoq / 2 * holding_cost_unit, 2) end as eoq_annual_cost
  from calc2;

-- ---------- inventory valuation -----------------------------------------
create or replace view public.v_inventory_valuation with (security_invoker = true) as
select inv.item_id, i.sku, i.name, i.category, i.item_type, inv.location_id, l.code as location_code, l.name as location_name,
       inv.qty, i.avg_cost, round(inv.qty * i.avg_cost, 2) as value
  from public.inventory inv join public.items i on i.id = inv.item_id join public.locations l on l.id = inv.location_id
 where inv.qty <> 0;

-- ---------- payables (amounts owed to suppliers) -----------------------
create or replace view public.v_payables with (security_invoker = true) as
with r as (select po_id, sum(round(qty * unit_cost, 2)) as received_value from public.po_receipts group by 1),
pmt as (select po_id, sum(amount) as paid, max(paid_at) as last_paid from public.supplier_payments group by 1)
select po.id as po_id, po.number, po.status, po.supplier_id, s.name as supplier_name, s.payment_terms_days,
       po.first_receipt_date as invoice_date,
       po.first_receipt_date + s.payment_terms_days as due_date,
       coalesce(r.received_value, 0) as amount, coalesce(pmt.paid, 0) as paid,
       coalesce(r.received_value, 0) - coalesce(pmt.paid, 0) as balance,
       (pmt.last_paid at time zone 'America/Denver')::date as last_paid_date,
       case when coalesce(r.received_value,0) - coalesce(pmt.paid,0) <= 0.005 then
              case when (pmt.last_paid at time zone 'America/Denver')::date <= po.first_receipt_date + s.payment_terms_days
                   then 'Paid on time' else 'Paid late' end
            when po.first_receipt_date + s.payment_terms_days < public.app_today() then 'Overdue'
            when po.first_receipt_date + s.payment_terms_days <= public.app_today() + 7 then 'Due soon'
            else 'Open' end as pay_status
  from public.purchase_orders po
  join public.suppliers s on s.id = po.supplier_id
  join r on r.po_id = po.id
  left join pmt on pmt.po_id = po.id;

-- ---------- supplier scorecard (computed from PO history) ---------------
create or replace view public.v_supplier_scorecard with (security_invoker = true) as
with po as (
  select p.*,
         (select sum(qty_ordered) from public.po_lines where po_id = p.id) as ordered,
         (select sum(qty_received) from public.po_lines where po_id = p.id) as received
    from public.purchase_orders p
   where p.status not in ('Draft','Cancelled')),
agg as (
  select s.id as supplier_id,
         count(po.id) as po_count,
         count(po.id) filter (where po.first_receipt_date is not null) as pos_received,
         count(po.id) filter (where po.status in ('Sent','Partially Received')) as pos_open,
         count(po.id) filter (where po.status in ('Sent','Partially Received') and po.expected_date < public.app_today()) as pos_late_open,
         avg(case when po.first_receipt_date is not null then (po.first_receipt_date <= po.expected_date)::int end) as on_time_rate,
         avg(po.first_receipt_date - po.order_date) as avg_actual_lead,
         avg(po.quoted_lead_days) filter (where po.first_receipt_date is not null) as avg_quoted_lead,
         sum(po.received) filter (where po.status in ('Received','Closed')) /
           nullif(sum(po.ordered) filter (where po.status in ('Received','Closed')), 0) as fill_rate
    from public.suppliers s left join po on po.supplier_id = s.id
   group by s.id),
pay as (
  select supplier_id,
         sum(amount) as total_spend,
         sum(balance) as owed,
         sum(balance) filter (where pay_status = 'Overdue') as overdue,
         min(due_date) filter (where balance > 0.005) as next_due_date,
         avg(case when pay_status in ('Paid on time','Paid late') then (pay_status = 'Paid on time')::int end) as paid_on_time_rate
    from public.v_payables group by supplier_id),
scored as (
  select s.id as supplier_id, s.name, s.contact_name, s.email, s.phone, s.lead_time_days as quoted_lead_days,
         s.payment_terms_days, s.active,
         a.po_count, a.pos_received, a.pos_open, a.pos_late_open,
         round(a.on_time_rate * 100, 1) as on_time_pct,
         round(a.avg_actual_lead, 1) as avg_actual_lead, round(a.avg_quoted_lead, 1) as avg_quoted_lead,
         round(a.fill_rate * 100, 1) as fill_pct,
         coalesce(p.total_spend, 0) as total_spend, coalesce(p.owed, 0) as owed, coalesce(p.overdue, 0) as overdue,
         p.next_due_date, round(p.paid_on_time_rate * 100, 1) as paid_on_time_pct,
         case when a.pos_received = 0 then null else round(100 * (
              0.40 * coalesce(a.on_time_rate, 0)
            + 0.30 * coalesce(a.fill_rate, 1)
            + 0.30 * least(1, s.lead_time_days::numeric / greatest(a.avg_actual_lead, 0.5))
         ), 0) end as score
    from public.suppliers s join agg a on a.supplier_id = s.id left join pay p on p.supplier_id = s.id)
select *,
       case when score is null then 'New'
            when score >= 90 then 'Keep'
            when score >= 75 then 'Watch'
            else 'Replace' end as rating,
       case when score is null then '—' when score >= 93 then 'A' when score >= 85 then 'B'
            when score >= 75 then 'C' when score >= 65 then 'D' else 'F' end as grade
  from scored;

-- ---------- fulfilled sales lines (for reporting) -----------------------
create or replace view public.v_sales_lines with (security_invoker = true) as
select l.id as line_id, o.id as order_id, o.number, o.source, o.customer_id, o.location_id,
       (o.fulfilled_at at time zone 'America/Denver')::date as sale_date, o.fulfilled_at,
       l.item_id, i.sku, i.name as item_name, i.category,
       l.qty, l.qty_returned, l.unit_price, l.net_amount, l.unit_cost,
       round(l.qty * coalesce(l.unit_cost,0), 2) as cost
  from public.sales_order_lines l
  join public.sales_orders o on o.id = l.order_id
  join public.items i on i.id = l.item_id
 where o.status in ('Fulfilled','Closed');

-- ---------- GL helpers -------------------------------------------------
create or replace function public.gl_sum(p_account text, p_from date, p_to date, p_natural text default 'debit')
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(case when p_natural = 'debit' then debit - credit else credit - debit end), 0)
    from public.gl_entries
   where account = p_account and ts >= public.day_start(p_from) and ts < public.day_start(p_to + 1)
$$;

-- ---------- Profit & Loss ------------------------------------------------
create or replace function public.pnl(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g numeric; d numeric; r numeric; c numeric; sc numeric; sh numeric;
        rent numeric; wages numeric; util numeric; mkt numeric; oth numeric; months jsonb;
begin
  perform public.require_staff();
  g  := public.gl_sum('Sales Revenue', p_from, p_to, 'credit');
  d  := public.gl_sum('Sales Discounts', p_from, p_to);
  r  := public.gl_sum('Sales Returns & Allowances', p_from, p_to);
  c  := public.gl_sum('Cost of Goods Sold', p_from, p_to);
  sc := public.gl_sum('Production Scrap', p_from, p_to);
  sh := public.gl_sum('Inventory Shrinkage & Adjustments', p_from, p_to);
  rent := public.gl_sum('Rent', p_from, p_to); wages := public.gl_sum('Wages', p_from, p_to);
  util := public.gl_sum('Utilities', p_from, p_to); mkt := public.gl_sum('Marketing', p_from, p_to);
  oth := public.gl_sum('Other Operating Expense', p_from, p_to);

  select coalesce(jsonb_agg(m order by m->>'month'), '[]'::jsonb) into months from (
    select jsonb_build_object(
      'month', to_char(date_trunc('month', ts at time zone 'America/Denver'), 'YYYY-MM'),
      'net_sales', sum(case account when 'Sales Revenue' then credit - debit
                                    when 'Sales Discounts' then -(debit - credit)
                                    when 'Sales Returns & Allowances' then -(debit - credit) else 0 end),
      'cogs', sum(case when account = 'Cost of Goods Sold' then debit - credit else 0 end),
      'expenses', sum(case when account in ('Production Scrap','Inventory Shrinkage & Adjustments','Rent','Wages','Utilities','Marketing','Other Operating Expense') then debit - credit else 0 end)
    ) as m
    from public.gl_entries
    where ts >= public.day_start(p_from) and ts < public.day_start(p_to + 1)
    group by date_trunc('month', ts at time zone 'America/Denver')) x;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'gross_sales', g, 'discounts', d, 'returns', r, 'net_sales', g - d - r,
    'cogs', c, 'gross_profit', g - d - r - c,
    'gross_margin_pct', case when g - d - r <> 0 then round((g - d - r - c) / (g - d - r) * 100, 1) end,
    'production_scrap', sc, 'shrinkage', sh,
    'rent', rent, 'wages', wages, 'utilities', util, 'marketing', mkt, 'other', oth,
    'operating_expenses', sc + sh + rent + wages + util + mkt + oth,
    'net_income', g - d - r - c - (sc + sh + rent + wages + util + mkt + oth),
    'months', months);
end $$;

-- ---------- inventory turnover ------------------------------------------
create or replace function public.inventory_turnover(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_now numeric; v_after_from numeric; v_after_to numeric; v_begin numeric; v_end numeric;
        v_cogs numeric; v_days int; v_turn numeric; by_cat jsonb;
begin
  perform public.require_staff();
  v_days := p_to - p_from + 1;
  select coalesce(sum(inv.qty * i.avg_cost), 0) into v_now from public.inventory inv join public.items i on i.id = inv.item_id;
  select coalesce(sum(qty * unit_cost), 0) into v_after_from from public.inv_txns where ts >= public.day_start(p_from);
  select coalesce(sum(qty * unit_cost), 0) into v_after_to from public.inv_txns where ts >= public.day_start(p_to + 1);
  v_begin := v_now - v_after_from;
  v_end := v_now - v_after_to;
  v_cogs := public.gl_sum('Cost of Goods Sold', p_from, p_to);
  v_turn := case when (v_begin + v_end) > 0 then v_cogs / ((v_begin + v_end) / 2) end;

  -- per category (finished goods vs components vs resale)
  with cur as (select i.category, sum(inv.qty * i.avg_cost) v from public.inventory inv join public.items i on i.id = inv.item_id group by 1),
       af as (select i.category, sum(t.qty * t.unit_cost) v from public.inv_txns t join public.items i on i.id = t.item_id where t.ts >= public.day_start(p_from) group by 1),
       at as (select i.category, sum(t.qty * t.unit_cost) v from public.inv_txns t join public.items i on i.id = t.item_id where t.ts >= public.day_start(p_to + 1) group by 1),
       cg as (select i.category, sum(-t.qty * t.unit_cost) v from public.inv_txns t join public.items i on i.id = t.item_id
               where t.txn_type in ('sale','return') and t.ts >= public.day_start(p_from) and t.ts < public.day_start(p_to + 1) group by 1),
       u as (select c.category, coalesce(c.v,0) - coalesce(af.v,0) b, coalesce(c.v,0) - coalesce(at.v,0) e, coalesce(cg.v,0) cogs
               from cur c left join af using (category) left join at using (category) left join cg using (category))
  select coalesce(jsonb_agg(jsonb_build_object('category', category, 'begin', round(b,2), 'end', round(e,2), 'cogs', round(cogs,2),
           'turnover', case when b + e > 0 then round(cogs / ((b + e)/2), 2) end,
           'annualized', case when b + e > 0 then round(cogs / ((b + e)/2) * 365 / v_days, 2) end) order by category), '[]')
    into by_cat from u;

  return jsonb_build_object('from', p_from, 'to', p_to, 'days', v_days,
    'begin_value', round(v_begin, 2), 'end_value', round(v_end, 2), 'avg_value', round((v_begin + v_end) / 2, 2),
    'current_value', round(v_now, 2), 'cogs', v_cogs,
    'turnover', round(v_turn, 2),
    'annualized_turnover', round(v_turn * 365 / v_days, 2),
    'days_inventory', case when v_turn > 0 then round(v_days / v_turn, 1) end,
    'by_category', by_cat);
end $$;

-- ---------- sales reports -------------------------------------------------
create or replace function public.sales_report(p_from date, p_to date, p_grain text default 'day') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare series jsonb; top jsonb; by_src jsonb; by_loc jsonb;
begin
  perform public.require_staff();
  with periods as (
    select generate_series(date_trunc(p_grain, p_from::timestamp), date_trunc(p_grain, p_to::timestamp), ('1 ' || p_grain)::interval)::date as period),
  s as (
    select date_trunc(p_grain, sale_date::timestamp)::date as period, count(distinct order_id) orders,
           sum(qty - qty_returned) units, sum(net_amount) net, sum(cost) cost
      from public.v_sales_lines where sale_date between p_from and p_to group by 1),
  r as (
    select date_trunc(p_grain, (rt.ts at time zone 'America/Denver')::date::timestamp)::date as period,
           sum(rl.refund_net) refunds, sum(round(rl.qty * rl.unit_cost, 2)) cost_back
      from public.returns rt join public.return_lines rl on rl.return_id = rt.id
     where (rt.ts at time zone 'America/Denver')::date between p_from and p_to group by 1)
  select jsonb_agg(jsonb_build_object('period', p.period, 'orders', coalesce(s.orders,0),
           'units', coalesce(s.units,0),
           'net_sales', coalesce(s.net,0) - coalesce(r.refunds,0),
           'cogs', coalesce(s.cost,0) - coalesce(r.cost_back,0),
           'gross_profit', coalesce(s.net,0) - coalesce(r.refunds,0) - coalesce(s.cost,0) + coalesce(r.cost_back,0)) order by p.period)
    into series from periods p left join s using (period) left join r using (period);

  select coalesce(jsonb_agg(t order by (t->>'revenue')::numeric desc), '[]') into top from (
    select jsonb_build_object('item_id', item_id, 'sku', sku, 'name', item_name, 'category', category,
             'units', sum(qty - qty_returned),
             'revenue', round(sum(net_amount * (qty - qty_returned) / qty), 2),
             'gross_profit', round(sum((net_amount / qty - coalesce(unit_cost,0)) * (qty - qty_returned)), 2)) t
      from public.v_sales_lines where sale_date between p_from and p_to
     group by item_id, sku, item_name, category) x;

  select coalesce(jsonb_agg(jsonb_build_object('source', source, 'orders', n, 'net', net)), '[]') into by_src from (
    select source, count(distinct order_id) n, sum(net_amount) net from public.v_sales_lines
     where sale_date between p_from and p_to group by source) x;

  select coalesce(jsonb_agg(jsonb_build_object('location', l.name, 'orders', n, 'net', net)), '[]') into by_loc from (
    select location_id, count(distinct order_id) n, sum(net_amount) net from public.v_sales_lines
     where sale_date between p_from and p_to group by location_id) x join public.locations l on l.id = x.location_id;

  return jsonb_build_object('series', coalesce(series, '[]'), 'top_items', top, 'by_source', by_src, 'by_location', by_loc);
end $$;

-- ---------- production report & quality metrics -------------------------
create or replace function public.production_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_orders jsonb; v_m jsonb; v_by_item jsonb; v_by_reason jsonb; v_days int := p_to - p_from + 1;
begin
  perform public.require_staff();
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'number', m.number, 'item', i.name, 'sku', i.sku, 'status', m.status,
      'location', l.code, 'qty_planned', m.qty_planned, 'qty_started', m.qty_started, 'qty_good', m.qty_good,
      'qty_scrapped', m.qty_scrapped, 'qty_reworked', m.qty_reworked, 'reason', m.quality_reason,
      'created_at', m.created_at, 'due_date', m.due_date, 'started_at', m.started_at, 'finished_at', m.finished_at,
      'cycle_hours', round(extract(epoch from (m.finished_at - m.started_at)) / 3600.0, 1),
      'unit_cost', m.unit_cost, 'component_cost', m.component_cost,
      'yield_pct', case when m.qty_started > 0 and m.status = 'Completed' then round(m.qty_good / m.qty_started * 100, 1) end,
      'on_time', case when m.finished_at is not null and m.due_date is not null
                      then (m.finished_at at time zone 'America/Denver')::date <= m.due_date end
    ) order by m.created_at desc), '[]')
    into v_orders
    from public.production_orders m join public.items i on i.id = m.item_id join public.locations l on l.id = m.location_id
   where (m.created_at >= public.day_start(p_from) and m.created_at < public.day_start(p_to + 1))
      or (m.finished_at >= public.day_start(p_from) and m.finished_at < public.day_start(p_to + 1));

  -- metrics on orders COMPLETED in the window
  select jsonb_build_object(
      'orders_completed', count(*),
      'units_started', coalesce(sum(qty_started), 0),
      'units_good', coalesce(sum(qty_good), 0),
      'units_scrapped', coalesce(sum(qty_scrapped), 0),
      'units_reworked', coalesce(sum(qty_reworked), 0),
      'yield_pct', round(sum(qty_good) / nullif(sum(qty_started), 0) * 100, 1),
      'scrap_rate_pct', round(sum(qty_scrapped) / nullif(sum(qty_started), 0) * 100, 2),
      'first_pass_yield_pct', round(sum(qty_good - qty_reworked) / nullif(sum(qty_started), 0) * 100, 1),
      'avg_cycle_hours', round(avg(extract(epoch from (finished_at - started_at)) / 3600.0)::numeric, 1),
      'on_time_pct', round(avg(case when due_date is not null then ((finished_at at time zone 'America/Denver')::date <= due_date)::int end) * 100, 1),
      'scrap_cost', coalesce(round(sum(qty_scrapped * unit_cost), 2), 0),
      'throughput_per_day', round(coalesce(sum(qty_good), 0) / v_days, 2),
      'avg_unit_cost', round(sum(component_cost) / nullif(sum(qty_started), 0), 2))
    into v_m
    from public.production_orders
   where status = 'Completed' and finished_at >= public.day_start(p_from) and finished_at < public.day_start(p_to + 1);

  select coalesce(jsonb_agg(x order by x->>'item'), '[]') into v_by_item from (
    select jsonb_build_object('item', i.name, 'orders', count(*), 'good', sum(m.qty_good), 'scrapped', sum(m.qty_scrapped),
             'yield_pct', round(sum(m.qty_good) / nullif(sum(m.qty_started),0) * 100, 1),
             'avg_unit_cost', round(sum(m.component_cost) / nullif(sum(m.qty_started),0), 2),
             'avg_cycle_hours', round(avg(extract(epoch from (m.finished_at - m.started_at))/3600.0)::numeric, 1)) x
      from public.production_orders m join public.items i on i.id = m.item_id
     where m.status = 'Completed' and m.finished_at >= public.day_start(p_from) and m.finished_at < public.day_start(p_to + 1)
     group by i.name) t;

  select coalesce(jsonb_agg(x), '[]') into v_by_reason from (
    select jsonb_build_object('reason', m.quality_reason, 'description', rc.description,
             'orders', count(*), 'scrapped', sum(m.qty_scrapped), 'reworked', sum(m.qty_reworked),
             'scrap_cost', round(sum(m.qty_scrapped * m.unit_cost), 2)) x
      from public.production_orders m left join public.reason_codes rc on rc.code = m.quality_reason
     where m.status = 'Completed' and m.quality_reason is not null
       and m.finished_at >= public.day_start(p_from) and m.finished_at < public.day_start(p_to + 1)
     group by m.quality_reason, rc.description) t;

  return jsonb_build_object('metrics', v_m, 'orders', v_orders, 'by_item', v_by_item, 'by_reason', v_by_reason);
end $$;

-- ---------- MRP -----------------------------------------------------------
-- Time-phased, multi-level MRP over weekly buckets:
--   gross requirements  = confirmed (Placed) sales orders  + dependent demand from
--                         planned/released parent production orders exploded through the BOM
--   scheduled receipts  = open purchase orders + open production orders
--   projected on hand   = on hand + receipts - gross;  shortage => net requirement
--   planned order       = lot-for-lot (respecting min order qty), released LEAD TIME earlier
create or replace function public.mrp_plan(p_weeks int default 4) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.app_today(); v_end date; v_max int; lv int; it record; c record; w int;
  v_pab numeric; v_gr numeric; v_sr numeric; v_net numeric; v_por numeric; v_need date; v_by date;
  v_rows jsonb := '[]'; v_orders jsonb := '[]'; v_weeks jsonb := '[]';
  a_gr numeric[]; a_sr numeric[]; a_pab numeric[]; a_net numeric[]; a_por numeric[]; a_rel numeric[];
  v_rel_past numeric; v_relw int; v_onhand numeric; v_made boolean;
begin
  perform public.require_staff();
  p_weeks := greatest(1, least(coalesce(p_weeks, 4), 12));
  v_end := v_today + 7 * p_weeks - 1;

  create temp table if not exists _mrp_llc (item_id int primary key, lvl int) on commit drop;
  create temp table if not exists _mrp_req (item_id int, req_date date, qty numeric, source text) on commit drop;
  create temp table if not exists _mrp_sr (item_id int, sr_date date, qty numeric, source text) on commit drop;
  truncate _mrp_llc; truncate _mrp_req; truncate _mrp_sr;

  insert into _mrp_llc
  with recursive t(item_id, lvl) as (
    select id, 0 from public.items where active
    union all
    select b.component_item_id, t.lvl + 1 from t join public.bom_lines b on b.parent_item_id = t.item_id where t.lvl < 10)
  select item_id, max(lvl) from t group by item_id;
  select max(lvl) into v_max from _mrp_llc;

  -- independent demand: confirmed sales orders not yet fulfilled
  insert into _mrp_req
  select l.item_id, greatest(o.due_date, v_today), l.qty, o.number
    from public.sales_order_lines l join public.sales_orders o on o.id = l.order_id
   where o.status = 'Placed' and o.due_date <= v_end;

  -- released-but-not-started production orders still need their components
  insert into _mrp_req
  select b.component_item_id,
         greatest(coalesce(m.due_date, v_today) - i.lead_time_days, v_today),
         b.qty_per * m.qty_planned, m.number
    from public.production_orders m join public.bom_lines b on b.parent_item_id = m.item_id
    join public.items i on i.id = m.item_id
   where m.status = 'Planned';

  -- scheduled receipts
  insert into _mrp_sr
  select pl.item_id, greatest(po.expected_date, v_today), pl.qty_ordered - pl.qty_received, po.number
    from public.po_lines pl join public.purchase_orders po on po.id = pl.po_id
   where po.status in ('Sent','Partially Received') and pl.qty_ordered > pl.qty_received;
  insert into _mrp_sr
  select m.item_id, greatest(coalesce(m.due_date, v_today), v_today),
         case when m.status = 'Planned' then m.qty_planned else m.qty_started end, m.number
    from public.production_orders m where m.status in ('Planned','In Progress');

  for w in 1..p_weeks loop
    v_weeks := v_weeks || jsonb_build_object('week', w, 'start', v_today + 7*(w-1), 'end', v_today + 7*w - 1);
  end loop;

  for lv in 0..coalesce(v_max, 0) loop
    for it in select i.*, s.name as supplier_name, st.on_hand
                from public.items i join _mrp_llc ll on ll.item_id = i.id
                join public.v_item_stock st on st.item_id = i.id
                left join public.suppliers s on s.id = i.supplier_id
               where ll.lvl = lv
                 and exists (select 1 from _mrp_req r where r.item_id = i.id)
               order by i.sku loop
      v_made := exists (select 1 from public.bom_lines b where b.parent_item_id = it.id);
      v_onhand := it.on_hand;
      v_pab := v_onhand; v_rel_past := 0;
      a_gr := array_fill(0::numeric, array[p_weeks]); a_sr := a_gr; a_pab := a_gr; a_net := a_gr; a_por := a_gr; a_rel := a_gr;

      for w in 1..p_weeks loop
        select coalesce(sum(qty),0) into v_gr from _mrp_req
         where item_id = it.id and req_date between v_today + 7*(w-1) and v_today + 7*w - 1;
        select coalesce(sum(qty),0) into v_sr from _mrp_sr
         where item_id = it.id and sr_date between v_today + 7*(w-1) and v_today + 7*w - 1;
        v_pab := v_pab + v_sr - v_gr;
        v_net := 0; v_por := 0;
        if v_pab < -0.0005 then
          v_net := -v_pab;
          v_por := greatest(ceil(v_net), coalesce(it.min_order_qty, 1));
          v_pab := v_pab + v_por;
          select min(req_date) into v_need from _mrp_req
           where item_id = it.id and req_date between v_today + 7*(w-1) and v_today + 7*w - 1;
          v_need := coalesce(v_need, v_today + 7*(w-1));
          v_by := v_need - it.lead_time_days;
          v_relw := case when v_by < v_today then 0 else ((v_by - v_today) / 7) + 1 end;
          if v_relw = 0 then v_rel_past := v_rel_past + v_por;
          elsif v_relw <= p_weeks then a_rel[v_relw] := a_rel[v_relw] + v_por; end if;
          v_orders := v_orders || jsonb_build_object(
            'item_id', it.id, 'sku', it.sku, 'name', it.name, 'uom', it.uom,
            'action', case when v_made then 'Build' else 'Buy' end,
            'qty', v_por, 'net_requirement', round(v_net, 3), 'need_date', v_need, 'order_by', v_by,
            'past_due', v_by < v_today, 'week', w, 'lead_time_days', it.lead_time_days,
            'supplier_id', it.supplier_id, 'supplier_name', it.supplier_name,
            'unit_cost', case when it.avg_cost > 0 then it.avg_cost else it.standard_cost end);
          -- explode planned build into component requirements at its release date
          if v_made then
            for c in select * from public.bom_lines where parent_item_id = it.id loop
              insert into _mrp_req values (c.component_item_id, greatest(v_by, v_today), v_por * c.qty_per, 'Planned build ' || it.sku);
            end loop;
          end if;
        end if;
        a_gr[w] := round(v_gr, 3); a_sr[w] := round(v_sr, 3); a_pab[w] := round(v_pab, 3); a_net[w] := round(v_net, 3); a_por[w] := v_por;
      end loop;

      v_rows := v_rows || jsonb_build_object(
        'item_id', it.id, 'sku', it.sku, 'name', it.name, 'uom', it.uom, 'level', lv,
        'action', case when v_made then 'Build' else 'Buy' end,
        'lead_time_days', it.lead_time_days, 'supplier_name', it.supplier_name,
        'on_hand', round(v_onhand, 3),
        'gross', to_jsonb(a_gr), 'scheduled', to_jsonb(a_sr), 'projected', to_jsonb(a_pab),
        'net', to_jsonb(a_net), 'planned_receipt', to_jsonb(a_por), 'planned_release', to_jsonb(a_rel),
        'release_past_due', v_rel_past,
        'parents', (select coalesce(jsonb_agg(jsonb_build_object('sku', p.sku, 'qty_per', b.qty_per)), '[]')
                      from public.bom_lines b join public.items p on p.id = b.parent_item_id where b.component_item_id = it.id),
        'demand', (select coalesce(jsonb_agg(jsonb_build_object('source', r.source, 'date', r.req_date, 'qty', round(r.qty,3)) order by r.req_date), '[]')
                     from _mrp_req r where r.item_id = it.id and r.req_date <= v_end),
        'receipts', (select coalesce(jsonb_agg(jsonb_build_object('source', s.source, 'date', s.sr_date, 'qty', s.qty) order by s.sr_date), '[]')
                       from _mrp_sr s where s.item_id = it.id and s.sr_date <= v_end));
    end loop;
  end loop;

  return jsonb_build_object('today', v_today, 'weeks', v_weeks, 'items', v_rows, 'orders', v_orders);
end $$;

-- Turn suggestions (from MRP or reorder report) into real POs / production orders
-- p_lines: [{item_id, qty, need_date}]
create or replace function public.create_suggested_orders(p_lines jsonb, p_source text default 'MRP') returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_sup record; v_pos text[] := '{}'; v_mos text[] := '{}'; v_id int; v_lines jsonb;
        v_wks int := public.loc_by_kind('production'); v_wh int := public.loc_by_kind('warehouse');
begin
  perform public.require_staff();
  -- builds
  for r in select x.item_id, x.qty, x.need_date from jsonb_to_recordset(p_lines) x(item_id int, qty numeric, need_date date)
            where exists (select 1 from public.bom_lines b where b.parent_item_id = x.item_id) and x.qty > 0 loop
    v_id := public.create_production_order(r.item_id, r.qty, v_wks, coalesce(r.need_date, public.app_today() + 3),
                                           'Suggested by ' || p_source, p_source);
    v_mos := v_mos || (select number from public.production_orders where id = v_id);
  end loop;
  -- buys grouped by supplier, one PO each
  for v_sup in select i.supplier_id,
                      jsonb_agg(jsonb_build_object('item_id', x.item_id, 'qty', x.qty)) as lines,
                      bool_and(i.item_type = 'component') as all_components
                 from jsonb_to_recordset(p_lines) x(item_id int, qty numeric, need_date date)
                 join public.items i on i.id = x.item_id
                where not exists (select 1 from public.bom_lines b where b.parent_item_id = x.item_id) and x.qty > 0
                group by i.supplier_id loop
    if v_sup.supplier_id is null then raise exception 'An item has no preferred supplier'; end if;
    v_id := public.create_purchase_order(v_sup.supplier_id, case when v_sup.all_components then v_wks else v_wh end,
                                         v_sup.lines, true, 'Suggested by ' || p_source, p_source);
    v_pos := v_pos || (select number from public.purchase_orders where id = v_id);
  end loop;
  return jsonb_build_object('purchase_orders', to_jsonb(v_pos), 'production_orders', to_jsonb(v_mos));
end $$;

-- ---------- weekly demand history + forecast (wow: seasonality-aware) ----
create or replace function public.demand_forecast(p_item int, p_weeks_back int default 26, p_weeks_fwd int default 8)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.app_today(); v_hist jsonb; v_level numeric; v_trend numeric; v_fc jsonb := '[]';
        a numeric := 0.3; b numeric := 0.1; r record; v_first boolean := true; v_prev numeric; k int;
begin
  perform public.require_staff();
  -- Holt's double exponential smoothing on weekly usage
  for r in
    with wk as (select generate_series(0, p_weeks_back - 1) as k),
    u as (select floor((v_today - (t.ts at time zone 'America/Denver')::date - 1) / 7)::int as k, sum(-t.qty) used
            from public.inv_txns t where t.item_id = p_item and t.txn_type in ('sale','production_issue','return')
             and t.ts >= public.day_start(v_today - 7 * p_weeks_back) and t.ts < public.day_start(v_today) group by 1)
    select wk.k, v_today - 7 * (wk.k + 1) as week_start, coalesce(u.used, 0) as used
      from wk left join u on u.k = wk.k order by wk.k desc
  loop
    if v_first then v_level := r.used; v_trend := 0; v_first := false;
    else v_prev := v_level; v_level := a * r.used + (1 - a) * (v_level + v_trend); v_trend := b * (v_level - v_prev) + (1 - b) * v_trend; end if;
  end loop;

  select jsonb_agg(jsonb_build_object('week_start', week_start, 'qty', used) order by week_start) into v_hist from (
    with wk as (select generate_series(0, p_weeks_back - 1) as k),
    u as (select floor((v_today - (t.ts at time zone 'America/Denver')::date - 1) / 7)::int as k, sum(-t.qty) used
            from public.inv_txns t where t.item_id = p_item and t.txn_type in ('sale','production_issue','return')
             and t.ts >= public.day_start(v_today - 7 * p_weeks_back) and t.ts < public.day_start(v_today) group by 1)
    select v_today - 7 * (wk.k + 1) as week_start, coalesce(u.used, 0) as used from wk left join u on u.k = wk.k) x;

  for k in 1..p_weeks_fwd loop
    v_fc := v_fc || jsonb_build_object('week_start', v_today + 7 * (k - 1), 'qty', round(greatest(0, v_level + k * v_trend), 1));
  end loop;
  return jsonb_build_object('history', coalesce(v_hist, '[]'), 'forecast', v_fc,
                            'level', round(coalesce(v_level,0), 2), 'trend_per_week', round(coalesce(v_trend,0), 2));
end $$;

-- ---------- Action Center / dashboard ------------------------------------
create or replace function public.dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_today date := public.app_today(); k jsonb; alerts jsonb := '[]'; trend jsonb; r record;
begin
  perform public.require_staff();
  select jsonb_build_object(
    'today_sales', (select coalesce(sum(net_amount),0) from public.v_sales_lines where sale_date = v_today),
    'today_orders', (select count(distinct order_id) from public.v_sales_lines where sale_date = v_today),
    'mtd_net_sales', public.gl_sum('Sales Revenue', date_trunc('month', v_today)::date, v_today, 'credit')
                     - public.gl_sum('Sales Discounts', date_trunc('month', v_today)::date, v_today)
                     - public.gl_sum('Sales Returns & Allowances', date_trunc('month', v_today)::date, v_today),
    'mtd_cogs', public.gl_sum('Cost of Goods Sold', date_trunc('month', v_today)::date, v_today),
    'inventory_value', (select coalesce(round(sum(inv.qty * i.avg_cost),2),0) from public.inventory inv join public.items i on i.id = inv.item_id),
    'open_sales_orders', (select count(*) from public.sales_orders where status = 'Placed'),
    'open_sales_value', (select coalesce(sum(total),0) from public.sales_orders where status = 'Placed'),
    'backordered_items', (select count(*) from public.v_inventory_policy where backordered_qty > 0),
    'below_rop', (select count(*) from public.v_inventory_policy where needs_reorder),
    'late_pos', (select count(*) from public.purchase_orders where status in ('Sent','Partially Received') and expected_date < v_today),
    'open_pos', (select count(*) from public.purchase_orders where status in ('Sent','Partially Received')),
    'payables_due_7', (select coalesce(sum(balance),0) from public.v_payables where balance > 0.005 and due_date <= v_today + 7),
    'payables_overdue', (select coalesce(sum(balance),0) from public.v_payables where pay_status = 'Overdue'),
    'wip_orders', (select count(*) from public.production_orders where status = 'In Progress'),
    'planned_orders', (select count(*) from public.production_orders where status = 'Planned'),
    'quality_hold_units', (select coalesce(sum(on_hold),0) from public.v_item_stock)
  ) into k;

  -- prioritized action list
  for r in select * from public.v_inventory_policy where backordered_qty > 0 order by backordered_qty desc limit 5 loop
    alerts := alerts || jsonb_build_object('severity','high','type','backorder','item_id', r.item_id,
      'title', format('%s is backordered (%s %s short)', r.name, public.fq(r.backordered_qty), r.uom),
      'detail', format('Orders due now need %s, on hand %s. Est. available %s.', public.fq(r.allocated_due), public.fq(r.on_hand), coalesce(to_char(r.backorder_eta, 'Mon DD'),'—')),
      'link', '/inventory?item=' || r.item_id);
  end loop;
  for r in select po.id, po.number, s.name, po.expected_date from public.purchase_orders po join public.suppliers s on s.id = po.supplier_id
            where po.status in ('Sent','Partially Received') and po.expected_date < v_today order by po.expected_date limit 5 loop
    alerts := alerts || jsonb_build_object('severity','high','type','late_po',
      'title', format('%s from %s is %s days late', r.number, r.name, v_today - r.expected_date),
      'detail', format('Expected %s. Call the supplier or expedite.', to_char(r.expected_date, 'Mon DD')), 'link', '/purchasing/' || r.id);
  end loop;
  for r in select * from public.v_inventory_policy where needs_reorder and on_order = 0 order by days_of_supply nulls last limit 6 loop
    alerts := alerts || jsonb_build_object('severity','medium','type','reorder','item_id', r.item_id,
      'title', format('Reorder %s — %s %s', r.name, public.fq(r.suggested_qty), r.uom),
      'detail', format('Position %s ≤ ROP %s. %s days of supply left. %s', public.fq(r.position), public.fq(r.reorder_point), coalesce(public.fq(r.days_of_supply),'—'),
                       case when r.is_made then 'Build in-house.' else 'Buy from ' || coalesce(r.supplier_name,'?') end),
      'link', '/replenishment', 'qty', r.suggested_qty);
  end loop;
  for r in select * from public.v_payables where pay_status in ('Overdue','Due soon') order by due_date limit 4 loop
    alerts := alerts || jsonb_build_object('severity', case when r.pay_status = 'Overdue' then 'high' else 'low' end, 'type','payable',
      'title', format('Pay %s %s (%s)', r.supplier_name, to_char(r.balance, 'FM$999,999,990.00'), r.number),
      'detail', format('%s — due %s', r.pay_status, to_char(r.due_date, 'Mon DD')), 'link', '/purchasing/' || r.po_id);
  end loop;
  for r in select i.id, i.name, s.on_hold from public.v_item_stock s join public.items i on i.id = s.item_id where s.on_hold > 0 limit 3 loop
    alerts := alerts || jsonb_build_object('severity','low','type','quality',
      'title', format('%s unit(s) of %s in Quality Hold', public.fq(r.on_hold), r.name),
      'detail', 'Inspect: return to stock (transfer) or scrap (adjustment).', 'link', '/inventory?item=' || r.id);
  end loop;
  for r in select o.id, o.number, c.name, o.due_date from public.sales_orders o left join public.customers c on c.id = o.customer_id
            where o.status = 'Placed' and o.due_date <= v_today + 1 order by o.due_date limit 5 loop
    alerts := alerts || jsonb_build_object('severity', case when r.due_date < v_today then 'high' else 'medium' end, 'type','due_order',
      'title', format('%s for %s due %s', r.number, coalesce(r.name,'walk-in'), to_char(r.due_date, 'Mon DD')),
      'detail', 'Fulfill (pick) this order for pickup/shipping.', 'link', '/sales/' || r.id);
  end loop;

  select jsonb_agg(jsonb_build_object('date', d, 'net', coalesce(net,0)) order by d) into trend from (
    select gs::date d, (select sum(net_amount) from public.v_sales_lines where sale_date = gs::date) net
      from generate_series(v_today - 29, v_today, '1 day') gs) x;

  return jsonb_build_object('today', v_today, 'kpis', k, 'alerts', alerts, 'trend', trend);
end $$;
