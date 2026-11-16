-- =====================================================================
-- CLEAN START: erase all transactions and stock, keep the setup.
--   Kept:   items (prices, costs, barcodes, lead times), bills of material,
--           suppliers, customers, locations, settings, promo codes, logins.
--   Erased: inventory, sales/POS/portal orders, returns, purchase orders,
--           receipts, payments, production orders, repeat orders, ledger,
--           activity history, Action Center history.
--   Then:   puts STARTING CASH in the bank so you can start buying.
--
-- To change the starting cash, edit the number on the line marked  <<<
-- To get the full demo data back later: run 00_reset.sql, then 01_full_setup.sql
-- Paste into Supabase -> SQL Editor -> Run.
-- =====================================================================
do $$
declare
  v_starting_cash numeric := 50000;   -- <<< starting cash in dollars
begin
  truncate table
    public.return_lines, public.returns,
    public.sales_order_lines, public.sales_orders,
    public.po_receipts, public.supplier_payments, public.po_lines, public.purchase_orders,
    public.production_issues, public.production_orders,
    public.recurring_orders,
    public.inv_txns, public.inventory,
    public.gl_entries, public.activity_log, public.alert_log
  restart identity cascade;

  -- document numbers start over (SO-10001, POS-50001, PO-3001, MO-7001, RMA-901)
  alter sequence public.so_seq  restart with 10001;
  alter sequence public.pos_seq restart with 50001;
  alter sequence public.po_seq  restart with 3001;
  alter sequence public.mo_seq  restart with 7001;
  alter sequence public.rt_seq  restart with 901;

  -- no stock means no average cost yet (it builds up from your first receipts)
  update public.items set avg_cost = 0;
  update public.promo_codes set uses = 0;

  -- the owner puts money in the bank
  perform set_config('app.sim_now', '', true);
  perform set_config('app.sim_user', 'Morgan Reyes', true);
  perform public.gl_post('Cash', v_starting_cash, 0, 'Owner investment — starting cash', 'opening', null);
  perform public.gl_post('Owner''s Equity', 0, v_starting_cash, 'Owner investment — starting cash', 'opening', null);
  perform public.log_activity('finance', format('Clean start: all transactions cleared, $%s starting cash deposited', v_starting_cash));
end $$;

select 'Clean start done' as status,
       (select sum(debit - credit) from public.gl_entries where account = 'Cash') as cash_in_bank,
       (select count(*) from public.inventory) as stock_rows,
       (select count(*) from public.sales_orders) as orders;
