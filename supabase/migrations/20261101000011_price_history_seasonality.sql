-- =====================================================================
-- Price & cost history + seasonal calendar for forecasting. Safe to re-run.
-- Every change to an item's selling price, purchase (standard) cost or
-- weighted-average cost is recorded with when, who and why.
-- =====================================================================
create table if not exists public.price_history (
  id          bigserial primary key,
  item_id     int not null references public.items(id) on delete cascade,
  field       text not null check (field in ('price','standard_cost','avg_cost')),
  old_value   numeric(12,4),
  new_value   numeric(12,4),
  changed_at  timestamptz not null default public.app_now(),
  changed_by  text,
  source      text
);
create index if not exists price_history_item on public.price_history (item_id, changed_at);
create index if not exists price_history_time on public.price_history (changed_at);
alter table public.price_history enable row level security;
drop policy if exists staff_read on public.price_history;
create policy staff_read on public.price_history for select to authenticated using (public.is_staff());
grant select on public.price_history to authenticated;

create or replace function public.log_item_prices() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_src text;
begin
  if tg_op = 'INSERT' then
    insert into public.price_history(item_id, field, old_value, new_value, changed_at, changed_by, source)
    values (new.id, 'price', null, new.price, public.app_now(), public.current_user_name(), 'Item created'),
           (new.id, 'standard_cost', null, new.standard_cost, public.app_now(), public.current_user_name(), 'Item created');
    return new;
  end if;
  if new.price is distinct from old.price then
    insert into public.price_history(item_id, field, old_value, new_value, changed_at, changed_by, source)
    values (new.id, 'price', old.price, new.price, public.app_now(), public.current_user_name(),
            coalesce(nullif(current_setting('app.change_source', true), ''), 'Price change'));
  end if;
  if new.standard_cost is distinct from old.standard_cost then
    -- a PO receipt in this same transaction sets the new purchase cost
    select 'Supplier cost on ' || po.number into v_src
      from public.po_receipts r join public.purchase_orders po on po.id = r.po_id
     where r.item_id = new.id and r.received_at = public.app_now() order by r.id desc limit 1;
    insert into public.price_history(item_id, field, old_value, new_value, changed_at, changed_by, source)
    values (new.id, 'standard_cost', old.standard_cost, new.standard_cost, public.app_now(), public.current_user_name(),
            coalesce(v_src, nullif(current_setting('app.change_source', true), ''), 'Cost change'));
  end if;
  if new.avg_cost is distinct from old.avg_cost then
    insert into public.price_history(item_id, field, old_value, new_value, changed_at, changed_by, source)
    values (new.id, 'avg_cost', old.avg_cost, new.avg_cost, public.app_now(), public.current_user_name(),
            'Weighted average recalculated');
  end if;
  return new;
end $$;

drop trigger if exists items_price_history on public.items;
create trigger items_price_history after insert or update of price, standard_cost, avg_cost on public.items
for each row execute function public.log_item_prices();

-- record today's values for any item that has no history yet (existing databases)
insert into public.price_history(item_id, field, old_value, new_value, changed_at, changed_by, source)
select i.id, f.field, null, case f.field when 'price' then i.price else i.standard_cost end, now(), 'System', 'Starting value'
  from public.items i cross join (values ('price'), ('standard_cost')) f(field)
 where not exists (select 1 from public.price_history h where h.item_id = i.id);

-- ---------- seasonal calendar (monthly demand index, 1.00 = normal) -------
insert into public.settings(key, value, label, description, sort) values
 ('season_m01', 1.25, 'Season index — January',   'Holiday tail / New-Year gifting', 20),
 ('season_m02', 0.80, 'Season index — February',  'Slow month', 21),
 ('season_m03', 0.85, 'Season index — March',     '', 22),
 ('season_m04', 0.90, 'Season index — April',     '', 23),
 ('season_m05', 1.00, 'Season index — May',       'Mother''s Day', 24),
 ('season_m06', 1.30, 'Season index — June',      'Wedding season', 25),
 ('season_m07', 1.35, 'Season index — July',      'Wedding season peak', 26),
 ('season_m08', 1.25, 'Season index — August',    'Wedding season', 27),
 ('season_m09', 0.95, 'Season index — September', '', 28),
 ('season_m10', 1.15, 'Season index — October',   'Holiday shopping begins', 29),
 ('season_m11', 1.40, 'Season index — November',  'Black Friday / Thanksgiving', 30),
 ('season_m12', 1.70, 'Season index — December',  'Christmas peak', 31)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
