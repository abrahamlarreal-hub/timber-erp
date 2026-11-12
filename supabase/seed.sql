-- =====================================================================
-- Timpanogos Timber Co. — starting data + ~6.5 months of generated history
-- The history is produced by SIMULATING the business day by day through the
-- same database functions the app uses (POS, sales orders, POs, receipts,
-- production orders, returns, adjustments, payments).  That guarantees the
-- ledger, inventory, costs and reports are all consistent with each other.
-- Demand varies by item, weekday (closed Sundays), month/holiday seasonality
-- and a gentle growth trend, so ROP / EOQ values are realistic.
-- =====================================================================

-- ---------------------------------------------------------------- settings
insert into public.settings(key, value, text_value, label, description, sort) values
 ('company_name', null, 'Timpanogos Timber Co.', 'Company name', 'Shown on receipts and reports', 1),
 ('tax_rate', 0.0725, null, 'Sales tax rate', 'Utah County combined sales tax (decimal)', 2),
 ('ordering_cost', 45, null, 'Ordering cost (S) per order', 'Cost to place and receive one purchase/production order ($) — used in EOQ', 3),
 ('holding_cost_rate', 0.25, null, 'Annual holding cost rate (H %)', 'Carrying cost as a fraction of unit cost per year — used in EOQ', 4),
 ('service_level_z', 1.65, null, 'Service level z-score', 'Safety stock = z × σ(daily usage) × √lead time  (1.65 ≈ 95% service)', 5),
 ('review_period_days', 14, null, 'Periodic review interval (days)', 'Order-up-to level = avg usage × (review period + lead time) + safety stock', 6),
 ('history_days', 180, null, 'Usage history window (days)', 'How many days of transaction history drive average usage', 7),
 ('staff_access_code', null, 'TIMBER-STAFF', 'Employee sign-up code', 'Entered at sign-up to create a staff login', 8),
 ('manager_access_code', null, 'TIMBER-MGR', 'Manager sign-up code', 'Entered at sign-up to create a manager login', 9);

-- ---------------------------------------------------------------- reason codes
insert into public.reason_codes(code, description, category) values
 ('CC',        'Cycle count variance',                 'adjustment'),
 ('DMG',       'Damaged in storage / handling',        'adjustment'),
 ('SHRINK',    'Shrinkage — unexplained loss',          'adjustment'),
 ('FOUND',     'Found stock',                           'adjustment'),
 ('SAMPLE',    'Used as display / marketing sample',    'adjustment'),
 ('QA-SCRAP',  'Scrapped after quality inspection',     'adjustment'),
 ('CHG',       'Customer changed mind',                 'return'),
 ('GIFT',      'Unwanted gift',                         'return'),
 ('WRONG',     'Wrong item / size ordered',             'return'),
 ('QF-CRACK',  'Quality failure — crack or split in wood', 'quality'),
 ('QF-FINISH', 'Quality failure — finish defect',       'quality'),
 ('QF-WARP',   'Quality failure — warped / not flat',   'quality'),
 ('QF-HW',     'Quality failure — hardware defect',     'quality'),
 ('SC-CUT',    'Production — miscut / wrong dimension', 'quality'),
 ('SC-KNOT',   'Production — knot or defect in lumber', 'quality'),
 ('SC-GLUE',   'Production — glue joint failure',       'quality'),
 ('RW-SAND',   'Production rework — re-sanded',         'quality'),
 ('RW-FIN',    'Production rework — refinished',        'quality');

-- ---------------------------------------------------------------- locations
insert into public.locations(code, name, kind, sellable, pickup, address) values
 ('WKS',   'Orem Workshop',            'production', true,  false, '1180 S 1680 W, Orem, UT'),
 ('WH',    'Lindon Warehouse',         'warehouse',  true,  true,  '455 N Geneva Rd, Lindon, UT'),
 ('STORE', 'Provo Center Street Store','retail',     true,  true,  '62 W Center St, Provo, UT'),
 ('QA',    'Quality Hold',             'quarantine', false, false, 'Workshop inspection cage');

-- ---------------------------------------------------------------- suppliers
insert into public.suppliers(name, contact_name, email, phone, address, lead_time_days, payment_terms_days, notes) values
 ('Wasatch Hardwoods',          'Dale Christensen', 'orders@wasatchhardwoods.example',  '(801) 555-0141', '2210 S 900 W, Salt Lake City, UT', 7,  30, 'Kiln-dried walnut, maple, cherry'),
 ('Utah Lumber Supply',         'Maria Gonzalez',   'sales@utahlumber.example',         '(801) 555-0177', '880 E 800 N, Spanish Fork, UT',   5,  15, 'Oak and pine dimensional lumber'),
 ('Bonneville Finishing Supply','Ken Yamada',       'ken@bonnevillefinish.example',     '(385) 555-0122', '41 W 4800 S, Murray, UT',          10, 30, 'Oils, finishes, abrasives, glue'),
 ('Beehive Apiary Co.',         'Janet Holt',       'janet@beehiveapiary.example',      '(435) 555-0190', '15 Orchard Ln, Santaquin, UT',     14, 30, 'Local beeswax — small producer'),
 ('Fastener Depot',             'Tyler Brooks',     'tbrooks@fastenerdepot.example',    '(801) 555-0108', '1550 W 2100 S, West Valley, UT',   4,  15, 'Screws, pads, dowels, hangers'),
 ('Summit Packaging',           'Rachel Kim',       'rkim@summitpack.example',          '(208) 555-0163', '300 Industrial Way, Boise, ID',     12, 60, 'Gift boxes, tins, labels, ribbon'),
 ('Provo Hardware Wholesale',   'Sam Peterson',     'sam@provohardware.example',        '(801) 555-0155', '1400 N State St, Provo, UT',       6,  30, 'Brackets, handles, resale tools');

-- ---------------------------------------------------------------- items
-- barcode = 12-digit UPC-A style number with a valid check digit
create or replace function pg_temp.upc(p11 text) returns text language sql immutable as $$
  select p11 || ((10 - ((
      3 * (substr(p11,1,1)::int + substr(p11,3,1)::int + substr(p11,5,1)::int + substr(p11,7,1)::int + substr(p11,9,1)::int + substr(p11,11,1)::int)
        + (substr(p11,2,1)::int + substr(p11,4,1)::int + substr(p11,6,1)::int + substr(p11,8,1)::int + substr(p11,10,1)::int)
    ) % 10)) % 10)::text
$$;

create temp table seed_items (n int, sku text, name text, descr text, category text, item_type text, uom text,
  cost numeric, price numeric, lt int, supplier text, sellable boolean, moq numeric);
