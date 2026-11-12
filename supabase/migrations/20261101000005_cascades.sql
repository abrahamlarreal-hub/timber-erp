-- Changing a supplier's quoted lead time flows to every item bought from it,
-- so reorder points, safety stock, MRP order-by dates and ETAs recompute live.
create or replace function public.sync_supplier_lead_time() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.lead_time_days is distinct from old.lead_time_days then
    update public.items set lead_time_days = new.lead_time_days
     where supplier_id = new.id and item_type <> 'finished';
    perform public.log_activity('purchasing', format('%s quoted lead time changed %s → %s days', new.name, old.lead_time_days, new.lead_time_days));
  end if;
  return new;
end $$;
create trigger supplier_lead_time_sync after update on public.suppliers
for each row execute function public.sync_supplier_lead_time();

-- Re-create profiles for existing logins (used after a data reset)
create or replace function public.backfill_profiles() returns int
language plpgsql security definer set search_path = public as $$
declare u record; n int := 0; v_role text; v_cust int; v_name text; v_code text;
begin
  for u in select * from auth.users au where not exists (select 1 from public.profiles p where p.id = au.id) loop
    v_code := u.raw_user_meta_data->>'access_code';
    v_name := coalesce(nullif(u.raw_user_meta_data->>'full_name',''), split_part(u.email,'@',1));
    v_role := case when v_code = (select text_value from public.settings where key = 'manager_access_code') then 'manager'
                   when v_code = (select text_value from public.settings where key = 'staff_access_code') then 'staff'
                   else 'customer' end;
    v_cust := null;
    if v_role = 'customer' then
      select id into v_cust from public.customers where lower(email) = lower(u.email);
      if v_cust is null then
        insert into public.customers(name, email, customer_type) values (v_name, u.email, 'Retail') returning id into v_cust;
      end if;
    end if;
    insert into public.profiles(id, email, full_name, role, customer_id) values (u.id, u.email, v_name, v_role, v_cust);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.backfill_profiles() from public, anon, authenticated;
