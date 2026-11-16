-- =====================================================================
-- 1) Action Center tracking: when each alert appeared and when (and by
--    whom, where it can be traced) it was cleared.
-- 2) Promo codes for the customer portal.
-- 3) Monthly repeat (recurring) pickup orders.
-- Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------- 1) alerts
create table if not exists public.alert_log (
  id          bigserial primary key,
  key         text not null,
  type        text not null,
  severity    text,
  title       text not null,
  link        text,
  first_seen  timestamptz not null default public.app_now(),
  resolved_at timestamptz,
  resolved_by text,
  resolution  text
);
create unique index if not exists alert_log_open_key on public.alert_log (key) where resolved_at is null;
create index if not exists alert_log_resolved on public.alert_log (resolved_at);
alter table public.alert_log enable row level security;
drop policy if exists staff_read on public.alert_log;
create policy staff_read on public.alert_log for select to authenticated using (public.is_staff());
grant select on public.alert_log to authenticated;

-- alert identity: type + item (or the record the alert links to)
create or replace function public.alert_key(a jsonb) returns text language sql immutable as $$
  select (a->>'type') || ':' || coalesce(a->>'item_id', a->>'link', a->>'title')
$$;

-- Dashboard + tracking. Every open alert is remembered with the time it
-- first appeared; alerts that are no longer true are marked completed.
create or replace function public.action_center() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare d jsonb; v_today date; keys text[]; a jsonb; r record; who text; how text; at_ts timestamptz;
        v_id int; v_item int; v_alerts jsonb := '[]'; v_done jsonb;
begin
  perform public.require_staff();
  perform public.run_recurring_orders();
  d := public.dashboard();
  v_today := (d->>'today')::date;

  -- the COMPLETE set of conditions (the dashboard list itself is capped)
  select array_agg(k) into keys from (
    select 'backorder:' || item_id from public.v_inventory_policy where backordered_qty > 0
    union all select 'late_po:/purchasing/' || id from public.purchase_orders where status in ('Sent','Partially Received') and expected_date < v_today
    union all select 'reorder:' || item_id from public.v_inventory_policy where needs_reorder and on_order = 0
    union all select 'payable:/purchasing/' || po_id from public.v_payables where pay_status in ('Overdue','Due soon')
    union all select 'quality:/inventory?item=' || item_id from public.v_item_stock where on_hold > 0
    union all select 'due_order:/sales/' || id from public.sales_orders where status = 'Placed' and due_date <= v_today + 1
  ) s(k);
  keys := coalesce(keys, '{}');

  -- remember new alerts
  for a in select * from jsonb_array_elements(d->'alerts') loop
    insert into public.alert_log(key, type, severity, title, link, first_seen)
    values (public.alert_key(a), a->>'type', a->>'severity', a->>'title', a->>'link', public.app_now())
    on conflict (key) where resolved_at is null do update set title = excluded.title, severity = excluded.severity;
  end loop;

  -- close alerts whose condition is gone; find who/what cleared it when traceable
  for r in select * from public.alert_log where resolved_at is null and key <> all(keys) loop
    who := null; how := null; at_ts := null;
    v_id := nullif(substring(r.link from '/(?:purchasing|sales)/(\d+)'), '')::int;
    v_item := case when r.type in ('backorder','reorder') and split_part(r.key, ':', 2) ~ '^\d+$' then split_part(r.key, ':', 2)::int
                   else nullif(substring(r.link from 'item=(\d+)'), '')::int end;
    if r.type in ('late_po','payable') and v_id is not null then
      select user_name, message, ts into who, how, at_ts from public.activity_log
       where ref_type = 'purchase_order' and ref_id = v_id and ts >= r.first_seen order by ts desc limit 1;
    elsif r.type = 'due_order' and v_id is not null then
      select user_name, message, ts into who, how, at_ts from public.activity_log
       where ref_type = 'sales_order' and ref_id = v_id and ts >= r.first_seen order by ts desc limit 1;
    elsif r.type = 'reorder' and v_item is not null then
      select coalesce(po.created_by_name, 'System'), 'Ordered on ' || po.number, po.created_at into who, how, at_ts
        from public.purchase_orders po join public.po_lines pl on pl.po_id = po.id
       where pl.item_id = v_item and po.created_at >= r.first_seen order by po.created_at desc limit 1;
      if at_ts is null then
        select coalesce(m.created_by_name, 'System'), 'Build planned on ' || m.number, m.created_at into who, how, at_ts
          from public.production_orders m where m.item_id = v_item and m.created_at >= r.first_seen order by m.created_at desc limit 1;
      end if;
    elsif r.type in ('backorder','quality') and v_item is not null then
      select t.user_name, initcap(replace(t.txn_type, '_', ' ')) || coalesce(' ' || t.note, ''), t.ts into who, how, at_ts
        from public.inv_txns t where t.item_id = v_item and t.ts >= r.first_seen order by t.ts desc limit 1;
    end if;
    update public.alert_log set resolved_at = coalesce(at_ts, public.app_now()), resolved_by = who,
           resolution = coalesce(how, 'Condition cleared') where id = r.id;
  end loop;

  -- open alerts with "open since"
  select coalesce(jsonb_agg(x.al || jsonb_build_object('first_seen', l.first_seen)), '[]') into v_alerts
    from jsonb_array_elements(d->'alerts') as x(al)
    left join public.alert_log l on l.key = public.alert_key(x.al) and l.resolved_at is null;

  select coalesce(jsonb_agg(jsonb_build_object('title', title, 'type', type, 'severity', severity, 'link', link,
           'first_seen', first_seen, 'resolved_at', resolved_at, 'resolved_by', resolved_by, 'resolution', resolution,
           'minutes', round(extract(epoch from (resolved_at - first_seen)) / 60)) order by resolved_at desc), '[]')
    into v_done
    from public.alert_log
   where resolved_at >= public.day_start(v_today);

  return d || jsonb_build_object('alerts', v_alerts, 'completed_today', v_done);
