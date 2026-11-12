-- =====================================================================
-- Timpanogos Timber Co. ERP — core schema
-- All business numbers are derived from these tables (no static totals).
-- =====================================================================

-- ---------- Clock -------------------------------------------------------
-- Every business function uses app_now() instead of now().  Normally it is
-- just now(); the history generator (seed) sets app.sim_now so six months
-- of history are posted through the exact same functions the UI uses.
create or replace function public.app_now() returns timestamptz
language sql stable as $$
  select coalesce(nullif(current_setting('app.sim_now', true), '')::timestamptz, now())
$$;

create or replace function public.app_today() returns date
language sql stable as $$
  select (public.app_now() at time zone 'America/Denver')::date
$$;

-- ---------- Settings ----------------------------------------------------
create table public.settings (
  key          text primary key,
  value        numeric,
  text_value   text,
  label        text not null,
  description  text,
  sort         int default 0
);

-- ---------- Users / roles ----------------------------------------------
create table public.customers (
  id          serial primary key,
  name        text not null,
  email       text unique,
  phone       text,
  address     text,
  customer_type text not null default 'Retail' check (customer_type in ('Retail','Wholesale')),
  created_at  timestamptz not null default now()
);

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'customer' check (role in ('manager','staff','customer')),
  customer_id int references public.customers(id),
  created_at  timestamptz not null default now()
);

-- ---------- Master data -------------------------------------------------
create table public.locations (
  id        serial primary key,
  code      text unique not null,
  name      text not null,
  kind      text not null check (kind in ('production','warehouse','retail','quarantine')),
  sellable  boolean not null default true,   -- counts as available to customers
  pickup    boolean not null default false,  -- customers can pick up here
  address   text
);

