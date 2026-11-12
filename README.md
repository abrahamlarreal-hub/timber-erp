# Timpanogos Timber Co. — Mini-ERP

A working ERP for a small Utah woodworking company (manufacturer + retail store + wholesale).
Point of sale, sales orders, returns/exchanges, multi-location inventory with barcodes,
production orders, purchasing & supplier scorecards, ROP/EOQ replenishment, multi-level MRP,
P&L / valuation / turnover, management reports, a customer pickup portal, and realtime multi-user sync.

**Built with:** Claude Code (AI coding tool) · Supabase (PostgreSQL, Auth, Realtime) · React 18 + Vite + Tailwind · Recharts · JsBarcode + ZXing.
(Also documented inside the app under **About / Tech Stack**.)

---

## 1. Create the database (Supabase, free tier) — ~5 minutes

1. Go to <https://supabase.com> → **New project**. Pick a region near Utah (e.g. *West US*). Save the DB password.
2. **Authentication → Sign In / Providers → Email**: turn **off** “Confirm email” (so customers/teammates can sign up instantly during the demo).
3. **SQL Editor → New query**: open `setup/01_full_setup.sql` from this repo, paste the whole file, click **Run**.
   It creates every table/function, then simulates ~6½ months of business history (takes 20–60 s).
   You should see `Simulated NNNN POS sales from … to …` in the output.
4. **Project Settings → API**: copy the **Project URL** and the **anon public** key.

> **Re-generating data before the demo:** the history always ends “yesterday”. The night before your demo,
> run `setup/00_reset.sql`, then `setup/01_full_setup.sql` again, so today’s Action Center is fresh.
> (Alternative to the SQL Editor: `psql "<connection string>" -f setup/01_full_setup.sql`.)

## 2. Run / deploy the web app

Local:
```bash
npm install
cp .env.example .env.local   # paste your Project URL + anon key
npm run dev                  # http://localhost:5173
```

Deploy (so everyone — and phone cameras — can use it over HTTPS):
- **Vercel**: “Add New Project” → import this GitHub repo → add env vars `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` → Deploy. (`vercel.json` already handles page refreshes.)
- **Netlify** works the same way (build `npm run build`, publish `dist`; `public/_redirects` included).

## 3. Logins

| Role | Email | Password |
|---|---|---|
| Manager (can edit settings & roles) | manager@timpanogostimber.com | Timber2026! |
| Staff – sales | sales@timpanogostimber.com | Timber2026! |
| Staff – production | shop@timpanogostimber.com | Timber2026! |
| Customer (portal) | emily.carter@example.com | Timber2026! |

Teammates can create their own logins on the sign-in page: employee code **TIMBER-STAFF** (or **TIMBER-MGR**
for a manager); leave the code blank to create a customer account. Codes are editable under Settings.

## 4. Barcodes

**Barcode Labels** page → choose items → **Print**. Labels are Code 128 and scan with:
- a USB/Bluetooth scanner (acts like a keyboard — click the scan box and scan), or
- the **Camera** button on any scan box (phone or laptop; requires the HTTPS deployed site).

Receipts also print a barcode of the order number — scan it on **Returns** to pull up the sale.

## 5. Project layout

```
supabase/migrations/   schema, business logic (PL/pgSQL), analytics/MRP, security/realtime
supabase/seed.sql      master data + day-by-day business simulation (history)
setup/                 01_full_setup.sql (migrations+seed in one file), 00_reset.sql
src/pages/             one screen per module      src/portal/  customer portal
src/lib/               Supabase client, hooks, realtime sync, formatting
DEMO_GUIDE.md          how to present it + ERP/MRP talking points
```

To rebuild `setup/01_full_setup.sql` after editing SQL: `./scripts/build-setup-sql.sh`.
Local full stack (optional, needs Docker): `npx supabase start`, then
`psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/seed.sql`.