insert into seed_items values
 -- finished goods (made in-house; lead time = production days)
 (1,'TTC-CB-WAL','Walnut Cutting Board 12×18','Edge-grain black walnut board, oiled & waxed','Cutting Boards','finished','ea',0,89,2,null,true,1),
 (2,'TTC-CB-MAP','Maple Cutting Board 12×18','Edge-grain hard maple board, oiled & waxed','Cutting Boards','finished','ea',0,69,2,null,true,1),
 (3,'TTC-CHB-CHR','Cherry Charcuterie Board','Cherry serving board with brass handle','Serving Boards','finished','ea',0,79,2,null,true,1),
 (4,'TTC-STL-PIN','Pine Step Stool','Two-step pine stool, poly finish','Home Goods','finished','ea',0,59,3,null,true,1),
 (5,'TTC-SHF-OAK','Oak Floating Shelf 36"','Red oak floating shelf with iron brackets','Home Goods','finished','ea',0,119,3,null,true,1),
 (6,'TTC-BB-4OZ','Board Butter 4 oz','Mineral oil + beeswax conditioner in a tin','Care Products','finished','ea',0,14,1,null,true,1),
 (7,'TTC-GS-MAP','Maple Board Gift Set','Kit: maple board + board butter, gift-boxed with twine','Gift Sets','finished','ea',0,99,1,null,true,1),
 -- resale (bought finished, sold as-is)
 (8,'TTC-R-SCRP','Stainless Bench Scraper','6" stainless steel scraper with walnut handle','Kitchen Tools','resale','ea',5.40,16,6,'Provo Hardware Wholesale',true,6),
 (9,'TTC-R-SHRP','Knife Sharpener','Two-stage pull-through knife sharpener','Kitchen Tools','resale','ea',11.25,29,6,'Provo Hardware Wholesale',true,6),
 -- purchased components
 (10,'RM-WAL-84','Walnut Lumber 8/4','Kiln-dried black walnut, 8/4, per board foot','Lumber','component','bd ft',14.50,0,7,'Wasatch Hardwoods',false,20),
 (11,'RM-MAP-84','Hard Maple Lumber 8/4','Kiln-dried hard maple, 8/4, per board foot','Lumber','component','bd ft',7.25,0,7,'Wasatch Hardwoods',false,20),
 (12,'RM-CHR-44','Cherry Lumber 4/4','Kiln-dried cherry, 4/4, per board foot','Lumber','component','bd ft',9.80,0,7,'Wasatch Hardwoods',false,20),
 (13,'RM-OAK-44','Red Oak Lumber 4/4','Red oak, 4/4, per board foot','Lumber','component','bd ft',6.40,0,5,'Utah Lumber Supply',false,20),
 (14,'RM-PIN-112','Pine Board 1×12×8''','Select pine board 1×12, 8 ft','Lumber','component','ea',18.00,0,5,'Utah Lumber Supply',false,5),
 (15,'RM-OIL-16','Food-Grade Mineral Oil 16 oz','USP food-grade mineral oil, 16 oz bottle','Finishes','component','bottle',6.50,12.99,10,'Bonneville Finishing Supply',true,12),
 (16,'RM-WAX-1LB','Beeswax Block 1 lb','Local yellow beeswax block','Finishes','component','block',9.00,16.99,14,'Beehive Apiary Co.',true,5),
 (17,'RM-FEET-4','Rubber Feet (4-pack)','Non-slip rubber feet with screws, pack of 4','Hardware','component','pack',1.20,0,4,'Fastener Depot',false,25),
 (18,'RM-SCRW-100','Wood Screws #8×1¼" (100)','Box of 100 wood screws','Hardware','component','box',7.50,0,4,'Fastener Depot',false,2),
 (19,'RM-GLUE-16','Waterproof Wood Glue 16 oz','Type-I waterproof wood glue','Finishes','component','bottle',5.75,0,10,'Bonneville Finishing Supply',false,4),
 (20,'RM-SAND-DSC','Sanding Discs 120/220','5" hook-and-loop sanding disc','Abrasives','component','ea',0.45,0,10,'Bonneville Finishing Supply',false,100),
 (21,'RM-KEYH-PR','Keyhole Hangers (pair)','Flush-mount keyhole hangers, pair','Hardware','component','pair',2.10,0,4,'Fastener Depot',false,10),
 (22,'RM-BRKT-PR','Iron Shelf Brackets (pair)','Black iron hidden shelf brackets, pair','Hardware','component','pair',11.50,0,6,'Provo Hardware Wholesale',false,5),
 (23,'PK-BOX-LG','Kraft Gift Box','Large kraft gift box with insert','Packaging','component','ea',3.25,0,12,'Summit Packaging',false,25),
 (24,'PK-TWINE-YD','Jute Twine Ribbon','Natural jute twine, per yard','Packaging','component','yd',0.30,0,12,'Summit Packaging',false,50),
 (25,'PK-TIN-4OZ','Metal Tin 4 oz with Lid','Screw-top tin for board butter','Packaging','component','ea',0.85,0,12,'Summit Packaging',false,50),
 (26,'PK-LABEL','Brand Label Sticker','Timpanogos Timber logo label','Packaging','component','ea',0.18,0,12,'Summit Packaging',false,100),
 (27,'RM-HNDL-BR','Brass Pull Handle','Solid brass pull handle for serving boards','Hardware','component','ea',4.80,0,6,'Provo Hardware Wholesale',false,10),
 (28,'RM-POLY-QT','Water-Based Polyurethane (qt)','Satin water-based poly, quart','Finishes','component','qt',14.00,0,10,'Bonneville Finishing Supply',false,2),
 (29,'RM-FELT-8','Felt Pads (8-pack)','Adhesive felt furniture pads','Hardware','component','pack',1.10,0,4,'Fastener Depot',false,25),
 (30,'RM-DOWEL-50','Hardwood Dowel Pins (50)','3/8" fluted dowel pins, bag of 50','Hardware','component','bag',3.20,0,4,'Fastener Depot',false,5),
 (31,'TTC-CST-WAL','Walnut Coaster Set (4)','NEW for the holidays: four walnut coasters with cork backs','Gift Sets','finished','set',0,34,1,null,true,1),
 (32,'PK-CORK-4','Cork Backing Disc 4"','Adhesive cork disc for coasters','Packaging','component','ea',0.35,0,12,'Summit Packaging',false,100);

insert into public.items(sku, barcode, name, description, category, item_type, uom, standard_cost, price, lead_time_days,
                         supplier_id, sellable, min_order_qty)
select s.sku, pg_temp.upc('8500127' || lpad(s.n::text, 4, '0')), s.name, s.descr, s.category, s.item_type, s.uom,
       s.cost, s.price, s.lt, (select id from public.suppliers where name = s.supplier), s.sellable, s.moq
  from seed_items s order by s.n;