end $$;
revoke execute on function public.action_center() from public, anon;
grant execute on function public.action_center() to authenticated;

-- ---------------------------------------------------------------- 2) promos
create table if not exists public.promo_codes (
  code        text primary key,               -- stored lowercase; matched case-insensitively
  label       text not null,
  kind        text not null check (kind in ('percent','amount')),
  value       numeric(10,2) not null check (value > 0),
  active      boolean not null default true,
  uses        int not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.promo_codes enable row level security;
drop policy if exists staff_read on public.promo_codes;
drop policy if exists staff_write on public.promo_codes;
create policy staff_read on public.promo_codes for select to authenticated using (public.is_staff());
create policy staff_write on public.promo_codes for all to authenticated using (public.is_staff()) with check (public.is_staff());
grant select, insert, update, delete on public.promo_codes to authenticated;
insert into public.promo_codes(code, label, kind, value) values
  ('tungtung',      'Tung Tung — 10% off',        'percent', 10),
  ('wrightthegoat', 'Wright the GOAT — 90% off',  'percent', 90),
  ('ced',           'CED Christmas gift — $25 off', 'amount', 25)
on conflict (code) do nothing;

alter table public.sales_orders add column if not exists promo_code text;

create or replace function public.check_promo(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('valid', true, 'code', code, 'label', label, 'kind', kind, 'value', value)
                     from public.promo_codes where code = lower(trim(p_code)) and active),
                  jsonb_build_object('valid', false))
$$;
revoke execute on function public.check_promo(text) from public, anon;
grant execute on function public.check_promo(text) to authenticated;

