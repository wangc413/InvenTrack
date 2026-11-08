import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Box3D from '../components/Box3D'
import { Icon, Stepper, toast } from '../components/UI'
import {
  PALLET_H,
  fmt,
  fmtDate,
  fmtTime,
  layerExpr,
  layerPlan,
  maxLayers,
  palletName,
  summarize,
} from '../lib/calc'
import {
  DEFAULT_LAYERS,
  DEFAULT_PER_LAYER,
  addPallet,
  createOrder,
  customerById,
  getState,
  loadedBoxes,
  nickOf,
  normalizePlan,
  palletBoxes,
  planSummary,
  plannedBoxes,
  removeOrder,
  removePallet,
  shipOrder,
  shortages,
  skusOfCustomer,
  stockByDate,
  stockOfDate,
  updateOrder,
  updatePallet,
  useDB,
  type Order,
  type Pallet,
  type PlanLine,
  type Sku,
} from '../lib/store'

export type PalletSpec3D = { no: string; sku: Sku; layers: number; perLayer: number; topCount: number }

/**
 * 图标按钮，点一下先进入待确认状态（变红、出「确认」二字），再点一下才真正执行。
 * 板上几百箱货，误触一下移除就全没了 —— 这一停必须留。
 */
function ConfirmIconBtn({ icon, label, onConfirm }: { icon: string; label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <button
      type="button"
      className={`pallet-ico ${armed ? 'armed' : ''}`}
      title={label}
      aria-label={armed ? `确认${label}` : label}
      onClick={() => {
        if (armed) {
          window.clearTimeout(timer.current)
          setArmed(false)
          onConfirm()
          return
        }
        setArmed(true)
        timer.current = window.setTimeout(() => setArmed(false), 2600)
      }}
    >
      <Icon name={icon} size={15} />
      {armed && <span>确认</span>}
    </button>
  )
}

/** 从车次算出 3D 预览需要的规格 */
export function specOfOrder(db: ReturnType<typeof useDB>, order: Order): PalletSpec3D[] {
  const out: PalletSpec3D[] = []
  for (const p of order.pallets) {
    const sku = db.skus.find((s) => s.id === p.skuId)
    if (!sku) continue
    out.push({ no: p.no, sku, layers: p.layers, perLayer: p.perLayer, topCount: p.topCount })
  }
  return out
}

/* ---------- 要货计划：品 + 生产日期 + 箱数 ---------- */

type PlanRow = { key: string; skuId: string; prodDate: string; boxes: string }
const rowKey = () => Math.random().toString(36).slice(2, 9)
const emptyRow = (): PlanRow => ({ key: rowKey(), skuId: '', prodDate: '', boxes: '' })
const rowsToLines = (rows: PlanRow[]): PlanLine[] =>
  rows.map((r) => ({ id: rowKey(), skuId: r.skuId, prodDate: r.prodDate, boxes: Number(r.boxes) || 0 }))
const linesToRows = (lines: PlanLine[]): PlanRow[] =>
  lines.length > 0
    ? lines.map((l) => ({ key: rowKey(), skuId: l.skuId, prodDate: l.prodDate, boxes: String(l.boxes) }))
    : [emptyRow()]

/**
 * 一行 = 一个品 + 一个生产日期 + 多少箱。
 * 同品不同日期就写两行（11-02 肉包 150 箱、11-04 肉包 288 箱）。
 * 品项和日期都用「胶囊点开弹层」这一套交互，不搞粗糙的原生下拉。
 */