-- ---------------------------------------------------------------- bills of material
insert into public.bom_lines(parent_item_id, component_item_id, qty_per)
select p.id, c.id, x.q from (values
  ('TTC-CB-WAL','RM-WAL-84',3.0),('TTC-CB-WAL','RM-OIL-16',0.15),('TTC-CB-WAL','RM-WAX-1LB',0.05),('TTC-CB-WAL','RM-FEET-4',1),('TTC-CB-WAL','RM-SAND-DSC',3),('TTC-CB-WAL','PK-LABEL',1),
  ('TTC-CB-MAP','RM-MAP-84',3.0),('TTC-CB-MAP','RM-OIL-16',0.15),('TTC-CB-MAP','RM-WAX-1LB',0.05),('TTC-CB-MAP','RM-FEET-4',1),('TTC-CB-MAP','RM-SAND-DSC',3),('TTC-CB-MAP','PK-LABEL',1),
  ('TTC-CHB-CHR','RM-CHR-44',2.5),('TTC-CHB-CHR','RM-HNDL-BR',1),('TTC-CHB-CHR','RM-OIL-16',0.12),('TTC-CHB-CHR','RM-SAND-DSC',3),('TTC-CHB-CHR','PK-LABEL',1),
  ('TTC-STL-PIN','RM-PIN-112',1),('TTC-STL-PIN','RM-SCRW-100',0.16),('TTC-STL-PIN','RM-GLUE-16',0.08),('TTC-STL-PIN','RM-POLY-QT',0.1),('TTC-STL-PIN','RM-FELT-8',1),('TTC-STL-PIN','RM-SAND-DSC',4),('TTC-STL-PIN','RM-DOWEL-50',0.1),
  ('TTC-SHF-OAK','RM-OAK-44',4),('TTC-SHF-OAK','RM-BRKT-PR',1),('TTC-SHF-OAK','RM-KEYH-PR',1),('TTC-SHF-OAK','RM-SCRW-100',0.08),('TTC-SHF-OAK','RM-POLY-QT',0.15),('TTC-SHF-OAK','RM-SAND-DSC',4),('TTC-SHF-OAK','RM-DOWEL-50',0.12),
  ('TTC-BB-4OZ','RM-OIL-16',0.2),('TTC-BB-4OZ','RM-WAX-1LB',0.06),('TTC-BB-4OZ','PK-TIN-4OZ',1),('TTC-BB-4OZ','PK-LABEL',1),
  ('TTC-CST-WAL','RM-WAL-84',1.0),('TTC-CST-WAL','PK-CORK-4',4),('TTC-CST-WAL','RM-OIL-16',0.05),('TTC-CST-WAL','PK-LABEL',1),
  ('TTC-GS-MAP','TTC-CB-MAP',1),('TTC-GS-MAP','TTC-BB-4OZ',1),('TTC-GS-MAP','PK-BOX-LG',1),('TTC-GS-MAP','PK-TWINE-YD',1.5),('TTC-GS-MAP','PK-LABEL',1)
) x(p, c, q) join public.items p on p.sku = x.p join public.items c on c.sku = x.c;

-- rolled-up standard cost for made items (two passes handle the gift set)
update public.items i set standard_cost = r.cost from (
  select b.parent_item_id, sum(b.qty_per * c.standard_cost) cost from public.bom_lines b join public.items c on c.id = b.component_item_id group by 1) r
 where r.parent_item_id = i.id;
update public.items i set standard_cost = r.cost from (
  select b.parent_item_id, sum(b.qty_per * c.standard_cost) cost from public.bom_lines b join public.items c on c.id = b.component_item_id group by 1) r
 where r.parent_item_id = i.id;

-- ---------------------------------------------------------------- customers
insert into public.customers(name, email, phone, address, customer_type) values
 ('Emily Carter',            'emily.carter@example.com',   '(801) 555-0201', '1450 N 200 E, Provo, UT',        'Retail'),
 ('Jacob Nielsen',           'jacob.nielsen@example.com',  '(801) 555-0202', '880 S State St, Orem, UT',       'Retail'),
 ('Hannah Whitaker',         'hannah.w@example.com',       '(385) 555-0203', '322 E 900 N, Lindon, UT',        'Retail'),
 ('Michael Torres',          'm.torres@example.com',       '(801) 555-0204', '77 W 500 S, Springville, UT',    'Retail'),
 ('Sarah Jensen',            'sarah.jensen@example.com',   '(801) 555-0205', '2100 N Canyon Rd, Provo, UT',    'Retail'),
 ('David Kim',               'david.kim@example.com',      '(385) 555-0206', '560 E 1200 S, Orem, UT',         'Retail'),
 ('Rebecca Lund',            'rlund@example.com',          '(801) 555-0207', '15 S Main St, American Fork, UT','Retail'),
 ('Joshua Allred',           'josh.allred@example.com',    '(801) 555-0208', '940 W 800 N, Pleasant Grove, UT','Retail'),
 ('Provo Kitchen Co.',       'buying@provokitchen.example','(801) 555-0301', '255 N University Ave, Provo, UT','Wholesale'),
 ('Sundance Mountain Gifts', 'gifts@sundancemtn.example',  '(801) 555-0302', '8841 N Alpine Loop Rd, Sundance, UT','Wholesale'),
 ('Heber Valley Mercantile', 'orders@hebermerc.example',   '(435) 555-0303', '90 N Main St, Heber City, UT',   'Wholesale'),
 ('Orem Home & Hearth',      'purchasing@oremhh.example',  '(801) 555-0304', '1300 S State St, Orem, UT',      'Wholesale');

-- ---------------------------------------------------------------- demo logins
-- password for every demo login: Timber2026!
do $$
declare u record; v_id uuid;
begin
  -- re-runnable: drop old demo logins first
  delete from auth.users where email in ('manager@timpanogostimber.com','sales@timpanogostimber.com','shop@timpanogostimber.com','emily.carter@example.com');
  for u in select * from (values
      ('manager@timpanogostimber.com', 'Morgan Reyes',  'TIMBER-MGR'),
      ('sales@timpanogostimber.com',   'Jordan Lee',    'TIMBER-STAFF'),
      ('shop@timpanogostimber.com',    'Taylor Brooks', 'TIMBER-STAFF'),
      ('emily.carter@example.com',     'Emily Carter',  null)) x(email, full_name, code) loop
    v_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', u.email,
            extensions.crypt('Timber2026!', extensions.gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}',
            jsonb_strip_nulls(jsonb_build_object('full_name', u.full_name, 'access_code', u.code)),
            now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_id, v_id::text,
            jsonb_build_object('sub', v_id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now());
  end loop;
end $$;

-- =====================================================================
-- SIMULATION
-- =====================================================================
create or replace function pg_temp.rpois(lambda numeric) returns int language plpgsql volatile as $$
declare l float8; k int := 0; p float8 := 1;
begin
  if lambda is null or lambda <= 0 then return 0; end if;
  if lambda > 30 then return greatest(0, round(lambda + sqrt(lambda) * sqrt(-2*ln(greatest(random(),1e-9))) * cos(2*pi()*random())))::int; end if;
  l := exp(-lambda::float8);
  loop k := k + 1; p := p * random(); exit when p <= l; end loop;
  return k - 1;
end $$;

create or replace function pg_temp.rnorm() returns float8 language sql volatile as $$
  select sqrt(-2 * ln(greatest(random(), 1e-9))) * cos(2 * pi() * random())
$$;

create or replace function pg_temp.binom(n numeric, p float8) returns int language plpgsql volatile as $$
declare k int := 0; i int;
begin
  for i in 1..coalesce(n,0)::int loop if random() < p then k := k + 1; end if; end loop;
  return k;
end $$;

create or replace function pg_temp.at(d date, h float8) returns timestamptz language sql immutable as $$
  select (d::timestamp + make_interval(secs => h * 3600)) at time zone 'America/Denver'
$$;

create or replace function pg_temp.clock(d date, h float8, who text) returns void language sql volatile as $$
  select set_config('app.sim_now', pg_temp.at(d, h)::text, false), set_config('app.sim_user', who, false)
$$;

-- seasonality: month profile × holiday bumps × growth trend
create or replace function pg_temp.season(profile text, d date, d0 date) returns numeric language sql immutable as $$
  select (case profile
    when 'gift' then (array[3.0,0.6,0.6,0.6,1.3,1.2,0.6,0.6,0.8,1.1,2.6,3.0])[extract(month from d)::int]
    when 'home' then (array[1.2,1.0,1.0,1.0,0.95,0.9,0.85,1.0,1.25,1.3,1.2,1.3])[extract(month from d)::int]
    else             (array[1.6,0.8,0.85,0.85,1.0,1.1,0.9,0.85,0.95,1.05,1.35,1.6])[extract(month from d)::int]
  end)
  * case when profile in ('general','gift') and d between date '2026-05-03' and date '2026-05-09' then 1.5   -- Mother's Day week
         when profile in ('home','tool')    and d between date '2026-06-14' and date '2026-06-20' then 1.4   -- Father's Day week
         when d between date '2026-11-23' and date '2026-11-28' then 1.6 else 1 end                          -- Thanksgiving week
  * (1 + 0.0009 * (d - d0))
