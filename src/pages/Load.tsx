import { useMemo, useState, type ReactNode } from 'react'
import Box3D from '../components/Box3D'
import { Icon, Stepper, toast } from '../components/UI'
import { PALLET_H, fmt, fmtDate, layerPlan, maxLayers, summarize } from '../lib/calc'
import {
  DEFAULT_LAYERS,
  DEFAULT_PER_LAYER,
  addPallet,
  createOrder,
  customerById,
  nickOf,
  palletBoxes,
  removeOrder,
  removePallet,
  shipOrder,
  shortages,
  skusOfCustomer,
  stockByDate,
  updatePallet,
  useDB,
  type Order,
  type Pallet,
  type Sku,
} from '../lib/store'

export type PalletSpec3D = { no: string; sku: Sku; layers: number; perLayer: number; topCount: number }

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

/* ---------- 新建车次：只定「谁、送到哪」 ---------- */

function NewOrderForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const db = useDB()

  /** 最近用过的收货地，点一下直接填 */
  const recent = useMemo(() => {
    const out: string[] = []
    for (const o of db.orders) {
      const d = o.destination.trim()
      if (d && !out.includes(d)) out.push(d)
    }
    return out.slice(0, 4)
  }, [db.orders])

  const [destination, setDestination] = useState('')
  const [customerId, setCustomerId] = useState('')

  const create = () => {
    if (!destination.trim()) return toast('先填收货地')
    if (!customerId) return toast('先选收货方')
    const id = createOrder({ destination: destination.trim(), customerId })
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
          <p className="sub">先定送到哪、发给谁，装什么进场再说</p>
        </header>

        <div className="card card-pad">
          <label className="field-label">1 · 收货地</label>
          <input
            className="input"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="门店名或详细地址"
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

        <div className="card card-pad" style={{ marginTop: 8 }}>
          <label className="field-label">2 · 收货方</label>
          <div className="chips">
            {db.customers.map((c) => (
              <button
                key={c.id}
                className={`chip ${customerId === c.id ? 'on' : ''}`}
                onClick={() => setCustomerId(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
          <div className="hint" style={{ margin: '12px 2px 0' }}>
            一趟车只发一个收货方。建好之后直接进展板界面，装多少板当场看着码。
          </div>
        </div>

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

/* ---------- 装板工作台 ---------- */

/**
 * 一块板一屏：3D 占满，品 / 日期收成两个下拉，层数和顶层直接在 3D 上按 + / −。
 * 点「装上」把这块定下来，清空成下一块空板，接着装。
 */
function PackingBoard({ order, editing, onBack }: { order: Order; editing: Pallet | null; onBack: () => void }) {
  const db = useDB()
  const skus = skusOfCustomer(db, order.customerId)

  const [skuId, setSkuId] = useState(editing?.skuId ?? '')
  const [prodDate, setProdDate] = useState(editing?.prodDate ?? '')
  const [layers, setLayers] = useState(editing?.layers ?? DEFAULT_LAYERS)
  const [topCount, setTopCount] = useState(editing?.topCount ?? DEFAULT_PER_LAYER)
  /** 当前展开的是哪个下拉：品 / 生产日期 */
  const [menu, setMenu] = useState<'sku' | 'date' | null>(null)

  const sku = skus.find((s) => s.id === skuId) ?? null
  const dates = sku ? stockByDate(db, sku.id) : []
  const picked = dates.find((d) => d.prodDate === prodDate)

  /** 一层比托盘多出来多少，给成「前后各 8 厘米」这样的人话 */
function overText(over: { x: number; z: number }) {
  const parts: string[] = []
  if (over.x > 0) parts.push(`左右各 ${Math.round(over.x / 20)} 厘米`)
  if (over.z > 0) parts.push(`前后各 ${Math.round(over.z / 20)} 厘米`)
  return `${parts.join('、')}`
}

/** 一层怎么摆是写死的：包子 3 竖 + 4 横 = 7 个，烧麦 3 竖 + 2 横 = 5 个 */
  const plan = sku ? layerPlan(sku) : null
  const perLayer = plan?.perLayer ?? 0
  const perBox = sku?.perBox || 1
  const top = perLayer > 0 ? Math.min(Math.max(1, topCount), perLayer) : 0
  const boxes = sku ? Math.max(0, (layers - 1) * perLayer + top) : 0
  const qty = boxes * perBox

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
  const nextNo = `P${order.pallets.length + 2}`

  const pickSku = (s: Sku) => {
    setSkuId(s.id)
    setProdDate(stockByDate(db, s.id)[0]?.prodDate ?? '')
    // 起点按这个品的固定码法算：满层几个、能码几层
    setLayers(maxLayers(s))
    setTopCount(layerPlan(s).perLayer)
    setMenu(null)
  }

  const pickDate = (d: string) => {
    setProdDate(d)
    setMenu(null)
  }

  const putOn = () => {
    if (!sku) return toast('先选装什么')
    if (!prodDate) return toast('这个品还没有库存')
    if (boxes <= 0) return toast('这一板还没码上箱子')
    if (over > 0) return toast(`库存不足：${fmtDate(prodDate)} 还能装 ${avail} 箱`)

    const payload = { skuId, prodDate, layers, perLayer, topCount: top }
    if (editing) {
      updatePallet(order.id, editing.id, payload)
      toast(`${editing.no} 已改好`)
      onBack()
      return
    }
    addPallet(order.id, payload)
    toast(`${palletNo} 已上车，接着装 ${nextNo}`)
    // 清空选品，3D 回到一块空托盘 —— 这就是「自动跳到下一板」
    setSkuId('')
    setProdDate('')
  }

  const spec = sku ? [{ no: palletNo, sku, layers, perLayer, topCount: top }] : []
  const stackH = sku ? (layers * sku.boxH + PALLET_H) / 1000 : 0
  const warn =
    over > 0
      ? `库存不足：这天只能装 ${avail} 箱`
      : tooTall
        ? `码高 ${fmt(stackH, 2)} m，超过 1.8 m`
        : ''

  return (
    <>
      <div className="page pack-page">
        <header className="topbar back-mode">
          <button className="icon-btn" onClick={onBack} aria-label="返回">
            <Icon name="back" size={22} />
          </button>
          <h1>
            {palletNo}
            {editing ? ' · 改这块' : ''}
          </h1>
          <p className="sub">
            {order.destination} · 已装 {order.pallets.length} 板
          </p>
        </header>

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
                <div className="picker-pop-title">{menu === 'sku' ? '这趟发哪几个品' : '用哪个生产日期'}</div>
                {menu === 'sku' &&
                  (skus.length > 0 ? (
                    <div className="chips">
                      {skus.map((s) => (
                        <button
                          key={s.id}
                          className={`chip ${skuId === s.id ? 'on' : ''}`}
                          onClick={() => pickSku(s)}
                        >
                          <span className="chip-dot" style={{ background: s.accentColor }} />
                          {nickOf(s)}
                        </button>
                      ))}
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
                          <em className="chip-sub">{Math.floor(d.left / perBox)} 箱</em>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="hint">这个品还没有库存，先去「库存」入库再发</div>
                  ))}
              </div>
            </>
          )}
        </div>

        <div className={`pack-stage ${sku ? 'with-ops' : ''}`}>
          <Box3D pallets={spec} emptyPallet />
          {!sku && <div className="pack-empty">选个品，箱子就码上来了</div>}

          {sku && (
            <div className="pack-ops">
              <div className="op-head">
                <div className="who">
                  <b>{nickOf(sku)}</b>
                  <span>{boxes} 箱</span>
                  <em>{qty} 件</em>
                </div>
                <div className={`sub ${warn ? 'warn' : ''}`}>
                  {warn || (prodDate ? `这天还能装 ${avail} 箱` : '还没选生产日期')}
                </div>
              </div>
              <div className="op">
                <span>码几层</span>
                <Stepper value={layers} min={1} max={24} onChange={setLayers} />
              </div>
              <div className="op">
                <span>顶层几个</span>
                <Stepper value={top} min={1} max={perLayer} onChange={setTopCount} />
              </div>
              <div className="op static">
                <span>每层</span>
                <b>{perLayer}</b>
              </div>
              <div className={`op-note ${plan?.over ? 'warn' : ''}`}>
                {plan?.note} · 隔层调头
                {plan?.over
                  ? ` · 一层 ${perLayer} 箱，比板 ${overText(plan.over)}`
                  : ''}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="dock">
        <button className="btn primary" onClick={putOn} disabled={!sku || boxes <= 0 || over > 0}>
          {editing ? `保存 ${palletNo}` : `装上 ${palletNo} · 接着装 ${nextNo}`}
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
  if (!open || !order) return null
  const spec = specOfOrder(db, order)
  const sum = summarize(db, order)
  const customer = customerById(db, order.customerId)

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
      <Box3D pallets={spec} />
      <div className="viewer-info">
        {sum.lines.slice(0, 4).map((l) => (
          <div key={`${l.sku.id}-${l.prodDate}`}>
            <span>{nickOf(l.sku)}</span>
            <em>{fmtDate(l.prodDate)}</em>
            <b>{l.boxes} 箱</b>
          </div>
        ))}
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
  const [viewerOpen, setViewerOpen] = useState(false)
  /** 刚发完车的单：单据已经不是草稿了，但 3D 要接着展示 */
  const [shippedPreview, setShippedPreview] = useState<Order | null>(null)

  const sum = draft ? summarize(db, draft) : null
  const editingPallet = packing?.editId ? (draft?.pallets.find((p) => p.id === packing.editId) ?? null) : null

  const confirmShip = () => {
    if (!draft) return
    if (draft.pallets.length === 0) return toast('车上还没有货')
    const short = shortages(db, draft)
    if (short.length > 0) {
      const msg = short
        .slice(0, 3)
        .map((s) => `${nickOf(s.sku)} ${fmtDate(s.prodDate)} 差 ${Math.ceil(s.short / (s.sku.perBox || 1))} 箱`)
        .join('\n')
      alert(`库存不足，不能发车：\n${msg}\n\n请减少箱数，或先入库再发。`)
      return
    }
    shipOrder(draft.id)
    setShippedPreview({ ...draft, status: 'shipped' })
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
                填收货地、选收货方，直接开装
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
            <div className="card card-pad pallet-card" key={p.id}>
              <div className="pallet-head">
                <span className="pallet-no">{p.no}</span>
                <span className="pallet-name">{sku ? nickOf(sku) : '品项已删除'}</span>
                <span className="pallet-boxes">{boxes} 箱</span>
              </div>
              <div className="pallet-meta">
                <span className="dot" style={{ background: sku?.accentColor ?? '#999' }} />
                {fmtDate(p.prodDate)} · {p.layers} 层 × {p.perLayer}
                {p.topCount !== p.perLayer ? ` · 顶层 ${p.topCount}` : ''} · {sku ? boxes * sku.perBox : 0} 件
              </div>
              <div className="pallet-actions">
                <button className="btn sm" onClick={() => setPacking({ editId: p.id })}>
                  重码
                </button>
                <button
                  className="btn sm"
                  onClick={() => {
                    removePallet(draft.id, p.id)
                    toast(`${p.no} 已移除`)
                  }}
                >
                  移除
                </button>
              </div>
            </div>
          )
        })}

        <button className="btn" style={{ marginTop: 12 }} onClick={() => setPacking({})}>
          + 继续装板（P{draft.pallets.length + 1}）
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
