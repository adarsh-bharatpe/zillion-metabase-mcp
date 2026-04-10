# Learning: `order_details` table (inferred schema & usage)

This document captures **everything we know about `order_details`** from **saved SQL / Metabase-style questions** used on this project. It is **not** a live `DESCRIBE` or Metabase **Table Metadata** export — validate names, types, and nullability in your warehouse before relying on it for production logic.

Related note: [VoucherGram daily order_mode rollup](./learnings-vouchergram-daily-order-mode-rollup.md) (joins `order_details` with `payment_transaction`).

---

## 1. What `order_details` appears to be

- **Role**: Detail-level facts for **orders** (possibly **multiple rows per logical order** or per **batch**).
- **Grouping key seen in analytics**: `fk_batch_id` — used to roll up lines into one **order batch**.
- **Monetary / loyalty fields**: `cash_paid`, `point_used`, `total_points`.
- **Dimensions**: `vendor`, `client`, `order_status`, user-ish `lcn_id`, audit `order_created_by`, time `created_at`.

**Grain caveat**: Any `SUM(cash_paid)` **without** `GROUP BY fk_batch_id` (or equivalent) sums **every detail row**. If one order has several lines, revenue can be **over-counted** relative to “order-level” revenue. The monthly snippet below uses raw `SUM(cash_paid)` — confirm whether that matches your business definition.

---

## 2. Columns observed in SQL (catalog)

| Column | Inferred role | Seen in which query / pattern |
|--------|----------------|------------------------------|
| `fk_batch_id` | Foreign key to an order **batch**; groups detail rows. | Daily rollup CTE `GROUP BY fk_batch_id`. |
| `cash_paid` | Cash / payment-gateway amount (currency unit assumed **INR** in analytics). | `SUM(cash_paid)` in batch rollup; `ROUND(SUM(cash_paid))` in monthly revenue. |
| `point_used` | Points redeemed on the line; may be null. | Batch rollup `SUM(COALESCE(point_used, total_points))`; hybrid / pure mode logic. |
| `total_points` | Fallback points field when `point_used` is null. | `COALESCE(point_used, total_points)` in batch rollup. |
| `lcn_id` | Customer / user identifier (LCN). | `MIN(lcn_id)` per batch; distinct user counts. |
| `created_at` | Row creation timestamp. | `DATE(created_at) = CURRENT_DATE`; `created_at >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')`. |
| `order_status` | Lifecycle / outcome of the order line (string enum). | Filter `= 'ORDER_SUCCESS'`; `MIN(order_status)` per batch (homogeneity assumed). |
| `vendor` | Supplier / program identifier. | Filter `= 'VOUCHAGRAM'`. |
| `client` | Channel / app client label. | Filter `IN ('BharatPe UPI', 'BharatPe_UPI', 'BharatPe')` in daily report. |
| `order_created_by` | Who or what created the order (null = not set / non-system in filters used). | Filter `IS NULL` in daily BharatPe slice. |

**Columns not proven by the snippets we have**: primary key name, foreign keys beyond naming, indexes, exact numeric types, timezone storage, and any other columns that exist in the physical table but never appeared in these queries.

---

## 3. Query pattern: current calendar month revenue (VoucherGram, success only)

**Intent (as written)**: Total **`cash_paid`** for **VoucherGram** rows with **`order_status = 'ORDER_SUCCESS'`** whose **`created_at`** falls in the **current month** (month start through “now”, depending on how `CURRENT_DATE` and timestamp comparison interact in your DB).

```sql
SELECT
    ROUND(SUM(cash_paid)) AS current_month_revenue
FROM order_details
WHERE vendor = 'VOUCHAGRAM'
  AND created_at >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')
  AND order_status = 'ORDER_SUCCESS';
```

**Dialect note**: `DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')` is **MySQL**-style. On **PostgreSQL** / **BigQuery** / others, use the equivalent “start of current month” expression (e.g. `date_trunc('month', current_date)`).

**Semantics note**: Upper bound is **implicit** — only a **lower bound** on `created_at`. Rows with future timestamps (if any) would be included; “current month” usually also implies `< start of next month` if you need a closed range.

**Revenue definition**: This is **sum of `cash_paid` at detail grain**, not “batch deduplicated” unless each batch has exactly one cash line. Align with finance before publishing.

---

## 4. How this ties to the daily batch rollup

| Topic | Monthly revenue query | Daily `order_mode` rollup |
|--------|------------------------|----------------------------|
| Vendor | `VOUCHAGRAM` | `VOUCHAGRAM` |
| Time | Month-to-date via month start | Single calendar day |
| Status | `ORDER_SUCCESS` at row level | Same, then adjusted with `payment_transaction` for cancel |
| Client / `order_created_by` | Not filtered | Restricted BharatPe clients + `order_created_by IS NULL` |
| Money | `cash_paid` only | `cash_paid` + points rule in another metric |

Reports are **not comparable** unless you align filters (client, creator, payment cancel logic, grain).

---

## 5. Recommended verification in Metabase / SQL

Run against the **same database** Metabase uses:

```sql
-- MySQL example
DESCRIBE order_details;
-- or
SHOW COLUMNS FROM order_details;
```

Use Metabase **Table metadata** or **Data model** to confirm types and foreign keys.

---

## 6. Source references (verbatim)

**Current month revenue** (user-provided):

```sql
SELECT
    ROUND(SUM(cash_paid)) AS current_month_revenue
FROM order_details
WHERE vendor = 'VOUCHAGRAM'
  AND created_at >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')
  AND order_status = 'ORDER_SUCCESS';
```

**Column usage from the VoucherGram daily rollup** is documented in [learnings-vouchergram-daily-order-mode-rollup.md](./learnings-vouchergram-daily-order-mode-rollup.md) §2.

---

*Maintained under `zillion-metabase-mcp` as inferred documentation for analysts; replace with warehouse-accurate metadata when available.*