$$;

create temp table sim_item (item_id int primary key, sku text, base numeric, store_share numeric, profile text,
  pack numeric, scrap_p float8, rework_p float8, scrap_reasons text[]);
insert into sim_item
select i.id, i.sku, x.base, x.ss, x.profile, x.pack, x.sp, x.rp, x.reasons
  from (values
   ('TTC-CB-WAL', 3.6, 0.70, 'general', 5,  0.035, 0.05, array['SC-KNOT','SC-CUT','RW-SAND']),
   ('TTC-CB-MAP', 4.4, 0.70, 'general', 5,  0.025, 0.04, array['SC-CUT','SC-GLUE','RW-SAND']),
   ('TTC-CHB-CHR',2.8, 0.75, 'general', 5,  0.045, 0.06, array['SC-KNOT','SC-CUT','RW-FIN']),
   ('TTC-STL-PIN',1.4, 0.70, 'home',    5,  0.020, 0.03, array['SC-GLUE','SC-CUT','RW-FIN']),
   ('TTC-SHF-OAK',1.2, 0.65, 'home',    5,  0.040, 0.05, array['SC-KNOT','SC-CUT','RW-FIN']),
   ('TTC-BB-4OZ', 5.0, 0.80, 'general', 10, 0.010, 0.00, array['SC-CUT']),
   ('TTC-GS-MAP', 1.5, 0.60, 'gift',    5,  0.005, 0.02, array['RW-FIN']),
   ('TTC-R-SCRP', 1.9, 0.80, 'tool',    6,  0, 0, null),
   ('TTC-R-SHRP', 0.95,0.80, 'tool',    6,  0, 0, null),
   ('RM-OIL-16',  0.6,1.00, 'general', 12, 0, 0, null),
   ('RM-WAX-1LB', 0.35,1.00, 'general', 5,  0, 0, null)
  ) x(sku, base, ss, profile, pack, sp, rp, reasons)
  join public.items i on i.sku = x.sku;
-- pack sizes for pure components
insert into sim_item(item_id, sku, base, store_share, profile, pack, scrap_p, rework_p)
select i.id, i.sku, 0, 0, 'general', greatest(i.min_order_qty, 1), 0, 0 from public.items i
 where not exists (select 1 from sim_item s where s.item_id = i.id);

create temp table sim_supplier (supplier_id int primary key, bias float8, sd float8, short_p float8, short_min float8, ships_rest boolean, pay_late_p float8);
insert into sim_supplier select s.id, x.bias, x.sd, x.sp, x.smin, x.rest, x.late from (values
  ('Wasatch Hardwoods',           -0.6, 0.8, 0.06, 0.85, true,  0.05),
  ('Utah Lumber Supply',           0.3, 1.1, 0.25, 0.70, false, 0.10),
  ('Bonneville Finishing Supply', -0.7, 0.7, 0.04, 0.90, true,  0.05),
  ('Beehive Apiary Co.',           3.2, 2.2, 0.45, 0.50, false, 0.05),
  ('Fastener Depot',              -0.6, 0.5, 0.02, 0.90, true,  0.03),
  ('Summit Packaging',             3.5, 2.0, 0.15, 0.75, true,  0.25),
  ('Provo Hardware Wholesale',     0.2, 1.0, 0.08, 0.85, true,  0.08)) x(n, bias, sd, sp, smin, rest, late)
  join public.suppliers s on s.name = x.n;

create temp table sim_arrival (po_id int, arrive date, lines jsonb, final boolean);
create temp table sim_payment (po_id int, pay_date date);
create temp table sim_return (order_id int, line_id int, item_id int, ret_date date, quality boolean, exchange boolean);
create temp table sim_close (order_id int, close_date date);

-- daily demand rate for a sellable item (FG rate includes gift-set dependent demand)
create or replace function pg_temp.rate(p_item int, d date, d0 date) returns numeric language sql stable as $$
  select coalesce((select s.base * pg_temp.season(s.profile, d, d0) from sim_item s where s.item_id = p_item), 0)
$$;

do $sim$
declare
  v_end date := (now() at time zone 'America/Denver')::date - 1;
  v_start date; d date; dow int; dowf numeric;
  L_WKS int := public.loc_by_kind('production'); L_WH int := public.loc_by_kind('warehouse');
  L_STORE int := public.loc_by_kind('retail'); L_QA int := public.loc_by_kind('quarantine');
  it record; r record; c record; vs record; m record; o record; ln record;
  v_q numeric; v_q2 numeric; v_have numeric; v_id int; v_lines jsonb; v_units int[]; v_baskets jsonb[];
  i int; j int; nb int; h float8; v_rate numeric; v_pos numeric; v_ok boolean; v_cust int;
  v_good numeric; v_scrap numeric; v_rw numeric; v_reason text; v_lt int; v_arr date; v_due date;
  v_gift int; v_maple int; v_butter int; v_need numeric; k int; v_fill float8; v_part jsonb; v_rest jsonb;
  v_retail int[]; v_whole int[]; v_wday int; v_cnt int := 0;
