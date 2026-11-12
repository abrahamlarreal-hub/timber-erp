# Demo Guide — Timpanogos Timber Co. ERP

Dr. Wright picks the scenario live, so learn **where each feature is** and **why it works the way it does**.
A big part of the grade is explaining ERP/MRP concepts, so each section has talking points.

## The 30-second story
Timpanogos Timber Co. makes hardwood cutting boards, serving boards, shelves, step stools, board butter and
gift kits in an **Orem workshop**, stocks a **Lindon warehouse**, and sells through a **Provo retail store**
(POS), **wholesale accounts** (sales orders) and an **online pickup portal**. A fourth location, **Quality
Hold**, quarantines defective returns. 32 items, 8 with bills of material (one multi-level: the gift set
contains a board and board butter that are themselves made in-house), 7 suppliers, 12 customers, and
~6½ months of history.

**Key idea to repeat:** *one database, one transaction.* A POS sale updates inventory, average cost,
revenue, sales tax, COGS and cash in one atomic database function, so every screen (and every other
logged-in user) sees the same numbers instantly. Nothing on any report is typed in.

## Suggested split (everyone presents at least one)
| Person | Features |
|---|---|
| 1 | Action Center (wow), POS with barcode scan, receipt, Sales Orders statuses |
| 2 | Returns & exchanges (quality hold), customer portal + available-to-promise, multi-user realtime |
| 3 | Inventory (locations, transfers, adjustments, cycle counts, backorders/ETA), labels, purchasing + scan-to-receive, supplier scorecard |
| 4 | Production orders + production/quality report, MRP |
| 5 | Replenishment (ROP / safety stock / EOQ / periodic review), Financials (P&L, valuation, turnover), Reports |

(Fewer people? Combine rows. Everyone should be able to do POS → Inventory → Financials.)

## Pre-demo checklist
- [ ] Night before: run `setup/00_reset.sql` then `setup/01_full_setup.sql` so history ends yesterday.
- [ ] Print a label sheet (Barcode Labels → "1 of each" → Print) and stick a few on real objects.
- [ ] Test the phone camera scanner on the **deployed https** site, and the USB scanner if you have one.
- [ ] Two laptops: one logged in as `sales@…` (POS), one as `manager@…` (Action Center / Inventory), plus a phone as the customer `emily.carter@…`.
- [ ] Dress professionally. Close other tabs. Zoom browser to ~110% for the projector.

---

## Required capabilities — where & what to say

### 1. Point of Sale  (Sales → Point of Sale)
- Scan a label (or click a product) → multi-line cart → optional customer & **discount %** → Card/Cash → **receipt** (printable, has an order barcode).
- Say: completing the sale **relieves inventory at weighted-average cost** and posts **Revenue, Discounts, Sales Tax Payable, COGS, Inventory and Cash** (show Financials → General ledger: the newest entries are your sale).
- Live proof: before/after on Inventory (the other laptop updates by itself) and Financials → P&L.
- The checkout button is disabled if a line exceeds stock at that location — you can't sell what you don't have.

### 2. Inventory management  (Operations → Inventory)
- Matrix of **on-hand by item × location** (WKS, WH, STORE, QA). Click an item for barcode, per-location stock and full **transaction history** (every movement with user, cost, reason).
- **Transfer**, **Adjust** (reason code required: damage, shrinkage, sample, QA-scrap…), **Cycle count** (enter counted qty → system posts the variance). Adjustments hit the *Inventory Shrinkage & Adjustments* expense on the P&L.
- **Backorders:** an item is backordered when orders already due exceed on-hand. The **estimated available date** = earliest open PO expected date or production order due date; if none, today + lead time (for made items, + the longest lead time of any short component).
- "Scan to adjust/count/transfer" box at the top: pick the action, scan a label.

### 3. Barcodes
- Every item has a UPC-style barcode (Items & BOMs). Print labels from **Barcode Labels**.
- Scan works in POS, Inventory (adjust/count/transfer), PO receiving (each scan counts +1 on the matching line), sales/PO line editors, and Returns (scan the receipt).

### 4. Sales orders  (Sales → Sales Orders)
- New order: customer, ship-from location, requested date, lines (wholesale accounts get a 15% line discount).
- Statuses: **Placed** (demand is reserved; MRP and available-to-promise see it) → **Fulfilled** (shipped/picked up: inventory, revenue and COGS post; A/R is created) → **Closed** (payment received: Cash ↑, A/R ↓) or **Cancelled** (only before fulfillment).
- Short lines show "Backordered — est. available DATE". **Ship available, backorder rest** ships what's in stock now and automatically creates a linked backorder (new sales order) for the remainder — the two orders add up to the original total.