create table public.suppliers (
  id                 serial primary key,
  name               text not null unique,
  contact_name       text,
  email              text,
  phone              text,
  address            text,
  lead_time_days     int  not null check (lead_time_days >= 0),      -- quoted
  payment_terms_days int  not null default 30 check (payment_terms_days >= 0),
  notes              text,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

create table public.items (
  id               serial primary key,
  sku              text unique not null,
  barcode          text unique not null,
  name             text not null,
  description      text,
  category         text not null,
  item_type        text not null check (item_type in ('finished','component','resale')),
  uom              text not null default 'ea',
  standard_cost    numeric(12,4) not null default 0,  -- last quoted purchase cost (or rolled-up std for made items)
  avg_cost         numeric(12,4) not null default 0,  -- perpetual weighted-average cost
  price            numeric(12,2) not null default 0,
  lead_time_days   int not null default 7,            -- purchase or production lead time
  supplier_id      int references public.suppliers(id),
  sellable         boolean not null default true,
  reorder_point_override int,                           -- null = use computed ROP
  safety_stock_override  numeric(12,2),
  min_order_qty    numeric(12,2) not null default 1,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

create table public.bom_lines (
  id                serial primary key,
  parent_item_id    int not null references public.items(id) on delete cascade,
  component_item_id int not null references public.items(id),
  qty_per           numeric(12,4) not null check (qty_per > 0),
  unique (parent_item_id, component_item_id),
  check (parent_item_id <> component_item_id)
);

create table public.reason_codes (
  code        text primary key,
  description text not null,
  category    text not null check (category in ('adjustment','return','quality','scrap'))
);

-- ---------- Inventory ---------------------------------------------------
create table public.inventory (
  item_id     int not null references public.items(id) on delete cascade,
  location_id int not null references public.locations(id),
  qty         numeric(12,3) not null default 0 check (qty >= 0),
  updated_at  timestamptz not null default now(),
  primary key (item_id, location_id)
);

create table public.inv_txns (
  id          bigserial primary key,
  ts          timestamptz not null default public.app_now(),
  item_id     int not null references public.items(id),
  location_id int not null references public.locations(id),
  qty         numeric(12,3) not null,         -- signed: + in, - out
  unit_cost   numeric(12,4) not null,          -- cost per unit at which the movement was valued
  txn_type    text not null check (txn_type in
              ('sale','return','receipt','transfer_in','transfer_out','adjustment',
               'production_issue','production_receipt','opening')),
  reason_code text references public.reason_codes(code),
  ref_type    text,
  ref_id      int,
  note        text,
  user_id     uuid,
  user_name   text
);
create index on public.inv_txns (item_id, ts);
create index on public.inv_txns (ts);
create index on public.inv_txns (txn_type, ts);

-- ---------- General ledger (drives P&L) ---------------------------------
create table public.gl_entries (
  id        bigserial primary key,
  ts        timestamptz not null default public.app_now(),
  account   text not null,
  debit     numeric(14,2) not null default 0,
  credit    numeric(14,2) not null default 0,
  memo      text,
  ref_type  text,
  ref_id    int
);
create index on public.gl_entries (account, ts);
create index on public.gl_entries (ts);

-- ---------- Sales -------------------------------------------------------
create table public.sales_orders (
  id            serial primary key,
  number        text unique not null,
  source        text not null check (source in ('POS','SO','WEB','EXCHANGE')),
  customer_id   int references public.customers(id),
  location_id   int not null references public.locations(id),
  status        text not null default 'Placed' check (status in ('Placed','Fulfilled','Closed','Cancelled')),
  order_date    timestamptz not null default public.app_now(),
  due_date      date not null default public.app_today(),
  fulfilled_at  timestamptz,
  closed_at     timestamptz,
  cancelled_at  timestamptz,
  discount_pct  numeric(6,3) not null default 0,     -- order-level discount %
  subtotal      numeric(12,2) not null default 0,     -- sum of line gross (qty*price)
  discount      numeric(12,2) not null default 0,     -- line + order discounts
  tax           numeric(12,2) not null default 0,
  total         numeric(12,2) not null default 0,
  cogs          numeric(12,2) not null default 0,     -- set at fulfillment
  payment_method text,
  notes         text,
  created_by    uuid,
  created_by_name text
);
create index on public.sales_orders (status);
create index on public.sales_orders (order_date);

create table public.sales_order_lines (
  id            serial primary key,
  order_id      int not null references public.sales_orders(id) on delete cascade,
  item_id       int not null references public.items(id),
  qty           numeric(12,3) not null check (qty > 0),
  unit_price    numeric(12,2) not null,
  discount_pct  numeric(6,3) not null default 0,
  net_amount    numeric(12,2) not null default 0,    -- after line AND order discount, before tax
  tax_amount    numeric(12,2) not null default 0,
  unit_cost     numeric(12,4),                       -- weighted avg cost at fulfillment
  qty_returned  numeric(12,3) not null default 0
);
create index on public.sales_order_lines (item_id);

-- ---------- Returns & exchanges ----------------------------------------
create table public.returns (
  id              serial primary key,
  number          text unique not null,
  sales_order_id  int not null references public.sales_orders(id),
  kind            text not null check (kind in ('Return','Exchange')),
  ts              timestamptz not null default public.app_now(),
  refund_amount   numeric(12,2) not null default 0,  -- incl. tax, paid to customer
  exchange_order_id int references public.sales_orders(id),
  net_due_from_customer numeric(12,2) not null default 0, -- exchange: + customer pays, - refund
  notes           text,
  created_by_name text
);
create table public.return_lines (
  id            serial primary key,
  return_id     int not null references public.returns(id) on delete cascade,
  so_line_id    int not null references public.sales_order_lines(id),
  item_id       int not null references public.items(id),
  qty           numeric(12,3) not null check (qty > 0),
  reason_code   text not null references public.reason_codes(code),
  disposition   text not null check (disposition in ('Restock','Quality Hold')),
  location_id   int not null references public.locations(id),
  refund_net    numeric(12,2) not null,
  refund_tax    numeric(12,2) not null,
  unit_cost     numeric(12,4) not null
);

-- ---------- Purchasing --------------------------------------------------
create table public.purchase_orders (
  id            serial primary key,
  number        text unique not null,
  supplier_id   int not null references public.suppliers(id),
  location_id   int not null references public.locations(id),
  status        text not null default 'Draft' check (status in ('Draft','Sent','Partially Received','Received','Closed','Cancelled')),
  created_at    timestamptz not null default public.app_now(),
  order_date    date,           -- date sent to supplier
  expected_date date,           -- order_date + supplier quoted lead time
  quoted_lead_days int,         -- snapshot of supplier lead time when sent
  first_receipt_date date,
  last_receipt_date  date,
  closed_at     timestamptz,
  notes         text,
  source        text default 'Manual',
  created_by_name text
);
create index on public.purchase_orders (status);
create index on public.purchase_orders (supplier_id);

create table public.po_lines (
  id           serial primary key,
  po_id        int not null references public.purchase_orders(id) on delete cascade,
  item_id      int not null references public.items(id),
  qty_ordered  numeric(12,3) not null check (qty_ordered > 0),
  qty_received numeric(12,3) not null default 0,
  unit_cost    numeric(12,4) not null
);

create table public.po_receipts (
  id           serial primary key,
  po_id        int not null references public.purchase_orders(id),
  po_line_id   int not null references public.po_lines(id),
  item_id      int not null references public.items(id),
  location_id  int not null references public.locations(id),
  qty          numeric(12,3) not null check (qty > 0),
  unit_cost    numeric(12,4) not null,
  received_at  timestamptz not null default public.app_now(),
  received_by_name text
);

create table public.supplier_payments (
  id        serial primary key,
  po_id     int not null references public.purchase_orders(id),
  amount    numeric(12,2) not null check (amount > 0),
  paid_at   timestamptz not null default public.app_now(),
  method    text default 'ACH',
  created_by_name text
);

-- ---------- Production --------------------------------------------------
create table public.production_orders (
  id             serial primary key,
  number         text unique not null,
  item_id        int not null references public.items(id),
  location_id    int not null references public.locations(id),
  status         text not null default 'Planned' check (status in ('Planned','In Progress','Completed','Cancelled')),
  qty_planned    numeric(12,3) not null check (qty_planned > 0),
  qty_started    numeric(12,3) not null default 0,
  qty_good       numeric(12,3) not null default 0,
  qty_scrapped   numeric(12,3) not null default 0,
  qty_reworked   numeric(12,3) not null default 0,   -- subset of good that needed rework
  quality_reason text references public.reason_codes(code),
  created_at     timestamptz not null default public.app_now(),
  due_date       date,
  started_at     timestamptz,
  finished_at    timestamptz,
  component_cost numeric(12,2) not null default 0,   -- actual cost of components issued
  unit_cost      numeric(12,4),                      -- rolled-up cost per unit started
  notes          text,
  source         text default 'Manual',
  created_by_name text
);
create index on public.production_orders (status);

create table public.production_issues (
  id            serial primary key,
  production_order_id int not null references public.production_orders(id) on delete cascade,
  item_id       int not null references public.items(id),
  qty           numeric(12,3) not null,
  unit_cost     numeric(12,4) not null
);

-- ---------- Document numbering -----------------------------------------
create sequence public.so_seq  start 10001;
create sequence public.pos_seq start 50001;
create sequence public.po_seq  start 3001;
create sequence public.mo_seq  start 7001;
create sequence public.rt_seq  start 901;

-- ---------- Activity feed (who did what, live for all users) ------------
create table public.activity_log (
  id        bigserial primary key,
  ts        timestamptz not null default public.app_now(),
  user_name text,
  kind      text not null,
  message   text not null,
  ref_type  text,
  ref_id    int
);
create index on public.activity_log (ts desc);