-- apply a promo to an order (as an order-level discount) and recalc totals
create or replace function public.apply_promo(p_order int, p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare p record; v_sub numeric; v_pct numeric;
begin
  select * into p from public.promo_codes where code = lower(trim(p_code)) and active;
  if p.code is null then raise exception 'Promo code "%" is not valid', p_code; end if;
  select coalesce(sum(round(qty * unit_price * (1 - discount_pct/100), 2)), 0) into v_sub from public.sales_order_lines where order_id = p_order;
  v_pct := case when p.kind = 'percent' then p.value
                else least(100, round(p.value / nullif(v_sub, 0) * 100, 3)) end;
  update public.sales_orders set discount_pct = coalesce(v_pct, 0), promo_code = p.code where id = p_order;
  perform public.recalc_sales_order(p_order);
  update public.promo_codes set uses = uses + 1 where code = p.code;
end $$;
revoke execute on function public.apply_promo(int, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 3) recurring
create table if not exists public.recurring_orders (
  id            serial primary key,
  customer_id   int not null references public.customers(id),
  location_id   int not null references public.locations(id),
  lines         jsonb not null,                -- [{item_id, qty}]
  day_of_month  int not null check (day_of_month between 1 and 28),
  next_date     date not null,
  active        boolean not null default true,
  last_order_id int references public.sales_orders(id),
  created_at    timestamptz not null default public.app_now()
);
alter table public.recurring_orders enable row level security;
drop policy if exists staff_read on public.recurring_orders;
drop policy if exists own_read on public.recurring_orders;
create policy staff_read on public.recurring_orders for select to authenticated using (public.is_staff());
create policy own_read on public.recurring_orders for select to authenticated using (customer_id = public.my_customer_id());
grant select on public.recurring_orders to authenticated;

create or replace function public.next_monthly(p_from date, p_day int) returns date language sql immutable as $$
  select (date_trunc('month', p_from) + interval '1 month')::date + (least(p_day, 28) - 1)
$$;

-- create the pickup order for every active subscription due within 7 days
create or replace function public.run_recurring_orders() returns int
language plpgsql security definer set search_path = public as $$
declare s record; v_id int; v_num text; n int := 0; v_today date := public.app_today(); v_due date;
begin
  for s in select * from public.recurring_orders where active and next_date <= v_today + 7 for update skip locked loop
    v_due := greatest(s.next_date, v_today);
    begin
      v_id := public.create_sales_order(s.customer_id, s.location_id, s.lines, 'WEB', 0, v_due, 'Monthly repeat order #' || s.id);
      update public.sales_orders set payment_method = 'Pay at pickup' where id = v_id returning number into v_num;
      update public.recurring_orders set last_order_id = v_id, next_date = public.next_monthly(v_due, day_of_month) where id = s.id;
      perform public.log_activity('sales', format('Repeat order %s created for %s', v_num,
        (select name from public.customers where id = s.customer_id)), 'sales_order', v_id);
      n := n + 1;
    exception when others then
      -- e.g. an item was discontinued: pause instead of failing every time
      update public.recurring_orders set active = false where id = s.id;
    end;
  end loop;
  return n;
end $$;
revoke execute on function public.run_recurring_orders() from public, anon;
grant execute on function public.run_recurring_orders() to authenticated;

create or replace function public.update_recurring(p_id int, p_active boolean default null, p_day int default null, p_cancel boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  select * into s from public.recurring_orders where id = p_id for update;
  if s.id is null then raise exception 'Repeat order not found'; end if;
  if not public.is_staff() and s.customer_id is distinct from public.my_customer_id() then raise exception 'Not allowed'; end if;
  if p_cancel then delete from public.recurring_orders where id = p_id; return; end if;
  if p_day is not null then
    if p_day < 1 or p_day > 28 then raise exception 'Pick a day between 1 and 28'; end if;
    update public.recurring_orders set day_of_month = p_day,
           next_date = case when public.app_today() + 7 < (date_trunc('month', public.app_today())::date + p_day - 1)
                            then date_trunc('month', public.app_today())::date + p_day - 1
                            else public.next_monthly(public.app_today(), p_day) end
     where id = p_id;
  end if;
  if p_active is not null then update public.recurring_orders set active = p_active where id = p_id; end if;
end $$;
revoke execute on function public.update_recurring(int, boolean, int, boolean) from public, anon;
grant execute on function public.update_recurring(int, boolean, int, boolean) to authenticated;

-- ---------------------------------------------------------------- portal order: promo + repeat
drop function if exists public.place_customer_order(int, jsonb, date, text);
drop function if exists public.place_customer_order(int, jsonb, date, text, boolean);
create or replace function public.place_customer_order(p_location int, p_lines jsonb, p_pickup date default null,
  p_notes text default null, p_pay_now boolean default false, p_promo text default null, p_repeat_monthly boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare v_cust int; v_id int; v_total numeric; v_num text; v_due date;
begin
  v_cust := public.my_customer_id();
  if v_cust is null then
    if public.is_staff() then raise exception 'Use Sales Orders to enter orders for customers'; end if;
    raise exception 'Your login is not linked to a customer account';
  end if;
  if not exists (select 1 from public.locations where id = p_location and pickup) then
    raise exception 'That location is not a pickup location';
  end if;
  v_due := greatest(coalesce(p_pickup, public.app_today() + 1), public.app_today());
  v_id := public.create_sales_order(v_cust, p_location, p_lines, 'WEB', 0, v_due, p_notes);
  if nullif(trim(coalesce(p_promo, '')), '') is not null then perform public.apply_promo(v_id, p_promo); end if;
  select total, number into v_total, v_num from public.sales_orders where id = v_id;
  if p_pay_now then
    perform public.gl_post('Cash', v_total, 0, 'Online prepayment ' || v_num, 'sales_order', v_id);
    perform public.gl_post('Customer Deposits', 0, v_total, 'Online prepayment ' || v_num, 'sales_order', v_id);
    update public.sales_orders set prepaid_amount = v_total, payment_method = 'Card (paid online)' where id = v_id;
    perform public.log_activity('sales', format('%s paid online ($%s) — pickup order', v_num, v_total), 'sales_order', v_id);
  else
    update public.sales_orders set payment_method = 'Pay at pickup' where id = v_id;
  end if;
  if p_repeat_monthly then
    insert into public.recurring_orders(customer_id, location_id, lines, day_of_month, next_date, last_order_id)
    select v_cust, p_location, jsonb_agg(jsonb_build_object('item_id', x.item_id, 'qty', x.qty)),
           least(extract(day from v_due)::int, 28), public.next_monthly(v_due, least(extract(day from v_due)::int, 28)), v_id
      from jsonb_to_recordset(p_lines) x(item_id int, qty numeric) where x.qty > 0;
    perform public.log_activity('sales', format('%s set up a monthly repeat order (day %s)',
      (select name from public.customers where id = v_cust), least(extract(day from v_due)::int, 28)), 'sales_order', v_id);
  end if;
  return v_id;
end $$;
revoke execute on function public.place_customer_order(int, jsonb, date, text, boolean, text, boolean) from public, anon;
grant execute on function public.place_customer_order(int, jsonb, date, text, boolean, text, boolean) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'recurring_orders') then
    alter publication supabase_realtime add table public.recurring_orders;
  end if;
end $$;
notify pgrst, 'reload schema';
