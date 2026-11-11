/**
 * Excel 导入/导出工具。
 * 导入：自动识别「入库登记表 / 出库台账 / 装车记录」三类表，规范化为行数据。
 * 导出：把发货记录生成「出库台账」「装车记录」两种样式的 .xlsx。
 *
 * exceljs 体积大，这里按需动态加载，不影响首屏。
 */

type ExcelJSModule = typeof import('exceljs')

async function loadExcelJS(): Promise<ExcelJSModule> {
  return import('exceljs')
}

export type TableKind = 'inbound' | 'outbound' | 'loading'

/** 解析后的规范行（列名 → 值），合并单元格已向下填充 */
export type ParsedRow = Record<string, string>

/** 中文日期「2026年6月1号」→ YYYY-MM-DD */
export function parseCnDate(s: string): string {
  if (!s) return ''
  const t = String(s).trim()
  const m = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]?/.exec(t)
  if (m) {
    const p = (n: string) => String(Number(n)).padStart(2, '0')
    return `${m[1]}-${p(m[2])}-${p(m[3])}`
  }
  // 已经是 YYYY-MM-DD 或 Excel 日期序号
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t)
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, '0')}-${String(Number(iso[3])).padStart(2, '0')}`
  return t
}

/** 把「立群80g梅干菜包（橡果）」这种品名里的（备注）去掉，便于匹配 */
function cleanName(s: string): string {
  return String(s ?? '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\s+/g, '')
    .trim()
}

/** 读一个单元格的文本值 */
function cellText(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: string | number }
    if (o.text) return String(o.text)
    if (o.result != null) return String(o.result)
    return ''
  }
  return String(v)
}

/** 按表头识别表类型 */
function detectKind(headers: string[]): TableKind {
  const h = headers.join('')
  if (h.includes('装车数量') || h.includes('车牌号') || h.includes('客户名称')) return 'loading'
  if (h.includes('当日出库') || h.includes('结存') || h.includes('出库')) return 'outbound'
  if (h.includes('当日库存数量') || h.includes('入库') || h.includes('保质期')) return 'inbound'
  return 'inbound'
}

/**
 * 解析一个 workbook 里第一个「有数据的 sheet」，返回表类型 + 规范化行。
 * 自动跳过标题行，定位表头行，并向下填充合并单元格。
 */
export async function parseWorkbook(buf: ArrayBuffer): Promise<{
  kind: TableKind
  headers: string[]
  rows: ParsedRow[]
}> {
  const wb = new (await loadExcelJS()).Workbook()
  await wb.xlsx.load(buf)

  let best: { headers: string[]; rows: ParsedRow[] } | null = null

  for (const ws of wb.worksheets) {
    // 找表头行：包含「品名/产品名称/日期」等关键字的那一行
    let headerRow = -1
    let headerCells: string[] = []
    for (let r = 1; r <= Math.min(ws.rowCount, 30); r++) {
      const row = ws.getRow(r)
      const cells: string[] = []
      row.eachCell({ includeEmpty: true }, (c, col) => {
        cells[col] = cellText(c.value)
      })
      const text = cells.join('')
      if (text.includes('品名') || text.includes('产品名称')) {
        headerRow = r
        headerCells = cells
        break
      }
    }
    if (headerRow < 0) continue

    // 表头列名（去空、去重）
    const headers: string[] = []
    headerCells.forEach((c, i) => {
      if (c && c.trim()) headers[i] = c.trim()
    })

    // 数据行：从表头下一行到最后，向下填充空列（合并单元格）
    const rows: ParsedRow[] = []
    const fill: Record<number, string> = {}
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const obj: ParsedRow = {}
      let hasAny = false
      headers.forEach((name, col) => {
        if (!name) return
        const v = cellText(row.getCell(col).value)
        let val = v
        if (!val) val = fill[col] ?? ''
        else fill[col] = val
        obj[name] = val
        if (val) hasAny = true
      })
      if (!hasAny) continue
      rows.push(obj)
    }

    if (rows.length > 0 && (!best || rows.length > best.rows.length)) {
      best = { headers: headers.filter(Boolean), rows }
    }
  }

  if (!best) {
    return { kind: 'inbound', headers: [], rows: [] }
  }
  return { kind: detectKind(best.headers), headers: best.headers, rows: best.rows }
}

/** 一行发货明细（从已发货订单派生，供台账视图和导出共用） */
export type ShipLine = {
  orderNo: string // 车次单号（FHxxxxxx），同一车同一品合并成一行
  date: string // 发货日期 YYYY-MM-DD
  customer: string // 客户/收货方名称
  product: string // 品名
  spec: string // 规格
  prodDate: string // 生产日期
  boxes: number // 箱数（件）
  /** 这个「品名 + 生产日期」的累计入库总箱数（库存数量，不随发货递减） */
  before: number
  /** 累计入库 − 累计出库的剩余箱数（结存） */
  after: number
}

/**
 * 从发货订单派生出库台账/装车记录的明细行。
 * 只统计已发货（shipped）的订单。
 *
 * 库存数量 / 结存按「品名 + 生产日期」推算：
 * 「库存数量」= 该品该日期的累计入库总箱数（固定，不随发货递减）；
 * 「结存」= 累计入库 − 累计出库（截至该行的当前剩余箱数）。
 */
export function buildShipLines(db: {
  orders: { no: string; status: string; destination: string; customerId: string; createdAt: number; pallets: { skuId: string; prodDate: string; layers: number; perLayer: number; topCount: number }[] }[]
  customers: { id: string; name: string }[]
  skus: { id: string; name: string; spec: string; perBox: number }[]
  moves?: { type: string; at: number; skuId: string; batchId?: string; qty: number; voided?: boolean }[]
  batches?: { id: string; skuId: string; prodDate: string }[]
}): ShipLine[] {
  const lines: ShipLine[] = []
  // 同一车 + 同一品 + 同一生产日期的多板合并成一行（装车数量 = 整车该品的总箱数）
  const agg = new Map<string, ShipLine>()
  for (const o of db.orders) {
    if (o.status !== 'shipped') continue
    const customer = db.customers.find((c) => c.id === o.customerId)
    for (const p of o.pallets) {
      const sku = db.skus.find((s) => s.id === p.skuId)
      if (!sku) continue
      const boxes = Math.max(0, (Math.max(1, p.layers) - 1) * Math.max(1, p.perLayer) + Math.max(0, p.topCount))
      const key = `${o.no}|${sku.id}|${p.prodDate}`
      const cur = agg.get(key)
      if (cur) {
        cur.boxes += boxes
      } else {
        agg.set(key, {
          orderNo: o.no,
          date: new Date(o.createdAt).toISOString().slice(0, 10),
          customer: customer?.name || o.destination,
          product: sku.name,
          spec: sku.spec,
          prodDate: p.prodDate,
          boxes,
          before: 0,
          after: 0,
        })
      }
    }
  }
  lines.push(...agg.values())
  lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  // —— 逐「品名 + 生产日期」推算库存数量 / 结存 ——
  // 每个 sku 一个箱规（件→箱 的折算）
  const perBoxOf = new Map(db.skus.filter((s) => s && s.id).map((s) => [s.id, s.perBox > 0 ? s.perBox : 1]))
  // batchId -> 生产日期，用于把入库流水归到「skuId + 生产日期」这一维度
  const batchProdDate = new Map((db.batches ?? []).filter((b) => b && b.id).map((b) => [b.id, b.prodDate]))
  const flowKey = (skuId: string, prodDate: string) => `${skuId}|${prodDate}`

  // 累计入库（件）：入库 / 回补 / 正调整；累计出库（件）：出库 / 负调整。
  // 「库存数量」= 累计入库总箱数（固定，不随发货递减）；「结存」= 累计入库 − 累计出库。
  const totalIn = new Map<string, number>()
  const totalOut = new Map<string, number>()
  for (const m of db.moves ?? []) {
    if (m.voided || !m.qty) continue
    const prodDate = (m.batchId ? batchProdDate.get(m.batchId) : undefined) ?? ''
    const key = flowKey(m.skuId, prodDate)
    if (m.type === 'out') {
      totalOut.set(key, (totalOut.get(key) ?? 0) + Math.abs(m.qty))
    } else if (m.type === 'adjust') {
      if (m.qty > 0) totalIn.set(key, (totalIn.get(key) ?? 0) + m.qty)
      else totalOut.set(key, (totalOut.get(key) ?? 0) + Math.abs(m.qty))
    } else {
      // in / return 都算入库存
      totalIn.set(key, (totalIn.get(key) ?? 0) + m.qty)
    }
  }

  // 逐行：库存数量固定 = 累计入库；结存随累计出库递减
  const outRunning = new Map<string, number>() // key -> 截至该行的累计出库件数
  for (const l of lines) {
    const skuMatch = db.skus.find((s) => s.name === l.product && s.spec === l.spec)
    if (!skuMatch) continue
    const key = flowKey(skuMatch.id, l.prodDate)
    const perBox = perBoxOf.get(skuMatch.id) ?? 1
    const inPcs = totalIn.get(key) ?? 0
    const outBefore = outRunning.get(key) ?? 0
    const outAfter = outBefore + l.boxes * perBox
    outRunning.set(key, outAfter)
    l.before = Math.max(0, Math.round(inPcs / perBox))
    l.after = Math.max(0, Math.round((inPcs - outAfter) / perBox))
  }

  return lines
}

/** 导出「出库台账」样式的 xlsx，并触发浏览器下载 */
export async function exportOutboundLedger(lines: ShipLine[], fileName: string) {
  const ExcelJS = await loadExcelJS()
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('冷库出库台账')
  ws.mergeCells('A1:H1')
  ws.getCell('A1').value = '冷库出库台账'
  ws.getCell('A1').font = { bold: true, size: 14 }
  ws.getCell('A1').alignment = { horizontal: 'center' }

  const header = ['发货日期', '生产日期', '品名', '规格', '库存数量', '当日出库', '结存', '备注']
  ws.addRow(header)
  ws.getRow(2).font = { bold: true }

  // 按 发货日期+品名+生产日期 聚合；库存/结存按逐日滚动取每行的 before/after
  const agg = new Map<string, { date: string; prodDate: string; product: string; spec: string; out: number; before: number; after: number }>()
  for (const l of lines) {
    const key = `${l.date}|${l.product}|${l.prodDate}`
    const e = agg.get(key)
    if (e) {
      e.out += l.boxes
      // 同一天多次发同一品：库存数量取最后一次发车前的值，结存取最后一次发车后的值
      e.before = l.before
      e.after = l.after
    } else {
      agg.set(key, { date: l.date, prodDate: l.prodDate, product: l.product, spec: l.spec, out: l.boxes, before: l.before, after: l.after })
    }
  }
  for (const [, e] of agg) {
    ws.addRow([e.date, e.prodDate, e.product, e.spec, e.before, e.out, e.after, ''])
  }

  ws.columns.forEach((c, i) => {
    c.width = [12, 12, 28, 14, 10, 10, 8, 12][i] ?? 12
  })

  const buf = await wb.xlsx.writeBuffer()
  downloadBlob(buf, fileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
}

/** 导出「装车记录」样式的 xlsx，并触发浏览器下载 */
export async function exportLoadingRecord(lines: ShipLine[], fileName: string) {
  const ExcelJS = await loadExcelJS()
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('装车记录一览表')
  ws.mergeCells('A1:K1')
  ws.getCell('A1').value = '装车记录一览表'
  ws.getCell('A1').font = { bold: true, size: 14 }
  ws.getCell('A1').alignment = { horizontal: 'center' }

  const header = ['日期', '客户名称', '产品名称', '规格', '生产日期', '装车数量', '销售电话', '车辆卫生情况', '保质期', '车牌号', '装车温度']
  ws.addRow(header)
  ws.getRow(2).font = { bold: true }

  for (const l of lines) {
    // 销售电话/车辆卫生情况/保质期/车牌号/装车温度：系统没有这些信息，留空
    ws.addRow([l.date, l.customer, l.product, l.spec, l.prodDate, l.boxes, '', '', '', '', ''])
  }

  ws.columns.forEach((c, i) => {
    c.width = [12, 16, 28, 14, 12, 10, 14, 12, 10, 12, 10][i] ?? 12
  })

  const buf = await wb.xlsx.writeBuffer()
  downloadBlob(buf, fileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
}

function downloadBlob(buf: ArrayBuffer, name: string, type: string) {
  const blob = new Blob([buf], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 把解析结果转成入库行（InboundRow） */
export function toInboundRows(kind: TableKind, rows: ParsedRow[]): {
  name: string
  spec: string
  qty: number
  prodDate: string
  date?: string
}[] {
  const out: { name: string; spec: string; qty: number; prodDate: string; date?: string }[] = []
  const field = (obj: ParsedRow, keys: string[]) => {
    for (const k of keys) if (obj[k]) return obj[k]
    return ''
  }
  for (const r of rows) {
    const name = field(r, ['品名', '产品名称', '名称'])
    if (!name) continue
    const spec = field(r, ['规格'])
    const qty = Number(field(r, ['当日库存数量（件）', '当日库存数量(件)', '数量', '当日出库', '装车数量']))
    const prodDate = parseCnDate(field(r, ['生产日期']))
    const date = parseCnDate(field(r, ['日期', '发货日期']))
    if (!(qty > 0)) continue
    out.push({ name: cleanName(name), spec, qty, prodDate, date })
  }
  return out
}