begin
  perform setseed(0.2026);
  v_start := v_end - 205;
  select id into v_gift from public.items where sku = 'TTC-GS-MAP';
  select id into v_maple from public.items where sku = 'TTC-CB-MAP';
  select id into v_butter from public.items where sku = 'TTC-BB-4OZ';
  select array_agg(id order by id) into v_retail from public.customers where customer_type = 'Retail';
  select array_agg(id order by id) into v_whole from public.customers where customer_type = 'Wholesale';

  -- ---------------- opening balances (the day before history starts) ----
  perform pg_temp.clock(v_start - 1, 8, 'Morgan Reyes');
  for it in select i.*, s.base, s.store_share, s.pack from public.items i join sim_item s on s.item_id = i.id loop
    if it.item_type in ('finished','resale') or it.base > 0 then
      v_q := ceil(it.base * 24);
      if it.item_type = 'component' then
        perform public.post_inv(it.id, L_STORE, 8, 'opening', it.standard_cost, null, 'opening', null, 'Opening balance');
        perform public.gl_post('Inventory', round(8 * it.standard_cost, 2), 0, 'Opening balance', 'opening', it.id);
        perform public.gl_post('Owner''s Equity', 0, round(8 * it.standard_cost, 2), 'Opening balance', 'opening', it.id);
      else
        perform public.post_inv(it.id, L_WH, v_q, 'opening', it.standard_cost, null, 'opening', null, 'Opening balance');
        perform public.post_inv(it.id, L_STORE, ceil(it.base * it.store_share * 8), 'opening', it.standard_cost, null, 'opening', null, 'Opening balance');
        perform public.gl_post('Inventory', round((v_q + ceil(it.base * it.store_share * 8)) * it.standard_cost, 2), 0, 'Opening balance', 'opening', it.id);
        perform public.gl_post('Owner''s Equity', 0, round((v_q + ceil(it.base * it.store_share * 8)) * it.standard_cost, 2), 'Opening balance', 'opening', it.id);
      end if;
    end if;
  end loop;
  -- opening cash in the bank (owner's investment)
  perform public.gl_post('Cash', 25000, 0, 'Opening cash balance', 'opening', null);
  perform public.gl_post('Owner''s Equity', 0, 25000, 'Opening cash balance', 'opening', null);
  -- components at the workshop: ~ (lead time + 14) days of usage
  for it in
    select ci2.*, sum(b.qty_per * pg_temp.rate(b.parent_item_id, v_start, v_start)
              + case when b.parent_item_id in (v_maple, v_butter) then b.qty_per * pg_temp.rate(v_gift, v_start, v_start) else 0 end) as u
      from public.items ci2 join public.bom_lines b on b.component_item_id = ci2.id
     where ci2.item_type = 'component' group by ci2.id loop
    v_q := ceil(it.u * (it.lead_time_days + 14));
    perform public.post_inv(it.id, L_WKS, v_q, 'opening', it.standard_cost, null, 'opening', null, 'Opening balance');
    perform public.gl_post('Inventory', round(v_q * it.standard_cost, 2), 0, 'Opening balance', 'opening', it.id);
    perform public.gl_post('Owner''s Equity', 0, round(v_q * it.standard_cost, 2), 'Opening balance', 'opening', it.id);
  end loop;

  -- ---------------- day-by-day simulation ---------------------------------
  for d in select generate_series(v_start, v_end, interval '1 day')::date loop
    dow := extract(isodow from d)::int;   -- 1 = Monday ... 7 = Sunday (closed)
    dowf := (array[0.75, 0.8, 0.85, 0.95, 1.25, 1.55, 0])[dow];

    -- monthly / bi-weekly operating expenses
    if extract(day from d) = 1 then
      perform pg_temp.clock(d, 9, 'Morgan Reyes');
      perform public.record_expense('Rent', 3600, 'Store + workshop rent ' || to_char(d, 'Mon YYYY'));
      perform public.record_expense('Utilities', round((520 + random() * 220)::numeric, 2), 'Utilities ' || to_char(d, 'Mon YYYY'));
      perform public.record_expense('Marketing', round((300 + random() * 600 + case when extract(month from d) in (11,12,5) then 700 else 0 end)::numeric, 2), 'Ads & social ' || to_char(d, 'Mon YYYY'));
    end if;
    -- remit last month's sales tax to the Utah State Tax Commission on the 20th
    if extract(day from d) = 20 then
      perform pg_temp.clock(d, 10, 'Morgan Reyes');
      select coalesce(sum(credit - debit), 0) into v_q from public.gl_entries
       where account = 'Sales Tax Payable' and ts < public.day_start(date_trunc('month', d)::date);
      if v_q > 0 then
        perform public.gl_post('Sales Tax Payable', v_q, 0, 'Sales tax remittance ' || to_char(d - 30, 'Mon YYYY'), 'tax', null);
        perform public.gl_post('Cash', 0, v_q, 'Sales tax remittance ' || to_char(d - 30, 'Mon YYYY'), 'tax', null);
      end if;
    end if;
    if dow = 5 and ((d - v_start) / 7) % 2 = 0 then
      perform pg_temp.clock(d, 17, 'Morgan Reyes');
      perform public.record_expense('Wages', round((4300 + random() * 700)::numeric, 2), 'Payroll period ending ' || d);
    end if;

    -- 07:00 supplier deliveries
    for r in select * from sim_arrival where arrive = d loop
      perform pg_temp.clock(d, 7 + random(), 'Taylor Brooks');
      begin
        perform public.receive_purchase_order(r.po_id, r.lines, null);
        if r.final and exists (select 1 from public.purchase_orders where id = r.po_id and status = 'Partially Received') then
          -- supplier will not ship the rest: close short (hurts fill rate)
          perform pg_temp.clock(d, 16, 'Morgan Reyes');
          perform public.close_purchase_order(r.po_id);
        end if;
        if not exists (select 1 from sim_payment where po_id = r.po_id) then
          select p.payment_terms_days, ss.pay_late_p into v_lt, v_fill from public.purchase_orders po
            join public.suppliers p on p.id = po.supplier_id join sim_supplier ss on ss.supplier_id = p.id where po.id = r.po_id;
          insert into sim_payment values (r.po_id, d + v_lt + case when random() < v_fill then 3 + floor(random()*9)::int else -floor(random()*6)::int end);
        end if;
      exception when others then raise notice 'receive % failed: %', r.po_id, sqlerrm;
      end;
    end loop;

    -- bill payments
    for r in select * from sim_payment where pay_date = d loop
      select balance into v_q from public.v_payables where po_id = r.po_id;
      if coalesce(v_q,0) > 0.005 then
        perform pg_temp.clock(d, 10.5, 'Morgan Reyes');
        perform public.pay_supplier(r.po_id, v_q, 'ACH');
        -- later partial deliveries get their own payment
        if exists (select 1 from sim_arrival a where a.po_id = r.po_id and a.arrive > d) then
          insert into sim_payment select r.po_id, max(arrive) + 25 from sim_arrival where po_id = r.po_id;
        end if;
      end if;
    end loop;

    -- collect payment from wholesale customers
    for r in select * from sim_close where close_date = d loop
      perform pg_temp.clock(d, 11, 'Morgan Reyes');
      begin perform public.close_sales_order(r.order_id, 'Check');
      exception when others then null; end;
    end loop;

    continue when dow = 7;   -- closed Sundays

    -- ===== production (Taylor Brooks, production lead) ==================
    -- complete builds whose lead time has elapsed
    for m in select po.*, i.lead_time_days lt from public.production_orders po join public.items i on i.id = po.item_id
              where po.status = 'In Progress' and (po.started_at at time zone 'America/Denver')::date + i.lead_time_days <= d loop
      perform pg_temp.clock(d, 13 + random() * 4, 'Taylor Brooks');
      select * into vs from sim_item where item_id = m.item_id;
      v_scrap := pg_temp.binom(m.qty_started, vs.scrap_p);
      v_good := m.qty_started - v_scrap;
      v_rw := least(pg_temp.binom(v_good, vs.rework_p), v_good);
      v_reason := case when v_scrap > 0 or v_rw > 0 then
                    case when v_scrap = 0 then coalesce((select x from unnest(vs.scrap_reasons) x where x like 'RW%' limit 1), 'RW-SAND')
                         else vs.scrap_reasons[1 + floor(random() * least(2, array_length(vs.scrap_reasons, 1)))::int] end end;
      perform public.complete_production_order(m.id, v_good, v_scrap, v_rw, v_reason, null);
      -- move finished goods to the warehouse (gift-set inputs stay for the gift line if needed)
      if v_good > 0 then perform public.transfer_inventory(m.item_id, L_WKS, L_WH, v_good, m.number); end if;
    end loop;

    -- plan new builds when finished-goods position runs low
    for it in select i.id, i.lead_time_days, s.pack from public.items i join sim_item s on s.item_id = i.id where i.item_type = 'finished' and s.base > 0 loop
      v_rate := pg_temp.rate(it.id, d, v_start) + case when it.id in (v_maple, v_butter) then pg_temp.rate(v_gift, d, v_start) else 0 end;
      select on_hand into v_have from public.v_item_stock where item_id = it.id;
      select v_have + coalesce(sum(case when status = 'Planned' then qty_planned else qty_started end), 0) into v_pos
        from public.production_orders where item_id = it.id and status in ('Planned','In Progress');
      v_pos := v_pos - coalesce((select sum(l.qty) from public.sales_order_lines l join public.sales_orders so2 on so2.id = l.order_id
                                  where so2.status = 'Placed' and l.item_id = it.id), 0);
      if v_pos < v_rate * (it.lead_time_days + 7) then
        v_q := greatest(it.pack, ceil(v_rate * (12 + random() * 6) / it.pack) * it.pack);
        perform pg_temp.clock(d, 7.25, 'Taylor Brooks');
        perform public.create_production_order(it.id, v_q, L_WKS, d + it.lead_time_days + 1, null, 'Manual');
      end if;
    end loop;

    -- start planned builds when components are at the workshop
    for m in select * from public.production_orders where status = 'Planned' order by created_at loop
      perform pg_temp.clock(d, 7.5 + random() * 0.5, 'Taylor Brooks');
      if m.item_id = v_gift then
        -- pull boards + butter from the warehouse to the workshop for kitting
        for c in select b.component_item_id, b.qty_per * m.qty_planned as need from public.bom_lines b
                  join public.items ci on ci.id = b.component_item_id where b.parent_item_id = m.item_id and ci.item_type = 'finished' loop
          select coalesce(qty,0) into v_have from public.inventory where item_id = c.component_item_id and location_id = L_WKS;
          v_have := coalesce(v_have, 0);
          if v_have < c.need then
            select coalesce(qty,0) into v_q from public.inventory where item_id = c.component_item_id and location_id = L_WH;
            v_q := least(coalesce(v_q,0), c.need - v_have);
            if v_q > 0 then perform public.transfer_inventory(c.component_item_id, L_WH, L_WKS, v_q, 'Kitting ' || m.number); end if;
          end if;
        end loop;
      end if;
      begin
        perform public.start_production_order(m.id, null);
      exception when others then null;  -- component shortage: wait for the PO
      end;
    end loop;

    -- ===== store replenishment from warehouse/workshop =================
    perform pg_temp.clock(d, 8.5, 'Jordan Lee');
    for it in select i.id, i.item_type, s.store_share from public.items i join sim_item s on s.item_id = i.id where s.base > 0 loop
      v_q := ceil(pg_temp.rate(it.id, d, v_start) * it.store_share * 9) + 2;
      select coalesce(qty, 0) into v_have from public.inventory where item_id = it.id and location_id = L_STORE;
      v_have := coalesce(v_have, 0);
      if v_have < v_q * 0.6 then
        select coalesce(qty, 0) into v_q2 from public.inventory where item_id = it.id
           and location_id = case when it.item_type = 'component' then L_WKS else L_WH end;
        v_q2 := least(coalesce(v_q2, 0), v_q - v_have);
        if it.item_type = 'component' then v_q2 := floor(least(v_q2, v_q - v_have)); end if;
        if v_q2 >= 1 then
          perform public.transfer_inventory(it.id, case when it.item_type = 'component' then L_WKS else L_WH end, L_STORE, v_q2, 'Store replenishment');
        end if;
      end if;
    end loop;

    -- ===== fulfil sales orders that are due ============================
    for o in select * from public.sales_orders where status = 'Placed' and due_date <= d and source in ('SO','WEB') order by due_date, id loop
      v_ok := true;
      for ln in select item_id, sum(qty) q from public.sales_order_lines where order_id = o.id group by item_id loop
        select coalesce(qty,0) into v_have from public.inventory where item_id = ln.item_id and location_id = o.location_id;
        if coalesce(v_have,0) < ln.q then
          if o.source = 'WEB' then  -- move stock to the pickup store
            select coalesce(qty,0) into v_q from public.inventory where item_id = ln.item_id and location_id = L_WH;
            if coalesce(v_q,0) >= ln.q - coalesce(v_have,0) then
              perform pg_temp.clock(d, 8.75, 'Jordan Lee');
              perform public.transfer_inventory(ln.item_id, L_WH, o.location_id, ln.q - coalesce(v_have,0), 'For ' || o.number);
            else v_ok := false; end if;
          else v_ok := false; end if;
        end if;
      end loop;
      if v_ok then
        perform pg_temp.clock(d, 9 + random(), 'Jordan Lee');
        perform public.fulfill_sales_order(o.id, case when o.source = 'WEB' then 'Card' else 'Invoice' end);
        if o.source = 'WEB' then
          perform pg_temp.clock(d, 12 + random() * 5, 'Jordan Lee');
          perform public.close_sales_order(o.id, 'Card');
        else
          insert into sim_close values (o.id, d + 14 + floor(random() * 22)::int);
        end if;
      end if;
    end loop;

    -- ===== new wholesale orders (each account orders on "its" weekday) ===
    for k in 1..array_length(v_whole, 1) loop
      if dow = k and random() < 0.85 then
        v_lines := '[]';
        for it in select i.id, s.base, s.profile from public.items i join sim_item s on s.item_id = i.id
                   where i.item_type in ('finished','resale') and s.base > 0 loop
          if random() < (case when it.profile = 'gift' and extract(month from d) >= 10 then 0.8 else 0.45 end) then
            v_q := greatest(2, 2 * round(pg_temp.rpois(pg_temp.rate(it.id, d, v_start) / it.base * it.base * 0.3 * 7 / (4 * 0.45)) / 2.0));
            v_lines := v_lines || jsonb_build_object('item_id', it.id, 'qty', v_q, 'discount_pct', 15);
          end if;
        end loop;
        if jsonb_array_length(v_lines) > 0 then
          perform pg_temp.clock(d, 9.5 + random(), 'Jordan Lee');
          perform public.create_sales_order(v_whole[k], L_WH, v_lines, 'SO', 0, d + 2 + floor(random() * 5)::int, 'Wholesale PO#' || (4000 + floor(random()*5000))::int);
        end if;
      end if;
    end loop;

    -- ===== point of sale at the store ====================================
    v_units := '{}';
    for it in select s.* from sim_item s where s.base > 0 loop
      nb := pg_temp.rpois(pg_temp.rate(it.item_id, d, v_start) * it.store_share * dowf);
      for j in 1..nb loop v_units := v_units || it.item_id; end loop;
    end loop;
    select coalesce(array_agg(u order by random()), '{}') into v_units from unnest(v_units) u;
    v_baskets := '{}'; i := 1;
    while i <= coalesce(array_length(v_units, 1), 0) loop
      nb := case when random() < 0.55 then 1 when random() < 0.75 then 2 else 3 end;
      select jsonb_agg(jsonb_build_object('item_id', u, 'qty', n)) into v_lines
        from (select u, count(*) n from unnest(v_units[i:i + nb - 1]) u group by u) x;
      v_baskets := v_baskets || v_lines;
      i := i + nb;
    end loop;
    nb := coalesce(array_length(v_baskets, 1), 0);
    for i in 1..nb loop
      h := 10 + (i - 1) * 9.0 / nb + random() * 9.0 / nb;
      perform pg_temp.clock(d, h, 'Jordan Lee');
      -- drop lines the store can't supply (lost sale)
      select coalesce(jsonb_agg(x), '[]') into v_lines from jsonb_array_elements(v_baskets[i]) x
       where (x->>'qty')::numeric <= coalesce((select qty from public.inventory where item_id = (x->>'item_id')::int and location_id = L_STORE), 0);
      continue when jsonb_array_length(v_lines) = 0;
      v_cust := case when random() < 0.3 then v_retail[1 + floor(random() * array_length(v_retail, 1))::int] end;
      begin
        v_id := public.pos_checkout(v_cust, L_STORE, v_lines, case when random() < 0.08 then 10 else 0 end,
                                    case when random() < 0.85 then 'Card' else 'Cash' end);
        for ln in select * from public.sales_order_lines where order_id = v_id loop
          if random() < 0.03 then
            insert into sim_return values (v_id, ln.id, ln.item_id, d + 1 + floor(random() * 12)::int, random() < 0.35, random() < 0.25);
          end if;
        end loop;
        v_cnt := v_cnt + 1;
      exception when others then raise notice 'POS failed: %', sqlerrm;
      end;
    end loop;

    -- ===== customer portal pickup orders =================================
    if random() < 0.45 then
      perform pg_temp.clock(d, 8 + random() * 10, 'Customer portal');
      select jsonb_agg(jsonb_build_object('item_id', id, 'qty', 1)) into v_lines from (
        select i.id from public.items i join sim_item s on s.item_id = i.id where s.base > 0.5 order by random() limit (1 + floor(random()*2))::int) x;
      perform public.create_sales_order(v_retail[1 + floor(random() * array_length(v_retail, 1))::int], L_STORE, v_lines, 'WEB', 0, d + 1, 'Pickup order');
    end if;

    -- ===== returns & exchanges ============================================
    for r in select sr.*, i.sku, i.price from sim_return sr join public.items i on i.id = sr.item_id where sr.ret_date = d loop
      perform pg_temp.clock(d, 12 + random() * 5, 'Jordan Lee');
      v_reason := case when r.quality then
                    case when r.sku like 'TTC-STL%' or r.sku like 'TTC-SHF%' then (array['QF-HW','QF-FINISH'])[1 + floor(random()*2)::int]
                         when r.sku like 'TTC-R-%' then 'QF-HW'
                         else (array['QF-CRACK','QF-WARP','QF-FINISH'])[1 + floor(random()*3)::int] end
                  else (array['CHG','GIFT','WRONG'])[1 + floor(random()*3)::int] end;
      begin
        if r.exchange then
          -- quality failure => same item; otherwise swap for another item at the store
          select id into v_id from public.items i
           where i.sellable and i.price > 0 and case when r.quality then i.id = r.item_id else i.id <> r.item_id and i.item_type <> 'component' end
             and coalesce((select qty from public.inventory where item_id = i.id and location_id = L_STORE), 0) >= 1
           order by abs(i.price - r.price), random() limit 1;
        end if;
        perform public.process_return(r.order_id,
          jsonb_build_array(jsonb_build_object('so_line_id', r.line_id, 'qty', 1, 'reason_code', v_reason,
                                               'disposition', case when r.quality then 'Quality Hold' else 'Restock' end)),
          case when r.exchange and v_id is not null then jsonb_build_array(jsonb_build_object('item_id', v_id, 'qty', 1)) end,
          case when r.quality then 'Customer reported defect' end);
      exception when others then raise notice 'return failed: %', sqlerrm;
      end;
      v_id := null;
    end loop;

    -- ===== quality hold disposition every other Monday ====================
    if dow = 1 and ((d - v_start) / 7) % 2 = 1 and d < v_end - 10 then
      perform pg_temp.clock(d, 15, 'Taylor Brooks');
      for r in select item_id, qty from public.inventory where location_id = L_QA and qty > 0 loop
        if random() < 0.25 then  -- repairable: back to the warehouse
          perform public.transfer_inventory(r.item_id, L_QA, L_WH, r.qty, 'Repaired after inspection');
        else
          perform public.adjust_inventory(r.item_id, L_QA, -r.qty, 'QA-SCRAP', 'Not repairable');
        end if;
      end loop;
    end if;

    -- ===== cycle counts (Saturdays) & occasional damage ==================
    if dow = 6 then
      perform pg_temp.clock(d, 18, 'Taylor Brooks');
      for r in select inv.item_id, inv.location_id, inv.qty, i.uom from public.inventory inv join public.items i on i.id = inv.item_id
                where inv.qty > 3 and inv.location_id <> L_QA order by random() limit 3 loop
        v_q := case when random() < 0.6 then 0
                    when r.uom = 'bd ft' then round((pg_temp.rnorm() * 3)::numeric, 1)
                    else round(pg_temp.rnorm()::numeric * 1.2) end;
        if v_q <> 0 and r.qty + v_q >= 0 then
          perform public.cycle_count(r.item_id, r.location_id, r.qty + v_q, case when v_q > 0 then 'FOUND' else 'CC' end, 'Weekly cycle count');
        end if;
      end loop;
      if random() < 0.35 then
        select inv.item_id, inv.location_id into r from public.inventory inv join public.items i on i.id = inv.item_id
         where i.item_type = 'finished' and inv.qty >= 1 and inv.location_id in (L_WH, L_STORE) order by random() limit 1;
        if r.item_id is not null then
          perform public.adjust_inventory(r.item_id, r.location_id, -1, (array['DMG','DMG','SAMPLE','SHRINK'])[1 + floor(random()*4)::int], 'Found during walk-through');
        end if;
      end if;
    end if;

    -- ===== purchasing review (Morgan Reyes) ==============================
    perform pg_temp.clock(d, 19.5, 'Morgan Reyes');
    for vs in select sup.id as supplier_id, sup.lead_time_days, ss.bias, ss.sd, ss.short_p, ss.short_min, ss.ships_rest, g.is_resale
               from public.suppliers sup join sim_supplier ss on ss.supplier_id = sup.id
               cross join (values (false), (true)) g(is_resale) loop
      v_lines := '[]';
      for it in
        select i.id, i.item_type, i.min_order_qty, si.pack,
               coalesce((select sum(b.qty_per * (pg_temp.rate(b.parent_item_id, d, v_start)
                          + case when b.parent_item_id in (v_maple, v_butter) then pg_temp.rate(v_gift, d, v_start) else 0 end))
                        from public.bom_lines b where b.component_item_id = i.id), 0) + pg_temp.rate(i.id, d, v_start) as u
          from public.items i join sim_item si on si.item_id = i.id
         where i.supplier_id = vs.supplier_id and (i.item_type = 'resale') = vs.is_resale loop
        -- position = on hand + on order - components still needed by planned builds - open customer orders
        select st.on_hand + coalesce((select sum(pl.qty_ordered - pl.qty_received) from public.po_lines pl join public.purchase_orders po on po.id = pl.po_id
                                      where pl.item_id = it.id and po.status in ('Sent','Partially Received')), 0)
             - coalesce((select sum(b.qty_per * mo.qty_planned) from public.production_orders mo join public.bom_lines b on b.parent_item_id = mo.item_id
                          where mo.status = 'Planned' and b.component_item_id = it.id), 0)
             - coalesce((select sum(l.qty) from public.sales_order_lines l join public.sales_orders so3 on so3.id = l.order_id
                          where so3.status = 'Placed' and l.item_id = it.id), 0)
          into v_pos from public.v_item_stock st where st.item_id = it.id;
        if it.u > 0 and v_pos <= it.u * (vs.lead_time_days + 8) then
          v_q := greatest(it.min_order_qty, ceil(it.u * (14 + random() * 8) / it.pack) * it.pack);
          v_lines := v_lines || jsonb_build_object('item_id', it.id, 'qty', v_q);
        end if;
      end loop;
      if jsonb_array_length(v_lines) > 0 then
        v_id := public.create_purchase_order(vs.supplier_id, case when vs.is_resale then L_WH else L_WKS end,
                  v_lines, true, null, 'Reorder point');
        -- schedule the delivery with this supplier's real-world behaviour
        v_lt := greatest(1, round(vs.lead_time_days + vs.bias + vs.sd * pg_temp.rnorm()))::int;
        v_arr := d + v_lt;
        if extract(isodow from v_arr) = 7 then v_arr := v_arr + 1; end if;
        if random() < vs.short_p then
          v_fill := vs.short_min + random() * (0.95 - vs.short_min);
          select jsonb_agg(jsonb_build_object('po_line_id', id, 'qty', case when rn = 1 then floor(qty_ordered * v_fill) else qty_ordered end)),
                 jsonb_agg(jsonb_build_object('po_line_id', id, 'qty', qty_ordered - floor(qty_ordered * v_fill))) filter (where rn = 1)
            into v_part, v_rest
            from (select pl.*, row_number() over (order by random()) rn from public.po_lines pl where pl.po_id = v_id) x;
          insert into sim_arrival values (v_id, v_arr, v_part, not vs.ships_rest);
          if vs.ships_rest then insert into sim_arrival values (v_id, v_arr + 3 + floor(random() * 4)::int, v_rest, true); end if;
        else
          insert into sim_arrival select v_id, v_arr, jsonb_agg(jsonb_build_object('po_line_id', id, 'qty', qty_ordered)), true
            from public.po_lines where po_id = v_id;
        end if;
      end if;
    end loop;
  end loop;

  raise notice 'Simulated % POS sales from % to %', v_cnt, v_start, v_end;
end $sim$;

-- ---------------------------------------------------------------- today's open business
-- Upcoming confirmed customer orders (drive MRP) and an open backorder.
select set_config('app.sim_now', '', false), set_config('app.sim_user', 'Jordan Lee', false);
do $$
declare L_WH int := public.loc_by_kind('warehouse'); L_STORE int := public.loc_by_kind('retail');
        t date := public.app_today(); c record;
begin
  perform public.create_sales_order((select id from public.customers where name = 'Sundance Mountain Gifts'), L_WH,
    jsonb_build_array(jsonb_build_object('item_id', (select id from public.items where sku='TTC-GS-MAP'), 'qty', 140, 'discount_pct', 15),
                      jsonb_build_object('item_id', (select id from public.items where sku='TTC-CB-WAL'), 'qty', 60, 'discount_pct', 15)),
    'SO', 0, t + 16, 'Holiday gift shop order — confirmed');
  perform public.create_sales_order((select id from public.customers where name = 'Provo Kitchen Co.'), L_WH,
    jsonb_build_array(jsonb_build_object('item_id', (select id from public.items where sku='TTC-CB-MAP'), 'qty', 72, 'discount_pct', 15),
                      jsonb_build_object('item_id', (select id from public.items where sku='TTC-BB-4OZ'), 'qty', 120, 'discount_pct', 15)),
    'SO', 0, t + 9, 'Black Friday restock');
  perform public.create_sales_order((select id from public.customers where name = 'Heber Valley Mercantile'), L_WH,
    jsonb_build_array(jsonb_build_object('item_id', (select id from public.items where sku='TTC-SHF-OAK'), 'qty', 40, 'discount_pct', 15),
                      jsonb_build_object('item_id', (select id from public.items where sku='TTC-STL-PIN'), 'qty', 30, 'discount_pct', 15)),
    'SO', 0, t + 23, 'Christmas display order');
  perform public.create_sales_order((select id from public.customers where name = 'Orem Home & Hearth'), L_WH,
    jsonb_build_array(jsonb_build_object('item_id', (select id from public.items where sku='TTC-CHB-CHR'), 'qty', 80, 'discount_pct', 15)),
    'SO', 0, t + 2, 'Rush — event catering boards');
  -- new product launch: coaster sets (only a sample batch of cork on hand)
  perform public.create_sales_order((select id from public.customers where name = 'Provo Kitchen Co.'), L_WH,
    jsonb_build_array(jsonb_build_object('item_id', (select id from public.items where sku='TTC-CST-WAL'), 'qty', 40, 'discount_pct', 15)),
    'SO', 0, t + 8, 'Launch order — coaster sets');
  perform public.create_sales_order((select id from public.customers where name = 'Sundance Mountain Gifts'), L_WH,
    jsonb_build_array(jsonb_build_object('item_id', (select id from public.items where sku='TTC-CST-WAL'), 'qty', 60, 'discount_pct', 15)),
    'SO', 0, t + 18, 'Coaster sets for holiday display');
  perform set_config('app.sim_now', (now() - interval '6 days')::text, false);
  perform set_config('app.sim_user', 'Morgan Reyes', false);
  declare v_po int;
  begin
    v_po := public.create_purchase_order((select id from public.suppliers where name = 'Summit Packaging'), public.loc_by_kind('production'),
      jsonb_build_array(jsonb_build_object('item_id', (select id from public.items where sku='PK-CORK-4'), 'qty', 100)), true, 'Sample batch for coaster launch', 'Manual');
    perform set_config('app.sim_now', (now() - interval '1 day')::text, false);
    perform public.receive_purchase_order(v_po, (select jsonb_agg(jsonb_build_object('po_line_id', id, 'qty', qty_ordered)) from public.po_lines where po_id = v_po), null);
  end;
  perform set_config('app.sim_now', '', false);
  perform set_config('app.sim_user', 'Jordan Lee', false);
  perform public.create_sales_order((select id from public.customers where name = 'Emily Carter'), L_STORE,
    jsonb_build_array(jsonb_build_object('item_id', (select id from public.items where sku='TTC-CB-WAL'), 'qty', 1)),
    'WEB', 0, t + 1, 'Pickup order');
end $$;

-- morning shelf top-up at the store so the POS starts the day stocked
do $$
declare L_WH int := public.loc_by_kind('warehouse'); L_STORE int := public.loc_by_kind('retail'); r record; v numeric;
begin
  perform set_config('app.sim_user', 'Jordan Lee', false);
  for r in select i.id, coalesce(st.qty,0) store_qty, coalesce(wh.qty,0) wh_qty
             from public.items i
             left join public.inventory st on st.item_id = i.id and st.location_id = L_STORE
             left join public.inventory wh on wh.item_id = i.id and wh.location_id = L_WH
            where i.sellable and i.price > 0 and i.item_type <> 'component' loop
    v := least(greatest(0, 10 - r.store_qty), floor(r.wh_qty / 2));
    if v >= 1 then perform public.transfer_inventory(r.id, L_WH, L_STORE, v, 'Morning shelf top-up'); end if;
  end loop;
  -- anything still short comes from the workshop
  for r in select i.id, coalesce(st.qty,0) store_qty, coalesce(wk.qty,0) wk_qty
             from public.items i
             left join public.inventory st on st.item_id = i.id and st.location_id = L_STORE
             left join public.inventory wk on wk.item_id = i.id and wk.location_id = public.loc_by_kind('production')
            where i.sellable and i.price > 0 and i.item_type <> 'component' loop
    v := least(greatest(0, 10 - r.store_qty), floor(r.wk_qty / 2));
    if v >= 1 then perform public.transfer_inventory(r.id, public.loc_by_kind('production'), L_STORE, v, 'Morning shelf top-up'); end if;
  end loop;
end $$;

select set_config('app.sim_now', '', false), set_config('app.sim_user', '', false);

-- give any other existing logins (e.g. team members who signed up earlier) their profile back
select public.backfill_profiles();
