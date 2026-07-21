// Production dashboard data layer: SQL over the Ekos mirror (same database
// the Production Assistant queries). Read-only; returns the model the
// Dashboard tab renders. Conventions follow lib/schema.js — loss reasons,
// header-vs-line grain on POs, finished-goods item classes.

import { getMirror } from './mirror.js'

const FINISHED_CLASSES = [
  'Beer-Packaged', 'Beer-Kegged', 'THC - Packaged', 'THC - Kegged',
  'STC - Packaged Coffee', 'Soda', 'Hop Water - Kegged',
]
const LOSS_REASONS = ['Breakage', 'Spoilage', 'Shrinkage', 'Destroyed']
const EXPIRING_DAYS = 60

function todayCT() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}
function addDaysISO(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const q = (s) => `'${s.replace(/'/g, "''")}'`
const list = (arr) => arr.map(q).join(', ')

function rows(db, sql) {
  const res = db.exec(sql)
  if (!res.length) return []
  const { columns, values } = res[0]
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])))
}
const one = (db, sql) => rows(db, sql)[0] || {}

export async function productionDashboard() {
  const { db, syncedAt } = await getMirror()
  const today = todayCT()
  const year = Number(today.slice(0, 4))
  const jan1 = `${year}-01-01`
  const lyJan1 = `${year - 1}-01-01`
  const lyCutoff = String(year - 1) + today.slice(4)
  const expireHorizon = addDaysISO(today, EXPIRING_DAYS)

  // ---- KPIs ----------------------------------------------------
  const finished = one(db, `
    SELECT ROUND(SUM(f.InventoryItemTotalValue)) AS value
    FROM fact_inventory_item f
    JOIN dim_item i ON f.ItemId = i.ItemId
    JOIN dim_item_class c ON i.ItemClassID = c.ItemClassId
    WHERE f.InventoryItemQuantity <> 0 AND c.ItemClassTitle IN (${list(FINISHED_CLASSES)})`)

  const totalInv = one(db, `
    SELECT ROUND(SUM(InventoryItemTotalValue)) AS value
    FROM fact_inventory_item WHERE InventoryItemQuantity <> 0`)

  const inProgress = rows(db, `
    SELECT b.BatchNumber AS batch, COALESCE(p.ProductName, '—') AS product,
           substr(b.BatchStartDate, 1, 10) AS started,
           CAST(julianday('now') - julianday(b.BatchStartDate) AS INTEGER) AS days
    FROM fact_batch b
    LEFT JOIN dim_product p ON b.ProductId = p.ProductId
    WHERE b.BatchEndDate IS NULL AND (b.BatchStatusId IS NULL OR b.BatchStatusId <> 3)
    ORDER BY b.BatchStartDate`)

  const batchesYTD = one(db, `
    SELECT COUNT(*) AS n FROM fact_batch
    WHERE (BatchStatusId IS NULL OR BatchStatusId <> 3)
      AND BatchEndDate >= '${jan1}' AND BatchEndDate <= '${today} 23:59:59'`)
  const batchesLY = one(db, `
    SELECT COUNT(*) AS n FROM fact_batch
    WHERE (BatchStatusId IS NULL OR BatchStatusId <> 3)
      AND BatchEndDate >= '${lyJan1}' AND BatchEndDate <= '${lyCutoff} 23:59:59'`)

  const lossSql = (from, to) => `
    SELECT ROUND(-SUM(a.AdjustmentCOGS)) AS dollars
    FROM fact_adjustment a
    JOIN dim_adjustment_reason r ON a.AdjustmentReasonId = r.AdjustmentReasonId
    WHERE r.AdjustmentReasonName IN (${list(LOSS_REASONS)})
      AND a.AdjustmentTransactionDate >= '${from}' AND a.AdjustmentTransactionDate <= '${to} 23:59:59'`
  const lossYTD = one(db, lossSql(jan1, today))
  const lossLY = one(db, lossSql(lyJan1, lyCutoff))

  // ---- Monthly losses (this year vs last year) -----------------
  const lossByMonth = rows(db, `
    SELECT substr(a.AdjustmentTransactionDate, 1, 4) AS y,
           substr(a.AdjustmentTransactionDate, 6, 2) AS m,
           ROUND(-SUM(a.AdjustmentCOGS)) AS dollars
    FROM fact_adjustment a
    JOIN dim_adjustment_reason r ON a.AdjustmentReasonId = r.AdjustmentReasonId
    WHERE r.AdjustmentReasonName IN (${list(LOSS_REASONS)})
      AND a.AdjustmentTransactionDate >= '${lyJan1}'
    GROUP BY y, m`)
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0')
    const cur = lossByMonth.find((r) => r.y == year && r.m === mm)
    const ly = lossByMonth.find((r) => r.y == year - 1 && r.m === mm)
    return { month: mm, loss: (cur && cur.dollars) || 0, lastYear: (ly && ly.dollars) || 0 }
  })

  // ---- Needs attention -----------------------------------------
  const expiring = rows(db, `
    SELECT i.ItemName AS item, substr(f.InventoryItemExpireDate, 1, 10) AS expires,
           ROUND(SUM(f.InventoryItemQuantity)) AS qty, ROUND(SUM(f.InventoryItemTotalValue)) AS value
    FROM fact_inventory_item f
    JOIN dim_item i ON f.ItemId = i.ItemId
    WHERE f.InventoryItemQuantity <> 0
      AND f.InventoryItemExpireDate >= '${today}' AND f.InventoryItemExpireDate <= '${expireHorizon} 23:59:59'
    GROUP BY f.ItemId, expires
    ORDER BY expires, value DESC
    LIMIT 12`)
  const expiringTotal = one(db, `
    SELECT ROUND(SUM(f.InventoryItemTotalValue)) AS value, COUNT(DISTINCT f.ItemId) AS items
    FROM fact_inventory_item f
    WHERE f.InventoryItemQuantity <> 0
      AND f.InventoryItemExpireDate >= '${today}' AND f.InventoryItemExpireDate <= '${expireHorizon} 23:59:59'`)

  // Only POs raised in the last 12 months: Ekos carries years-old POs that
  // were never formally closed, and they'd drown the actionable list.
  const poFloor = addDaysISO(today, -365)
  const openPOs = rows(db, `
    SELECT po.PurchaseOrderNumber AS number, COALESCE(c.CompanyName, '—') AS vendor,
           substr(MIN(po.ExpectedDeliveryDate), 1, 10) AS expected,
           ROUND(MAX(po.TotalCost)) AS cost
    FROM fact_purchase_order po
    LEFT JOIN dim_company c ON po.CompanyId = c.CompanyId
    WHERE po.PurchaseOrderDate >= '${poFloor}'
    GROUP BY po.PurchaseOrderId
    HAVING SUM(po.QuantityOrdered - po.QuantityReceived) > 0
    ORDER BY expected
    LIMIT 12`)
  const overdue = openPOs.filter((p) => p.expected && p.expected < today).length
  const stalePOs = one(db, `
    SELECT COUNT(*) AS n FROM (
      SELECT po.PurchaseOrderId FROM fact_purchase_order po
      WHERE po.PurchaseOrderDate < '${poFloor}'
      GROUP BY po.PurchaseOrderId
      HAVING SUM(po.QuantityOrdered - po.QuantityReceived) > 0)`)

  return {
    generatedAt: new Date().toISOString(),
    dataAsOf: syncedAt,
    today,
    kpis: {
      finishedValue: finished.value || 0,
      totalValue: totalInv.value || 0,
      inProgress: inProgress.length,
      batchesYTD: batchesYTD.n || 0,
      batchesLY: batchesLY.n || 0,
      lossYTD: lossYTD.dollars || 0,
      lossLY: lossLY.dollars || 0,
    },
    inProgress,
    expiring,
    expiringTotal: { value: expiringTotal.value || 0, items: expiringTotal.items || 0 },
    expiringDays: EXPIRING_DAYS,
    openPOs,
    overduePOs: overdue,
    stalePOs: stalePOs.n || 0,
    monthly,
  }
}
