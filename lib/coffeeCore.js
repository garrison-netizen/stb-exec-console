// Coffee (STC) dashboard data layer: the Spindletap Coffee slice of the Ekos
// mirror. IMPORTANT DATA REALITY (verified 2026-07-22): Ekos records coffee
// as $0 internal transfers to "STB - Taproom" — there is NO coffee revenue in
// Ekos. Register sales live in Clover (pending API approval) and online in
// Shopify (not yet integrated). Until those land, this dashboard is honest
// about being a VOLUME + INVENTORY view.

import { getMirror } from './mirror.js'

function rows(db, sql) {
  const res = db.exec(sql)
  if (!res.length) return []
  const { columns, values } = res[0]
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])))
}
const one = (db, sql) => rows(db, sql)[0] || {}

function todayCT() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

// Item names look like "STC - Rise & Grind (STC - 12 oz bag)" — split into
// blend + pack for readable tables.
function splitItemName(name) {
  const m = /^STC - (.+?) \(STC - (.+)\)$/.exec(name || '')
  if (m) return { blend: m[1], pack: m[2] }
  return { blend: (name || '').replace(/^STC - /, ''), pack: '' }
}

export async function coffeeDashboard() {
  const { db, syncedAt } = await getMirror()
  const today = todayCT()
  const year = Number(today.slice(0, 4))
  const lyCutoff = String(year - 1) + today.slice(4)

  // Movement = invoice lines on STC - Packaged Coffee items (all $0 internal
  // transfers to the taproom; quantity is the signal).
  const moveYTD = one(db, `
    SELECT COUNT(DISTINCT f.InvoiceId) AS transfers, COUNT(*) AS lines
    FROM fact_invoice f
    JOIN dim_item i ON f.ItemId = i.ItemId
    JOIN dim_item_class c ON i.ItemClassID = c.ItemClassId
    WHERE c.ItemClassTitle = 'STC - Packaged Coffee'
      AND f.InvoiceOrderDate >= '${year}-01-01' AND f.InvoiceOrderDate <= '${today} 23:59:59'`)
  const moveLY = one(db, `
    SELECT COUNT(DISTINCT f.InvoiceId) AS transfers
    FROM fact_invoice f
    JOIN dim_item i ON f.ItemId = i.ItemId
    JOIN dim_item_class c ON i.ItemClassID = c.ItemClassId
    WHERE c.ItemClassTitle = 'STC - Packaged Coffee'
      AND f.InvoiceOrderDate >= '${year - 1}-01-01' AND f.InvoiceOrderDate <= '${lyCutoff} 23:59:59'`)

  // Monthly transfer activity, this year vs last (line counts — quantities
  // mix units across pack sizes, so counts are the comparable number).
  const monthlyRaw = rows(db, `
    SELECT substr(f.InvoiceOrderDate, 1, 4) AS y,
           substr(f.InvoiceOrderDate, 6, 2) AS m,
           COUNT(*) AS lines
    FROM fact_invoice f
    JOIN dim_item i ON f.ItemId = i.ItemId
    JOIN dim_item_class c ON i.ItemClassID = c.ItemClassId
    WHERE c.ItemClassTitle = 'STC - Packaged Coffee'
      AND f.InvoiceOrderDate >= '${year - 1}-01-01'
    GROUP BY y, m`)
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0')
    const cur = monthlyRaw.find((r) => r.y == year && r.m === mm)
    const ly = monthlyRaw.find((r) => r.y == year - 1 && r.m === mm)
    return { month: mm, lines: (cur && cur.lines) || 0, lastYear: (ly && ly.lines) || 0 }
  })

  // Top items moved YTD — quantity with the pack size in the name.
  const topItems = rows(db, `
    SELECT i.ItemName AS item, ROUND(SUM(f.Quantity), 1) AS qty
    FROM fact_invoice f
    JOIN dim_item i ON f.ItemId = i.ItemId
    JOIN dim_item_class c ON i.ItemClassID = c.ItemClassId
    WHERE c.ItemClassTitle = 'STC - Packaged Coffee'
      AND f.InvoiceOrderDate >= '${year}-01-01'
    GROUP BY i.ItemName ORDER BY qty DESC LIMIT 12
  `).map((r) => ({ ...splitItemName(r.item), qty: r.qty }))

  // Inventory position by STC class (current snapshot).
  const inventory = rows(db, `
    SELECT c.ItemClassTitle AS class, ROUND(SUM(fi.InventoryItemTotalValue)) AS value,
           COUNT(DISTINCT fi.ItemId) AS items
    FROM fact_inventory_item fi
    JOIN dim_item i ON fi.ItemId = i.ItemId
    JOIN dim_item_class c ON i.ItemClassID = c.ItemClassId
    WHERE c.ItemClassTitle IN ('STC - Packaged Coffee', 'STC - Ingredients', 'STC - Packaging Supplies')
      AND fi.InventoryItemQuantity <> 0
    GROUP BY c.ItemClassTitle ORDER BY value DESC`)
  const inventoryTotal = inventory.reduce((n, r) => n + (r.value || 0), 0)

  // Packaged coffee on hand, item level — the sellable shelf.
  const onHand = rows(db, `
    SELECT i.ItemName AS item, ROUND(SUM(fi.InventoryItemQuantity), 1) AS qty,
           ROUND(SUM(fi.InventoryItemTotalValue)) AS value
    FROM fact_inventory_item fi
    JOIN dim_item i ON fi.ItemId = i.ItemId
    JOIN dim_item_class c ON i.ItemClassID = c.ItemClassId
    WHERE c.ItemClassTitle = 'STC - Packaged Coffee' AND fi.InventoryItemQuantity <> 0
    GROUP BY i.ItemName ORDER BY value DESC LIMIT 12
  `).map((r) => ({ ...splitItemName(r.item), qty: r.qty, value: r.value }))

  return {
    generatedAt: new Date().toISOString(),
    ekosAsOf: syncedAt,
    today,
    year,
    kpis: {
      transfersYTD: moveYTD.transfers || 0,
      linesYTD: moveYTD.lines || 0,
      transfersLY: moveLY.transfers || 0,
      inventoryTotal,
      packagedValue: (inventory.find((r) => r.class === 'STC - Packaged Coffee') || {}).value || 0,
    },
    monthly,
    topItems,
    inventory,
    onHand,
  }
}
