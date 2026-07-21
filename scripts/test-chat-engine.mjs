// Smoke test for the Production chatbot's data engine (no API key needed):
// mirror loads, read-only guard holds, and representative queries answer.
// Usage: node scripts/test-chat-engine.mjs
import 'dotenv/config'
import { getMirror } from '../lib/mirror.js'
import { guardSql, runQuery } from '../lib/chatCore.js'

const { db, syncedAt } = await getMirror()
console.log('mirror loaded, synced_at =', syncedAt)

// Guard must reject writes and multi-statements
const bad = [
  'DROP TABLE fact_invoice',
  'SELECT 1; SELECT 2',
  "insert into fact_invoice values (1)",
  'PRAGMA table_info(fact_invoice)',
]
for (const sql of bad) {
  try {
    guardSql(sql)
    console.error('GUARD FAILED to reject:', sql)
    process.exit(1)
  } catch {
    console.log('guard rejected ok:', sql.slice(0, 40))
  }
}

// Representative Grade-A questions
const queries = {
  'on-hand finished beer value': `
    SELECT ic.ItemClassTitle, ROUND(SUM(f.InventoryItemTotalValue),0) AS Value
    FROM fact_inventory_item f
    JOIN dim_item i ON f.ItemId = i.ItemId
    JOIN dim_item_class ic ON i.ItemClassID = ic.ItemClassId
    WHERE f.InventoryItemQuantity <> 0 AND ic.ItemClassTitle LIKE 'Beer%'
    GROUP BY ic.ItemClassTitle`,
  'top 3 products 2026 by revenue': `
    SELECT p.ProductName, ROUND(SUM(f.InvoiceItemSubtotal),0) AS Rev
    FROM fact_invoice f JOIN dim_product p ON f.ProductId = p.ProductId
    WHERE f.InvoiceOrderDate >= '2026-01-01'
    GROUP BY p.ProductName ORDER BY Rev DESC LIMIT 3`,
  'batches in progress': `
    SELECT b.BatchNumber, p.ProductName, b.BatchStartDate
    FROM fact_batch b LEFT JOIN dim_product p ON b.ProductId = p.ProductId
    WHERE (b.BatchStatusId IS NULL OR b.BatchStatusId <> 3)
      AND b.BatchEndDate > datetime('now') LIMIT 5`,
  'YTD losses by reason': `
    SELECT r.AdjustmentReasonName, ROUND(SUM(a.AdjustmentCOGS),2) AS COGS
    FROM fact_adjustment a
    JOIN dim_adjustment_reason r ON a.AdjustmentReasonId = r.AdjustmentReasonId
    WHERE r.AdjustmentReasonName IN ('Breakage','Spoilage','Shrinkage','Destroyed')
      AND a.AdjustmentTransactionDate >= '2026-01-01'
    GROUP BY r.AdjustmentReasonName`,
}
for (const [label, sql] of Object.entries(queries)) {
  const { rows, total } = runQuery(db, sql)
  console.log(`\n== ${label} (${total ?? rows.length} rows) ==`)
  console.table(rows.slice(0, 5))
}
console.log('\nENGINE OK')