### 5. Returns & exchanges  (Sales → Returns)
- Find the sale by number or **scan the receipt barcode** → choose qty, **reason code**, **disposition**.
- **Restock** → back to the selling location; **Quality failure (QF-…)** → **Quality Hold** location (not available to sell) until inspected; then transfer back or scrap it with an adjustment (QA-SCRAP).
- Accounting: Dr *Sales Returns & Allowances* (contra-revenue) and *Sales Tax Payable*, Cr Cash; Dr Inventory / Cr COGS at the **original unit cost**. P&L shows Gross sales − Discounts − Returns = Net sales.
- **Exchange:** add replacement items → recorded as a linked new sale; screen shows what the customer owes or gets back.

### 6. Production orders  (Operations → Production)
- New order: item, quantity, location, due date — shows **BOM × quantity vs. on-hand** before you commit.
- **Start** = issue components (backflush per BOM) from inventory to **Work in Process**; records start time and rolled-up cost.
- **Complete** = good + scrapped must equal started; reworked is a subset of good; a **quality reason code** is required for scrap/rework. Good units go to inventory at cost per unit started; scrapped units' cost goes to *Production Scrap* expense. Records finish time.
- **Production & quality report** (date range): yield, first-pass yield, scrap rate & cost, on-time completion, average cycle time, throughput/day, avg unit cost, charts by item and by reason code, and the full order list.

### 7. Purchase orders & suppliers  (Supply chain)
- New PO → **Create & send**: order date = today, **expected date = today + supplier's quoted lead time**.
- Open the PO → scan labels or type quantities → **Post receipt** (choose location). Partial receipts → *Partially Received*; complete → *Received*; **Pay supplier** in full → *Closed* (or close short). Receipt raises inventory, updates weighted-average cost, and creates **A/P due = receipt date + terms (Net 15/30/60)**.
- PO list shows expected vs. actual receipt, days late, and fill %.
- **Supplier scorecard** (one screen): on-time %, average actual vs. quoted lead time, fill rate, owed / overdue / next due date, overall score with **Keep / Watch / Replace**. Score = 40% on-time + 30% fill + 30% lead-time accuracy. All computed from PO history.

### 8. Replenishment / ordering rules  (Supply chain → Replenishment)
- From the last 180 days of transactions: **average daily usage d** (sales + production consumption − returns) and its **standard deviation σ**.
- **Safety stock = z·σ·√LT**, **ROP = d·LT + safety stock** (lead-time demand + buffer).
- **EOQ = √(2DS/H)** with **S** (ordering cost) and **H** (holding rate × unit cost) editable at the top. Click any row for the **EOQ cost curve** (ordering vs. holding vs. total) and a **demand forecast** chart.
- **Continuous review** tab: position (on hand + on order − allocated) ≤ ROP → order EOQ; order-by date shown.
- **Periodic review** tab: every R days, order up to d·(R+LT)+SS.
- "Create orders for selected" makes POs (grouped by supplier) and production orders.