function PlanEditor({
  db,
  customerId,
  rows,
  onChange,
}: {
  db: ReturnType<typeof useDB>
  customerId: string
  rows: PlanRow[]
  onChange: (rows: PlanRow[]) => void
}) {
  const skus = customerId ? skusOfCustomer(db, customerId) : []
  const set = (key: string, patch: Partial<PlanRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const total = rows.reduce((s, r) => s + (Number(r.boxes) || 0), 0)
  const valid = rows.filter((r) => r.skuId && r.prodDate && Number(r.boxes) > 0).length
  /** 当前点开的弹层：{ key, type } 只跟一行、一种（品/日期）联动 */
  const [menu, setMenu] = useState<{ key: string; type: 'sku' | 'date' } | null>(null)

  const close = () => setMenu(null)
  const open = (key: string, type: 'sku' | 'date') =>
    setMenu((m) => (m && m.key === key && m.type === type ? null : { key, type }))

  return (
    <div className="plan-editor">
      {rows.map((r, i) => {
        const sku = skus.find((s) => s.id === r.skuId)
        /** 这个品有货的生产日期（从新到旧），每个日期还剩多少件 */
        const inStock = r.skuId ? stockByDate(db, r.skuId) : []
        /** 当前选中的日期还剩多少箱 */
        const dateLeft = sku && r.prodDate ? Math.floor(stockOfDate(db, r.skuId, r.prodDate) / (sku.perBox || 1)) : 0
        const boxes = Number(r.boxes) || 0
        /** 箱数超过这个日期的库存了 */
        const over = r.skuId && r.prodDate && boxes > 0 && boxes > dateLeft
        const skuOpen = menu?.key === r.key && menu.type === 'sku'
        const dateOpen = menu?.key === r.key && menu.type === 'date'
        return (
          <div className="plan-row" key={r.key}>
            <div className="plan-row-head">
              <span className="plan-idx">{i + 1}</span>
              <button
                type="button"
                className={`plan-pick ${sku ? '' : 'placeholder'}`}
                onClick={() => open(r.key, 'sku')}
              >
                {sku && <span className="dot" style={{ background: sku.accentColor }} />}
                <b>{sku ? nickOf(sku) : '选品'}</b>
                <i className="caret" />
              </button>
            </div>
            {skuOpen && (
              <div className="plan-inline">
                {skus.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`chip ${r.skuId === s.id ? 'on' : ''}`}
                    onClick={() => {
                      set(r.key, { skuId: s.id, prodDate: '' })
                      close()
                    }}
                  >
                    <span className="chip-dot" style={{ background: s.accentColor }} />
                    {nickOf(s)}
                    {r.skuId === s.id && <Icon name="check" size={16} />}
                  </button>
                ))}
              </div>
            )}

            <div className="plan-row-fields">
              <div className="plan-date-wrap">
                <button
                  type="button"
                  className={`plan-pick plan-date-pick ${r.prodDate ? '' : 'placeholder'}`}
                  disabled={!sku}
                  onClick={() => open(r.key, 'date')}
                >
                  <b>{r.prodDate ? `${fmtDate(r.prodDate)} · ${dateLeft} 箱` : sku ? '选日期' : '先选品'}</b>
                  <i className="caret" />
                </button>
              </div>
              <div className="plan-boxes">
                <input
                  className={`input ${over ? 'err' : ''}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  placeholder="箱数"
                  value={r.boxes}
                  onChange={(e) => set(r.key, { boxes: e.target.value })}
                  aria-label="箱数"
                />
                <em>箱</em>
              </div>
            </div>
            {dateOpen && (
              <div className="plan-inline">
                {inStock.length > 0 ? (
                  inStock.map((d) => (
                    <button
                      key={d.prodDate}
                      type="button"
                      className={`chip ${r.prodDate === d.prodDate ? 'on' : ''}`}
                      onClick={() => {
                        set(r.key, { prodDate: d.prodDate })
                        close()
                      }}
                    >
                      {fmtDate(d.prodDate)}
                      <em className="chip-sub">{Math.floor(d.left / (sku?.perBox || 1))} 箱</em>
                      {r.prodDate === d.prodDate && <Icon name="check" size={16} />}
                    </button>
                  ))
                ) : (
                  <div className="hint">这个品还没入库，先去「库存」页录入</div>
                )}
              </div>
            )}

            {over && <div className="plan-err">超库存了，这天只剩 {dateLeft} 箱</div>}
          </div>
        )
      })}

      <button type="button" className="btn plan-add" onClick={() => onChange([...rows, emptyRow()])}>
        + 添加其他品类
      </button>
      {rows.length > 0 && (
        <div className="plan-total">
          填好 <b>{valid}</b> 行 · 合计 <b>{total}</b> 箱
        </div>
      )}
    </div>
  )
}

/* ---------- 新建车次：送到哪、发给谁、发哪些货 ---------- */

/** 收货地记忆：输过一次就记住，存在本地，清数据也不丢 */
const DEST_KEY = 'inventrack-destinations'

function loadDestinations(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DEST_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function rememberDestination(d: string) {
  const list = loadDestinations().filter((x) => x !== d)
  list.unshift(d)
  try {
    localStorage.setItem(DEST_KEY, JSON.stringify(list.slice(0, 12)))
  } catch {
    /* 忽略 */
  }
}

function NewOrderForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const db = useDB()

  /** 最近用过的收货地：本地记忆 + 历史车次，点一下直接填 */
  const recent = useMemo(() => {
    const out: string[] = []
    for (const d of [...loadDestinations(), ...db.orders.map((o) => o.destination)]) {
      const t = d.trim()
      if (t && !out.includes(t)) out.push(t)
    }
    return out.slice(0, 8)
  }, [db.orders])

  const [destination, setDestination] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [planRows, setPlanRows] = useState<PlanRow[]>([emptyRow()])
  /** 收货方下拉弹层开关 */
  const [customerOpen, setCustomerOpen] = useState(false)

  /** 换收货方时，把不属于新收货方的品清掉，免得串货 */
  const pickCustomer = (id: string) => {
    setCustomerId(id)
    const allowed = new Set(skusOfCustomer(db, id).map((s) => s.id))
    setPlanRows((rows) => rows.map((r) => (allowed.has(r.skuId) ? r : { ...r, skuId: '' })))
  }

  const create = () => {
    const dest = destination.trim()
    if (!dest) return toast('先填收货地')
    if (!customerId) return toast('先选收货方')
    const filled = planRows.filter((r) => r.skuId || r.prodDate || r.boxes)
    if (filled.some((r) => !r.skuId || !r.prodDate || !(Number(r.boxes) > 0)))
      return toast('要货计划有没填全的行：品、日期、箱数都要填')
    // 箱数不能超过这个品这个日期的库存
    for (const r of filled) {
      const sku = db.skus.find((s) => s.id === r.skuId)
      if (!sku) continue
      const left = Math.floor(stockOfDate(db, r.skuId, r.prodDate) / (sku.perBox || 1))
      if (Number(r.boxes) > left)
        return toast(`${nickOf(sku)} ${fmtDate(r.prodDate)} 只剩 ${left} 箱，箱数填超了`)
    }
    rememberDestination(dest)
    const id = createOrder({ destination: dest, customerId, plan: rowsToLines(filled) })
    onCreated(id)
  }

  return (
    <>
      <div className="page with-dock">
        <header className="topbar back-mode">
          <button className="icon-btn" onClick={onCancel} aria-label="返回">
            <Icon name="back" size={22} />
          </button>
          <h1>新建车次</h1>
        </header>

        <div className="card card-pad">
          <input
            className="input"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="收货地（门店名或地址）"
            autoFocus
          />
          {recent.length > 0 && (
            <div className="chips" style={{ marginTop: 10 }}>
              {recent.map((d) => (
                <button
                  key={d}
                  className={`chip ${destination === d ? 'on' : ''}`}
                  onClick={() => setDestination(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="card card-pad" style={{ marginTop: 8, overflow: 'visible' }}>
          <button
            type="button"
            className={`plan-pick plan-customer-pick ${customerId ? '' : 'placeholder'}`}
            onClick={() => setCustomerOpen((v) => !v)}
          >
            <b>{customerId ? (db.customers.find((c) => c.id === customerId)?.name ?? '收货方') : '收货方'}</b>
            <i className="caret" />
          </button>
          {customerOpen && (
            <div className="plan-inline">
              {db.customers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`chip ${customerId === c.id ? 'on' : ''}`}
                  onClick={() => {
                    pickCustomer(c.id)
                    setCustomerOpen(false)
                  }}
                >
                  {c.name}
                  {customerId === c.id && <Icon name="check" size={16} />}
                </button>
              ))}
            </div>
          )}
        </div>

        {customerId && (
          <div className="card card-pad" style={{ marginTop: 8, overflow: 'visible' }}>
            <PlanEditor db={db} customerId={customerId} rows={planRows} onChange={setPlanRows} />
          </div>
        )}

        <div style={{ height: 12 }} />
      </div>

      <div className="dock">
        <button className="btn primary" onClick={create} disabled={!destination.trim() || !customerId}>
          创建并开始装板
        </button>
      </div>
    </>
  )
}

/** 建好之后也能回来改计划，免得填错了整趟车删掉重来 */
function PlanEditPage({ order, onCancel, onSaved }: { order: Order; onCancel: () => void; onSaved: () => void }) {
  const db = useDB()
  const [rows, setRows] = useState<PlanRow[]>(() => linesToRows(order.plan ?? []))

  const save = () => {
    const filled = rows.filter((r) => r.skuId || r.prodDate || r.boxes)
    if (filled.some((r) => !r.skuId || !r.prodDate || !(Number(r.boxes) > 0)))
      return toast('要货计划有没填全的行：品、日期、箱数都要填')
    updateOrder(order.id, { plan: normalizePlan(rowsToLines(filled)) })
    toast('要货计划已更新')
    onSaved()
  }

  return (
    <>
      <div className="page with-dock">
        <header className="topbar back-mode">
          <button className="icon-btn" onClick={onCancel} aria-label="返回">
            <Icon name="back" size={22} />
          </button>
          <h1>改要货计划</h1>
          <p className="sub">{order.destination} · {order.no}</p>
        </header>
        <div className="card card-pad">
          <PlanEditor db={db} customerId={order.customerId} rows={rows} onChange={setRows} />
        </div>
        <div style={{ height: 12 }} />
      </div>
      <div className="dock">
        <button className="btn primary" onClick={save}>
          保存计划
        </button>
      </div>
    </>
  )
}

/* ---------- 装板工作台 ---------- */

/**
 * 一块板一屏：3D 占满，品 / 日期收成两个下拉，层数和顶层直接在 3D 上按 + / −。
 * 点「装上」把这块定下来，清空成下一块空板，接着装。
 */
function PackingBoard({
  order,
  editing,
  onBack,
}: {
  order: Order
  editing: Pallet | null
  onBack: () => void
}) {
  const db = useDB()
  const skus = skusOfCustomer(db, order.customerId)
  const planLines = order.plan ?? []
  const ps = planSummary(order)
  const planSkuIds = new Set(planLines.map((l) => l.skuId))
  /** 计划里的品排前面，现场临时加货仍能从下面挑 */
  const orderedSkus = [...skus].sort(
    (a, b) => Number(planSkuIds.has(b.id)) - Number(planSkuIds.has(a.id)),
  )

  const [skuId, setSkuId] = useState(editing?.skuId ?? '')
  const [prodDate, setProdDate] = useState(editing?.prodDate ?? '')
  const [layers, setLayers] = useState(editing?.layers ?? DEFAULT_LAYERS)
  const [topCount, setTopCount] = useState(editing?.topCount ?? DEFAULT_PER_LAYER)
  /** 当前展开的是哪个下拉：品 / 生产日期 */
  const [menu, setMenu] = useState<'sku' | 'date' | null>(null)
  /** 是否在手动选品/换品。连续装板时 false，顶部只显示「正在装」信息条，不打扰 */
  const [picking, setPicking] = useState(false)

  const sku = skus.find((s) => s.id === skuId) ?? null
  const stockDates = sku ? stockByDate(db, sku.id) : []
  /** 日期 = 计划里定的日期 ∪ 有库存的日期；计划日期就算还没入库也要能看见 */
  const dates = sku
    ? [
        ...new Set([
          ...planLines.filter((l) => l.skuId === sku.id).map((l) => l.prodDate),
          ...stockDates.map((d) => d.prodDate),
        ]),
      ]
        .sort((a, b) => b.localeCompare(a))
        .map((prodDate) => ({
          prodDate,
          left: stockDates.find((d) => d.prodDate === prodDate)?.left ?? 0,
          planned: plannedBoxes(order, sku.id, prodDate),
          done: loadedBoxes(order, sku.id, prodDate, editing?.id),
        }))
    : []
  const picked = dates.find((d) => d.prodDate === prodDate)

  /** 一层比托盘多出来多少，给成「前后各 4.5 厘米」这样的人话（按单边算） */
function overText(over: { x: number; z: number }) {
  const parts: string[] = []
  if (over.x > 0) parts.push(`左右各 ${fmt(over.x / 20, 1)} 厘米`)
  if (over.z > 0) parts.push(`前后各 ${fmt(over.z / 20, 1)} 厘米`)
  return `${parts.join('、')}`
}

/** 一层怎么摆是写死的：包子 3 竖 + 4 横 = 7 个，烧麦 3 竖 + 2 横 = 5 个，饺子 6 竖 + 4 横 = 10 个 */
  const plan = sku ? layerPlan(sku) : null
  const perLayer = plan?.perLayer ?? 0
  const perBox = sku?.perBox || 1
  const top = perLayer > 0 ? Math.min(Math.max(1, topCount), perLayer) : 0
  const boxes = sku ? Math.max(0, (layers - 1) * perLayer + top) : 0
  /** 口算式：码的时候随时能对总数 */
  const formula = sku ? layerExpr(layers, perLayer, top) : ''

  /** 这个日期账面上还剩多少箱 */
  const leftBoxes = Math.floor((picked?.left ?? 0) / perBox)
  /** 别的板已经占掉的（同品 + 同日期） */
  const taken = order.pallets
    .filter((p) => p.skuId === skuId && p.prodDate === prodDate && p.id !== editing?.id)
    .reduce((n, p) => n + palletBoxes(p), 0)
  const avail = Math.max(0, leftBoxes - taken)
  const over = boxes - avail

  /** 层数不设死上限，超了只提醒 —— 现场真有人码到 2 米 */
  const softLayers = sku ? maxLayers(sku) : DEFAULT_LAYERS
  const tooTall = layers > softLayers

  const palletNo = editing?.no ?? `P${order.pallets.length + 1}`
  const palletLabel = palletName(palletNo)
  const nextLabel = palletName(`P${order.pallets.length + 2}`)

  /**
   * 按「这条计划还剩多少箱」自动配这一板：能码满就码满，装不满就自动收顶层。
   * 一板最多码到 maxLayers（1.8 米），剩下的留给下一板，用户还能随时手动 + −。
   */
  const fitPlan = (s: Sku, d: string, doneOverride?: number) => {
    const target = Math.max(
      0,
      plannedBoxes(order, s.id, d) - (doneOverride ?? loadedBoxes(order, s.id, d, editing?.id)),
    )
    const p = layerPlan(s)
    if (target <= 0) {
      // 计划已装齐，不再自动配满 —— 配一层让用户看清是「超计划」状态，由按钮禁用兜底
      setLayers(1)
      setTopCount(p.perLayer)
      return
    }
    const capMax = Math.max(1, Math.min(24, maxLayers(s)))
    const cap = Math.max(1, Math.min(capMax, Math.ceil(target / p.perLayer)))
    const top = target - (cap - 1) * p.perLayer
    setLayers(cap)
    setTopCount(Math.max(1, Math.min(p.perLayer, top)))
  }

  const pickSku = (s: Sku) => {
    setSkuId(s.id)
    // 优先带出这个品还没装齐的那个生产日期
    const lines = planLines.filter((l) => l.skuId === s.id)
    const next =
      lines.find(
        (l) => plannedBoxes(order, s.id, l.prodDate) > loadedBoxes(order, s.id, l.prodDate, editing?.id),
      ) ?? lines[0]
    const d = next?.prodDate ?? stockByDate(db, s.id)[0]?.prodDate ?? ''
    setProdDate(d)
    if (!editing && d) fitPlan(s, d)
    // 选品和日期是一个连贯动作：品定了，紧接着看这个品有哪些日期
    setMenu('date')
  }

  const pickDate = (d: string) => {
    setProdDate(d)
    if (!editing && sku) fitPlan(sku, d)
    setMenu(null)
    setPicking(false)
  }

  const putOn = () => {
    if (!sku) return toast('先选装什么')
    if (!prodDate) return toast('这个品还没有库存')
    if (boxes <= 0) return toast('这一板还没码上箱子')
    if (over > 0) return toast(`库存不足：${fmtDate(prodDate)} 还能装 ${avail} 箱`)

    // 有计划时，超了计划箱数就不让装（计划外临时加货不受这条限制）
    const planned = plannedBoxes(order, skuId, prodDate)
    const done = loadedBoxes(order, skuId, prodDate, editing?.id)
    if (planned > 0 && done + boxes > planned) {
      return toast(`超出计划：${nickOf(sku)} ${fmtDate(prodDate)} 计划 ${planned} 箱，已装 ${done} 箱，最多还能装 ${Math.max(0, planned - done)} 箱`)
    }

    const payload = { skuId, prodDate, layers, perLayer, topCount: top }
    if (editing) {
      updatePallet(order.id, editing.id, payload)
      toast(`${palletName(editing.no)} 已改好`)
      onBack()
      return
    }
    addPallet(order.id, payload)

    /** 刚放上去的那一板还没进 state，先手动算进去，才能找对下一条没装齐的计划 */
    const doneAfter = (sid: string, pd: string) =>
      loadedBoxes(order, sid, pd) + (sid === skuId && pd === prodDate ? boxes : 0)
    const leftOf = (l: PlanLine) => l.boxes - doneAfter(l.skuId, l.prodDate)
    // 先把手上这条（同品同日期）装齐，再按填计划的顺序往下走，不来回跳品
    const next =
      planLines.find((l) => l.skuId === skuId && l.prodDate === prodDate && leftOf(l) > 0) ??
      planLines.find((l) => leftOf(l) > 0)
    const nextSku = next ? skus.find((s) => s.id === next.skuId) : null
    // 手上这条（同品同日期）还没装完 → 无缝继续，不换品
    const sameBatch = planLines.some(
      (l) => l.skuId === skuId && l.prodDate === prodDate && leftOf(l) > 0,
    )
    if (next && nextSku) {
      setSkuId(nextSku.id)
      setProdDate(next.prodDate)
      fitPlan(nextSku, next.prodDate, doneAfter(nextSku.id, next.prodDate))
      setPicking(false)
      if (sameBatch) {
        // 还是这个品这个日期，接着码下一板，别打断
        toast(`${palletLabel} 已上车 · 接着装 ${nickOf(nextSku)} ${fmtDate(next.prodDate)}，还差 ${leftOf(next)} 箱`)
      } else {
        // 这个批次装完了，跳到下一个品/日期
        toast(`这个批次装完啦，换品 → ${nickOf(nextSku)} ${fmtDate(next.prodDate)}，还差 ${leftOf(next)} 箱`)
      }
    } else {
      // 有计划且全部装齐 → 回总览页，让用户核对所有板数和每板装量后再手动发车
      if (planLines.length > 0) {
        toast('计划已全部装齐，回到总览核对后发车')
        onBack()
        return
      }
      // 没有待装计划了（纯临时装货），3D 回到一块空托盘接着装
      setSkuId('')
      setProdDate('')
      setPicking(false)
      toast(`${palletLabel} 已上车，接着装 ${nextLabel}`)
    }
  }

  const spec = sku ? [{ no: palletNo, sku, layers, perLayer, topCount: top }] : []
  const stackH = sku ? (layers * sku.boxH + PALLET_H) / 1000 : 0
  const warn =
    over > 0
      ? avail <= 0
        ? '这天还没入库，先去「库存」页录入'
        : `库存不足：这天只能装 ${avail} 箱`
      : tooTall
        ? `码高 ${fmt(stackH, 2)} m，超过 1.8 m`
        : ''

  /** 有计划时，HUD 上那行小字改成「这一条还差多少」，装一板就能对一次账 */
  const planBoxesHere = sku && prodDate ? plannedBoxes(order, sku.id, prodDate) : 0
  const planDoneHere = sku && prodDate ? loadedBoxes(order, sku.id, prodDate, editing?.id) : 0
  /** 这一板装下去，会不会超过这个品+日期的计划箱数 */
  const overPlan = planBoxesHere > 0 && planDoneHere + boxes > planBoxesHere
  const planLeftAfter = planBoxesHere > 0 ? planBoxesHere - planDoneHere - boxes : 0
  const planHint =
    planBoxesHere > 0
      ? overPlan
        ? `超计划 ${planDoneHere + boxes - planBoxesHere} 箱 · 计划 ${planBoxesHere} 箱`
        : planLeftAfter > 0
          ? `还差 ${planLeftAfter} 箱 · 计划 ${planBoxesHere} 箱`
          : `已装齐 · 计划 ${planBoxesHere} 箱`
      : prodDate
        ? `这天还能装 ${avail} 箱`
        : '还没选生产日期'

  return (
    <>
      <div className="page pack-page">
        <header className="topbar back-mode">
          <button className="icon-btn" onClick={onBack} aria-label="返回">
            <Icon name="back" size={22} />
          </button>
          <h1>
            {palletLabel}
            {editing ? ' · 改这块' : ''}
          </h1>
          <p className="sub">
            {order.destination} · 已装 {order.pallets.length} 板
            {planLines.length > 0 ? ` · 计划 ${ps.planBoxes} 箱 / 已装 ${ps.doneBoxes} 箱` : ''}
          </p>
        </header>

        {sku && !picking ? (
          <div className="pack-current">
            <span className="cur-dot" style={{ background: sku.accentColor }} />
            <div className="cur-info">
              <b>
                {nickOf(sku)} · {prodDate ? fmtDate(prodDate) : '—'}
              </b>
              <em>{planHint}</em>
            </div>
            <button
              type="button"
              className="cur-switch"
              onClick={() => {
                setPicking(true)
                setMenu('sku')
              }}
            >
              换品
            </button>
          </div>
        ) : (
          <div className="pack-pick">
          <button
            className={`picker ${menu === 'sku' ? 'on' : ''}`}
            onClick={() => setMenu(menu === 'sku' ? null : 'sku')}
          >
            <em>品</em>
            <b>{sku ? nickOf(sku) : '选品'}</b>
            <i className="caret" />
          </button>
          <button
            className={`picker ${menu === 'date' ? 'on' : ''}`}
            disabled={!sku}
            onClick={() => setMenu(menu === 'date' ? null : 'date')}
          >
            <em>日期</em>
            <b>{prodDate ? fmtDate(prodDate) : '—'}</b>
            <i className="caret" />
          </button>

          {menu && (
            <>
              <div className="picker-mask" onClick={() => setMenu(null)} />
              <div className="picker-pop">
                <div className="picker-pop-title">
                  {menu === 'sku'
                    ? planLines.length > 0
                      ? '这趟要发这些品（按计划排在前面）'
                      : '这趟发哪几个品'
                    : `${sku ? nickOf(sku) : ''} · 用哪个生产日期`}
                </div>
                {menu === 'sku' &&
                  (skus.length > 0 ? (
                    <div className="chips">
                      {orderedSkus.map((s) => {
                        const want = planLines
                          .filter((l) => l.skuId === s.id)
                          .reduce((n, l) => n + l.boxes, 0)
                        const done = ps.lines
                          .filter((l) => l.skuId === s.id)
                          .reduce((n, l) => n + Math.min(l.done, l.boxes), 0)
                        const full = want > 0 && done >= want
                        return (
                          <button
                            key={s.id}
                            className={`chip ${skuId === s.id ? 'on' : ''}`}
                            onClick={() => pickSku(s)}
                          >
                            <span className="chip-dot" style={{ background: s.accentColor }} />
                            {nickOf(s)}
                            {want > 0 && (
                              <>
                                <span className={`plan-dot ${full ? 'full' : ''}`} />
                                <em className={`chip-sub plan ${full ? 'full' : ''}`}>计划 {want} 箱</em>
                              </>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="hint">这个收货方还没有建档的品项，先去「档案」加一个</div>
                  ))}
                {menu === 'date' &&
                  (dates.length > 0 ? (
                    <div className="chips">
                      {dates.map((d) => (
                        <button
                          key={d.prodDate}
                          className={`chip ${prodDate === d.prodDate ? 'on' : ''}`}
                          onClick={() => pickDate(d.prodDate)}
                        >
                          {fmtDate(d.prodDate)}
                          {d.planned > 0 && (
                            <span className={`plan-dot ${d.done >= d.planned ? 'full' : ''}`} />
                          )}
                          <em className="chip-sub">
                            {d.planned > 0 && (
                              <b className={`plan ${d.done >= d.planned ? 'full' : ''}`}>
                                计划 {d.planned}
                              </b>
                            )}
                            {d.planned > 0 ? ' · ' : ''}有货 {Math.floor(d.left / perBox)} 箱
                          </em>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="hint">这个品既没定计划也没入库，先去「库存」入库再发</div>
                  ))}
              </div>
            </>
          )}
          </div>
        )}

        <div className={`pack-stage ${sku ? 'with-ops' : ''}`}>
          <Box3D pallets={spec} emptyPallet />
          {!sku && (
            <div className="pack-empty">
              <button
                type="button"
                className="pack-add"
                aria-label="添加品项"
                onClick={() => {
                  setPicking(true)
                  setMenu('sku')
                }}
              >
                <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              <span className="pack-empty-tip">选个品，箱子就码上来了</span>
            </div>
          )}

          {sku && (
            <div className="pack-hud">
              {/* 左下：口算式 + 特大的总箱数，按步进器时眼角就能扫到变化 */}
              <div className="hud-info">
                <span className="expr">{formula}</span>
                <div className="num-row">
                  <span className="eq">=</span>
                  <b className="num">{boxes}</b>
                  <i>箱</i>
                </div>
                <div className={`total-sub ${warn || overPlan ? 'warn' : ''}`}>{warn || planHint}</div>
                <div className={`total-note ${plan?.over ? 'warn' : ''}`}>
                  {plan?.note} · 隔层调头
                  {plan?.over ? ` · 一层 ${perLayer} 箱，比板 ${overText(plan.over)}` : ''}
                </div>
              </div>

              {/* 右下：层数、顶层上下两个大按钮组，手机右手拇指直接按 */}
              <div className="hud-steps">
                <div className="step-chip">
                  <span className="lab">层数</span>
                  <Stepper value={layers} min={1} max={24} onChange={setLayers} />
                </div>
                <div className="step-chip">
                  <span className="lab">顶层</span>
                  <Stepper
                    value={top}
                    min={1}
                    max={perLayer}
                    onChange={setTopCount}
                    onMinus={() => {
                      if (layers > 1) {
                        setLayers(layers - 1)
                        setTopCount(perLayer)
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="dock">
        <button className="btn primary" onClick={putOn} disabled={!sku || boxes <= 0 || over > 0 || overPlan}>
          {editing ? `保存 ${palletLabel}` : '下一板'}
        </button>
      </div>
    </>
  )
}

/* ---------- 3D 全屏 ---------- */

export function Viewer3D({
  open,
  order,
  onClose,
  actions,
}: {
  open: boolean
  order: Order | null
  onClose: () => void
  actions?: ReactNode
}) {
  const db = useDB()
  /** 选中的板索引（-1 无），点击 3D 里的板或列表项切换 */
  const [selected, setSelected] = useState(-1)
  /** 逐板明细列表是否展开 */
  const [expanded, setExpanded] = useState(false)
  // 换一趟车（order 变了）就重置选中和展开
  const orderKey = order?.id ?? ''
  useEffect(() => {
    setSelected(-1)
    setExpanded(false)
  }, [orderKey])
  if (!open || !order) return null
  const spec = specOfOrder(db, order)
  const sum = summarize(db, order)
  const customer = customerById(db, order.customerId)
  const sel = order.pallets[selected] ?? null
  const selSku = sel ? db.skus.find((s) => s.id === sel.skuId) : null
  const selBoxes = sel ? palletBoxes(sel) : 0

  return (
    <div className="viewer">
      <div className="viewer-top">
        <button className="icon-btn" onClick={onClose} aria-label="关闭">
          <Icon name="back" size={22} />
        </button>
        <div className="viewer-title">
          <b>{order.destination}</b>
          <em>
            {customer?.name ?? '—'} · {sum.totalPallets} 板 · {sum.totalBoxes} 箱
          </em>
        </div>
      </div>
      <Box3D pallets={spec} selected={selected} onPick={setSelected} />
      <div className="viewer-info">
        {sel ? (
          <div className="viewer-pick">
            <div className="viewer-pick-head">
              <span className="viewer-pick-no">{palletName(sel.no)}</span>
              <span className="viewer-pick-name">
                <span className="dot" style={{ background: selSku?.accentColor ?? '#999' }} />
                {selSku ? nickOf(selSku) : '品项已删除'}
              </span>
            </div>
            <div className="viewer-pick-boxes">
              <b>{selBoxes}</b>
              <span>箱</span>
            </div>
            <div className="viewer-pick-meta">
              <div className="viewer-pick-item">
                <em>生产日期</em>
                <b>{fmtDate(sel.prodDate)}</b>
              </div>
              <div className="viewer-pick-item">
                <em>上车时间</em>
                <b>{fmtTime(sel.createdAt)}</b>
              </div>
              <div className="viewer-pick-item viewer-pick-item-full">
                <em>码法</em>
                <b>{layerExpr(sel.layers, sel.perLayer, sel.topCount)}</b>
              </div>
            </div>
          </div>
        ) : (
          <div className="viewer-hint-row">点 3D 图里的某一板，看它的箱数、生产日期和上车时间</div>
        )}

        <button className="viewer-toggle" onClick={() => setExpanded((v) => !v)}>
          <span>{expanded ? '收起' : '展开'}全部 {order.pallets.length} 板明细</span>
          <Icon name="chevron" size={16} className={expanded ? 'flip' : ''} />
        </button>

        {expanded && (
          <div className="viewer-rows">
            {order.pallets.map((p, i) => {
              const sku = db.skus.find((s) => s.id === p.skuId)
              const boxes = palletBoxes(p)
              return (
                <div
                  key={p.id}
                  className={`viewer-row${i === selected ? ' active' : ''}`}
                  onClick={() => setSelected(i)}
                >
                  <div className="viewer-row-main">
                    <span className="viewer-row-name">
                      <i className="viewer-row-no">{palletName(p.no)}</i>
                      <span>{sku ? nickOf(sku) : '品项已删除'}</span>
                    </span>
                    <em className="viewer-row-sub">
                      {fmtDate(p.prodDate)} · {fmtTime(p.createdAt)} 上车
                    </em>
                  </div>
                  <span className="viewer-row-boxes">{boxes} 箱</span>
                </div>
              )
            })}
          </div>
        )}

        <div className="viewer-total">
          <span>合计</span>
          <em>{fmt(sum.totalVolume, 2)} m³</em>
          <b>{sum.totalBoxes} 箱</b>
        </div>
        {actions && <div className="viewer-actions">{actions}</div>}
      </div>
    </div>
  )
}

/* ---------- 页面 ---------- */

export default function Load() {
  const db = useDB()
  const draft = useMemo(() => db.orders.find((o) => o.status === 'draft') ?? null, [db.orders])

  const [creating, setCreating] = useState(false)
  /** 非空表示正在装板；editId 有值是改已有的板，没有就是在装新的一块 */
  const [packing, setPacking] = useState<{ editId?: string } | null>(null)
  /** 正在改这趟车的要货计划 */
  const [planEditing, setPlanEditing] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)
  /** 刚发完车的单：单据已经不是草稿了，但 3D 要接着展示 */
  const [shippedPreview, setShippedPreview] = useState<Order | null>(null)

  const sum = draft ? summarize(db, draft) : null
  const editingPallet = packing?.editId ? (draft?.pallets.find((p) => p.id === packing.editId) ?? null) : null

  const confirmShip = () => {
    // 从最新 state 重取草稿：刚 addPallet 装上的板可能还没反映到闭包里的 draft
    const latest = getState().orders.find((o) => o.status === 'draft') ?? draft
    if (!latest) return
    if (latest.pallets.length === 0) return toast('车上还没有货')
    const short = shortages(db, latest)
    if (short.length > 0) {
      const msg = short
        .slice(0, 3)
        .map((s) => `${nickOf(s.sku)} ${fmtDate(s.prodDate)} 差 ${Math.ceil(s.short / (s.sku.perBox || 1))} 箱`)
        .join('\n')
      alert(`库存不足，不能发车：\n${msg}\n\n请减少箱数，或先入库再发。`)
      return
    }
    // 跟建车时定的要货计划对一遍账，不一致就让现场再确认一次
    const ps = planSummary(latest)
    if (ps.planBoxes > 0) {
      const diff: string[] = []
      for (const l of ps.lines) {
        if (l.left === 0) continue
        const s = db.skus.find((x) => x.id === l.skuId)
        diff.push(
          `${s ? nickOf(s) : '品项已删除'} ${fmtDate(l.prodDate)} ${
            l.left > 0 ? `还差 ${l.left} 箱` : `超装 ${-l.left} 箱`
          }`,
        )
      }
      for (const e of ps.extra) {
        const s = db.skus.find((x) => x.id === e.skuId)
        diff.push(`${s ? nickOf(s) : '品项已删除'} ${fmtDate(e.prodDate)} 计划外 ${e.boxes} 箱`)
      }
      if (
        diff.length > 0 &&
        !confirm(`装的货和要货计划不一致：\n${diff.slice(0, 5).join('\n')}\n\n仍按车上这些货发车？`)
      )
        return
    }
    shipOrder(latest.id)
    setShippedPreview({ ...latest, status: 'shipped' })
    toast('已发车')
    setViewerOpen(true)
  }

  if (creating) {
    return (
      <NewOrderForm
        onCancel={() => setCreating(false)}
        onCreated={() => {
          setCreating(false)
          // 建好直接进 3D 装板，不用再点一次
          setPacking({})
        }}
      />
    )
  }

  if (draft && packing) {
    return (
      <PackingBoard
        key={packing.editId ?? 'new'}
        order={draft}
        editing={editingPallet}
        onBack={() => setPacking(null)}
      />
    )
  }

  if (draft && planEditing) {
    return <PlanEditPage order={draft} onCancel={() => setPlanEditing(false)} onSaved={() => setPlanEditing(false)} />
  }

  if (!draft) {
    return (
      <>
        <div className="page">
          <header className="topbar">
            <h1>装车</h1>
            <p className="sub">一板一种货，装完看 3D</p>
          </header>
          <div className="card card-pad">
            <div className="empty-state">
              <div className="es-icon">
                <Icon name="pallet" size={38} />
              </div>
              <div className="es-title">今天要发哪一车？</div>
              <div className="es-body">
                填收货地、选收货方，再录这趟要发哪些货
                <br />
                一板一种商品、一个生产日期
              </div>
              <button className="btn primary" onClick={() => setCreating(true)}>
                新建车次
              </button>
            </div>
          </div>
        </div>
        <Viewer3D
          open={viewerOpen}
          order={shippedPreview}
          onClose={() => {
            setViewerOpen(false)
            setShippedPreview(null)
          }}
        />
      </>
    )
  }

  const customer = customerById(db, draft.customerId)
  const ps = planSummary(draft)

  return (
    <>
      <div className="page with-dock">
        <header className="topbar">
          <h1>{draft.destination}</h1>
          <p className="sub">
            {customer?.name ?? '—'} · {draft.no}
          </p>
          <button
            className="icon-btn"
            aria-label="删除车次"
            onClick={() => {
              if (confirm('删掉这趟车？已装的货不会动库存')) {
                removeOrder(draft.id)
                toast('已删除车次')
              }
            }}
          >
            <Icon name="trash" size={20} />
          </button>
        </header>

        {sum && (
          <div className="stat-cards">
            <div>
              <b>{sum.totalPallets}</b>
              <span>拖板</span>
            </div>
            <div>
              <b>{sum.totalBoxes}</b>
              <span>箱</span>
            </div>
            <div>
              <b>{fmt(sum.totalVolume, 2)}</b>
              <span>体积 m³</span>
            </div>
          </div>
        )}

        {ps.lines.length > 0 && (
          <div className="card card-pad plan-card">
            <div className="plan-card-head">
              <span>本趟要货计划 · 共 {ps.planBoxes} 箱</span>
              <button className="link-btn" onClick={() => setPlanEditing(true)}>
                改计划
              </button>
            </div>
            {ps.lines.map((l) => {
              const sku = db.skus.find((s) => s.id === l.skuId)
              const pct = l.boxes > 0 ? Math.min(100, Math.round((l.done / l.boxes) * 100)) : 0
              const state = l.left > 0 ? 'todo' : l.left < 0 ? 'over' : 'done'
              return (
                <div className="plan-line" key={l.id}>
                  <div className="plan-line-head">
                    <b>{sku ? nickOf(sku) : '品项已删除'}</b>
                    <em>{fmtDate(l.prodDate)}</em>
                    <span className={state}>
                      {l.left > 0 ? `还差 ${l.left} 箱` : l.left < 0 ? `超 ${-l.left} 箱` : '已装齐'}
                    </span>
                  </div>
                  <div className="plan-bar">
                    <i className={state} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="plan-line-sub">
                    计划 {l.boxes} 箱 · 已装 {l.done} 箱
                  </div>
                </div>
              )
            })}
            {ps.extra.length > 0 && (
              <div className="plan-extra">
                计划外还装了{' '}
                {ps.extra
                  .map((e) => {
                    const s = db.skus.find((x) => x.id === e.skuId)
                    return `${s ? nickOf(s) : '?'} ${fmtDate(e.prodDate)} ${e.boxes} 箱`
                  })
                  .join('、')}
              </div>
            )}
            <div className="plan-card-foot">
              合计已装 {ps.doneBoxes} / {ps.planBoxes} 箱
              {ps.leftBoxes > 0 ? `，还差 ${ps.leftBoxes} 箱` : ps.overBoxes > 0 ? `，超装 ${ps.overBoxes} 箱` : '，已装齐'}
            </div>
          </div>
        )}

        <div className="section-head">
          <span>已上车 {draft.pallets.length} 板</span>
          {draft.pallets.length > 0 && (
            <button className="link-btn" onClick={() => setViewerOpen(true)}>
              看整车 3D
            </button>
          )}
        </div>

        {draft.pallets.map((p) => {
          const sku = db.skus.find((s) => s.id === p.skuId)
          const boxes = palletBoxes(p)
          return (
            <div className="card pallet-card" key={p.id}>
              <div className="pallet-head">
                <span className="pallet-no">{palletName(p.no)}</span>
                <b className="pallet-name">
                  <span className="dot" style={{ background: sku?.accentColor ?? '#999' }} />
                  <span className="pallet-name-text">{sku ? nickOf(sku) : '品项已删除'}</span>
                  <i className="pallet-date">· {fmtDate(p.prodDate)}</i>
                </b>
              </div>
              <div className="pallet-sub">
                <span className="pallet-formula">
                  {layerExpr(p.layers, p.perLayer, p.topCount)} <b>= {boxes} 箱</b>
                </span>
                <span className="pallet-time" title="上车时间">
                  {fmtTime(p.createdAt)}
                </span>
                <span className="pallet-ops">
                  <ConfirmIconBtn icon="redo" label="重码" onConfirm={() => setPacking({ editId: p.id })} />
                  <ConfirmIconBtn
                    icon="trash"
                    label="移除"
                    onConfirm={() => {
                      removePallet(draft.id, p.id)
                      toast(`${palletName(p.no)} 已移除`)
                    }}
                  />
                </span>
              </div>
            </div>
          )
        })}

        <button className="btn" style={{ marginTop: 12 }} onClick={() => setPacking({})}>
          + 继续装板（{palletName(`P${draft.pallets.length + 1}`)}）
        </button>

        <div style={{ height: 12 }} />
      </div>

      <div className="dock">
        <button className="btn primary" onClick={confirmShip} disabled={draft.pallets.length === 0}>
          确认发车（扣库存）
        </button>
      </div>

      <Viewer3D open={viewerOpen} order={draft} onClose={() => setViewerOpen(false)} />
    </>
  )
}
