# Learning: Zillion Auth `user_details` ↔ Middleware `order_details`

Use **Zillion Auth** for **account-level** facts (signup time, enrollment, logins) and **Zillion Middleware** for **order lines** (`order_details`). Metabase usually attaches **one SQL connection per database**, so a **single native query cannot `JOIN` across both** unless your platform exposes a federated view. The standard pattern is **two Metabase questions** (or export LCNS → second query).

> **Metabase labels observed in one environment** (IDs can differ in other Metabase instances): **Zillion Auth** ≈ MySQL `zillion_auth`; **Zillion Middleware** ≈ MySQL DB where `order_details` lives. Confirm **Admin → Databases** for your `database_id`.

---

## 1. Join key (verified)

| Middleware (`order_details`) | Zillion Auth (`user_details`) |
|------------------------------|--------------------------------|
| `lcn_id` (varchar) | `lcn` (varchar, **primary key**) |

Match **as text**; do not assume numeric types line up without casting.

**Sanity check**: For a row in `order_details`, `lcn_id` should equal `user_details.lcn` for the same customer. If `order_details.created_at` is **earlier** than `user_details.created_at`, treat as a **data-quality or fraud signal** (backfill, wrong `lcn_id`, clock skew, or account migration) until explained.

---

## 2. `user_details` columns (from `information_schema`, Zillion Auth)

Account / profile fields useful for investigations:

| Column | Type | Notes |
|--------|------|--------|
| `lcn` | varchar, PK | Join to `order_details.lcn_id` |
| `created_at` | datetime | **Account creation** time |
| `updated_at` | datetime | Last profile update |
| `enrollment_source` | varchar | How the user entered the program |
| `last_logged_in_at` | datetime | Generic last login |
| `last_android_logged_in_at` | datetime | Per-platform |
| `last_ios_logged_in_at` | datetime | Per-platform |
| `last_mweb_logged_in_at` | datetime | Per-platform |
| `last_dweb_logged_in_at` | datetime | Per-platform |
| `mobile_number` | varchar | **PII** — restrict access; useful for “same phone, many LCNS” link analysis |
| `email` | varchar | PII |
| `country` | varchar | |
| `first_name`, `middle_name`, `last_name`, `salutation` | varchar | PII |
| `gender`, `age`, `date_of_birth` | | PII / demographics |
| `logo_code`, `promo_code`, `types_member_card` | varchar | Program / card hints |
| `surrounding_area_key`, `surrounding_area_value` | varchar | |
| `lms_data_fetched_at` | datetime | |
| `force_password_update` | varchar | |
| `aliases` | json | |
| `zillion_plus_auto_renewal` | tinyint | |

---

## 3. Workflow in Metabase

### Step A — Middleware: users involved in suspicious batches

Run on the **same database as `order_details`** (e.g. Zillion Middleware):

```sql
SELECT DISTINCT
    od.lcn_id,
    MIN(od.created_at) AS first_order_at_in_set,
    MAX(od.created_at) AS last_order_at_in_set,
    COUNT(DISTINCT od.fk_batch_id) AS batch_count
FROM order_details od
WHERE od.fk_batch_id IN (/* ZLO... list */)
GROUP BY od.lcn_id;
```

Export **`lcn_id`** values (CSV) or paste into Step B.

### Step B — Auth: account creation and login context

Run on **Zillion Auth**:

```sql
SELECT
    u.lcn,
    u.created_at AS account_created_at,
    u.enrollment_source,
    u.last_logged_in_at,
    u.last_android_logged_in_at,
    u.last_ios_logged_in_at,
    u.last_mweb_logged_in_at,
    u.last_dweb_logged_in_at,
    u.country
FROM user_details u
WHERE u.lcn IN (/* paste LCNS from Step A */);
```

Add `mobile_number` / `email` only under **approved PII** policies.

### Step C — Compare timelines (spreadsheet or BI model)

Join the two result sets on `lcn_id` = `lcn` and compute:

- `first_order_at_in_set - account_created_at` → large **negative** gap ⇒ order **before** account (flag).
- Many batches per `lcn_id` in a short window ⇒ velocity / abuse pattern (combine with payment tables on Middleware).
- Same `enrollment_source` across many flagged users ⇒ channel collusion or campaign abuse hypothesis.

---

## 4. Optional: same mobile, multiple accounts (Auth only)

**Highly sensitive**; run only with governance approval.

```sql
SELECT mobile_number, COUNT(DISTINCT lcn) AS lcn_count
FROM user_details
WHERE mobile_number IS NOT NULL AND mobile_number <> ''
GROUP BY mobile_number
HAVING COUNT(DISTINCT lcn) > 1
ORDER BY lcn_count DESC;
```

Cross-reference resulting `lcn` values with Step A outputs.

---

## 5. Related docs

- [order_details schema & Middleware context](./learnings-order-details-schema.md)
- [VoucherGram batch rollup & `payment_transaction`](./learnings-vouchergram-daily-order-mode-rollup.md)

---

*Join key and `user_details` column list verified via Metabase native SQL on Zillion Auth; Metabase database names/ids are environment-specific.*