### 9. MRP  (Operations → MRP)
- Gross requirements = **confirmed (Placed) sales orders** by requested week + components of planned builds.
- Netting: projected on hand = on hand + scheduled receipts (open POs, open production orders) − gross. Shortage = **net requirement** → **planned order receipt** (lot-for-lot, respecting min order qty).
- **Lead-time offset:** planned order release / **order-by date = need date − lead time**. Red = already past → expedite.
- **BOM explosion by level:** gift set (level 0) → maple board & board butter (level 1) → lumber, oil, wax, tins, labels (level 2). Expand any item to see the classic MRP grid and where its demand comes from.
- **Create selected POs & production orders** converts the plan into real documents in one click.
- Good live test: create a big sales order (e.g. 80 Walnut Coaster Sets due in 2 weeks), re-run MRP → new Build + Buy lines appear (cork discs have a 12-day lead time, so they'll likely say EXPEDITE).

### 10. Financial reporting  (Finance → Financials)
- **P&L** for any date range, with monthly chart. Revenue/COGS come from the general ledger that every transaction posts to.
- **Inventory valuation**: on-hand × weighted-average cost, by item, location and category.
- **Inventory turnover** = COGS ÷ average inventory (beginning and ending values are rebuilt from the inventory ledger), annualized, plus days of inventory.
- **General ledger** tab: trial balance sums to $0.00 — proof the books balance.

### 11. Reports  (Finance → Reports)
Sales by day/week/month with gross profit, top sellers, low stock with suggested qty & order-by, inventory by location, supplier lead time actual vs. quoted. All exportable to CSV.

### 12. Customer portal & multi-user
- Log in as `emily.carter@example.com` (phone works well): catalog with **stock by location**, **available-to-promise** (stock minus what's already promised to other orders), and a **"ready by" date** when it isn't available. Place a pickup order → it appears instantly in staff Sales Orders, MRP and the Action Center; the customer sees status changes under *My orders*.
- **Realtime:** the header says "Live — synced with all users". A sale on laptop A updates laptop B's inventory without refreshing, and B gets a toast ("Jordan Lee: POS sale POS-…"). Every action records the user's name (transaction history, activity feed).

## Wow factors
1. **Action Center** — an auto-prioritized to-do list built from live data across every module (backorders, late POs, items below ROP, bills due, quality holds, orders due), each clickable.
2. **One-click plan → execution** — MRP and replenishment suggestions become real POs (grouped by supplier) and production orders.
3. **Available-to-promise in the customer portal** — customers see honest "ready by" dates computed from POs, production and component lead times.
4. **EOQ cost curve + demand forecast** per item (Holt exponential smoothing) — makes the math visible to a business owner.
5. **Supplier Keep / Watch / Replace** scoring computed from actual delivery history.
6. **Barcode everywhere** incl. scan-to-receive with per-line counting and receipt-barcode returns.
7. **8-week cash-flow forecast** (Financials → Cash-flow forecast, and "Cash on hand" on the Action Center): projects the bank balance from store sales, invoices customers owe, confirmed orders, supplier bills due, open POs, payroll, rent and sales tax. Say: "MRP tells us what to buy; this tells us whether we can afford it." Live test: send a big PO → the projected balance drops.
8. **Realistic simulated history** (seasonality, closed Sundays, holidays, supplier personalities) — why ROP/EOQ values are believable.

## "Change an input and re-show it" — rehearse these
| Change | Where | What moves |
|---|---|---|
| Ordering cost $45 → $90 | Replenishment (manager) | Every EOQ × √2 (e.g. 310 → 438) |
| Service z 1.65 → 2.33 | Replenishment | Safety stock & ROP up |
| Supplier lead time 7 → 10 days | Suppliers → card → Edit | Its items' lead time, ROP, MRP order-by dates, new PO expected dates |
| Ring up a sale | POS | Inventory, P&L, turnover, Action Center, other users' screens |
| Edit a BOM qty | Items & BOMs → BOM | Rolled-up cost, MRP component requirements, next production order issue |
| Add a big sales order | Sales Orders | MRP planned orders, backorder ETA, customer portal availability |
| Receive a PO that's past its expected date (Action Center lists late POs) | Purchase order | That supplier's on-time %, avg lead time, score |
| Tax rate | Settings | New sales' tax |

## Likely questions (short answers)
- **Why is the GL inventory a few cents off Σ(qty × avg cost)?** Rounding of average cost to 4 decimals — it's within pennies, and the trial balance is exactly $0.
- **Independent vs. dependent demand?** Finished goods sold to customers = independent (forecast/ROP); components = dependent (calculated by MRP from the BOM).
- **Why weighted average?** Simple, smooths price changes, accepted under GAAP; every receipt recalculates it, every issue uses it.
- **Why can position be negative?** Position = on hand + on order − allocated; negative means confirmed orders exceed everything we have or have ordered.
- **Why lot-for-lot in MRP but EOQ in replenishment?** MRP plans exact dependent requirements for known orders; EOQ balances ordering vs. holding cost for steady independent demand. (Min order qty is still respected.)
- **What happens to quality returns?** Quarantined in Quality Hold (not sellable/available), then repaired (transfer back) or scrapped (adjustment with QA-SCRAP → expense).
- **Who did that?** Every transaction stores the user; see an item's transaction history or the live activity feed.
- **How was data generated?** A day-by-day simulation that calls the same functions the app uses, so the history is internally consistent (not random rows).

## Honest limitations (if asked)
Single currency/tax rate; costs are company-wide weighted average (not per location); MRP uses weekly buckets and lot-for-lot; placed orders can't be edited (cancel and re-enter, or ship available and backorder the rest).
