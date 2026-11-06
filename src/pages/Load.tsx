import { useMemo, useState, type ReactNode } from 'react'
import Box3D from '../components/Box3D'
import { Icon, Sheet, Stepper, toast } from '../components/UI'
import { fmt, fmtDate, summarize } from '../lib/calc'
import {
  DEFAULT_LAYERS,
  DEFAULT_PER_LAYER,
  addPallet,
  addPalletsByBoxes,
  createOrder,
  customerById,
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

/* ---------- 新建车次 ---------- */

/** 一块满板装多少箱 */
const FULL_PALLET = DEFAULT_LAYERS * DEFAULT_PER_LAYER

type DraftItem = { key: string; skuId: string; prodDate: string; boxes: number }

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
  const [skuId, setSkuId] = useState('')
  const [prodDate, setProdDate] = useState('')
  const [boxes, setBoxes] = useState(FULL_PALLET)
  const [items, setItems] = useState<DraftItem[]>([])

  const skus = customerId ? skusOfCustomer(db, customerId) : []
  const sku = skus.find((s) => s.id === skuId) ?? null
  const dates = sku ? stockByDate(db, sku.id) : []
  const picked = dates.find((d) => d.prodDate === prodDate)

  const boxesOf = (qty: number, perBox: number) => Math.floor(qty / (perBox || 1))

  const totalBoxes = items.reduce((n, i) => n + i.boxes, 0)
  const totalQty = items.reduce((n, i) => {
    const k = db.skus.find((s) => s.id === i.skuId)
    return n + i.boxes * (k?.perBox ?? 0)
  }, 0)

  const pickCustomer = (id: string) => {
    setCustomerId(id)
    setSkuId('')
    setProdDate('')
  }

  const pickSku = (id: string) => {
    setSkuId(id)
    const list = stockByDate(db, id)
    const first = list[0]?.prodDate ?? ''
    setProdDate(first)
    // 默认箱数取「满板」和「这个日期还剩多少箱」里小的那个，免得一上来就超发
    const k = db.skus.find((s) => s.id === id)
    const cap = first ? Math.floor((list[0]?.left ?? 0) / (k?.perBox || 1)) : 0
    setBoxes(cap > 0 ? Math.min(FULL_PALLET, cap) : FULL_PALLET)
  }

  const addItem = () => {
    if (!sku) return toast('先选一个品')
    if (!prodDate) return toast('这个品还没有库存')
    if (boxes <= 0) return toast('箱数要大于 0')
    setItems((p) => [...p, { key: `${Date.now()}-${Math.random()}`, skuId: sku.id, prodDate, boxes }])
    // 收回到「选品」这一步，免得旧箱数对着新日期一直报超发
    setSkuId('')
    setProdDate('')
    setBoxes(FULL_PALLET)
    toast('已加入订单')
  }

  const create = () => {
    if (!destination.trim()) return toast('先填收货地')
    if (!customerId) return toast('先选收货方')
    const id = createOrder({ destination: destination.trim(), customerId })
    for (const it of items) {
      addPalletsByBoxes(id, { skuId: it.skuId, prodDate: it.prodDate, boxes: it.boxes })
    }
    onCreated(id)
  }

  const leftBoxes = picked && sku ? boxesOf(picked.left, sku.perBox) : 0
  const over = picked && sku ? boxes - leftBoxes : 0

  return (
    <>
      <div className="page with-dock">
        <header className="topbar back-mode">
          <button className="icon-btn" onClick={onCancel} aria-label="返回">
            <Icon name="back" size={22} />
          </button>
          <h1>新建车次</h1>
          <p className="sub">收货地 → 收货方 → 装什么 → 填箱数</p>
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
                onClick={() => pickCustomer(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {customerId && (
          <div className="card card-pad" style={{ marginTop: 8 }}>
            <label className="field-label">3 · 装什么</label>
            <div className="pick-list">
              {skus.map((s) => {
                const left = stockByDate(db, s.id).reduce((n, d) => n + d.left, 0)
                return (
                  <button
                    key={s.id}
                    className={`pick-row ${skuId === s.id ? 'on' : ''}`}
                    onClick={() => pickSku(s.id)}
                  >
                    <span className="pick-swatch" style={{ background: s.accentColor }} />
                    <span className="pick-main">
                      <span className="pick-name">{s.shortName}</span>
                      <span className="pick-spec">{s.spec}</span>
                    </span>
                    <span className={`pick-stock ${left > 0 ? '' : 'none'}`}>
                      {left > 0 ? `${boxesOf(left, s.perBox)} 箱` : '无库存'}
                    </span>
                  </button>
                )
              })}
              {skus.length === 0 && <div className="hint">这个收货方还没有建档的品项，先去「档案」加一个</div>}
            </div>

            {sku && dates.length > 0 && (
              <>
                <label className="field-label" style={{ marginTop: 16 }}>
                  生产日期
                </label>
                <div className="chips">
                  {dates.map((d) => (
                    <button
                      key={d.prodDate}
                      className={`chip ${prodDate === d.prodDate ? 'on' : ''}`}
                      onClick={() => setProdDate(d.prodDate)}
                    >
                      {fmtDate(d.prodDate)}
                      <em>{boxesOf(d.left, sku.perBox)}</em>
                    </button>
                  ))}
                </div>

                <label className="field-label" style={{ marginTop: 16 }}>
                  箱数
                </label>
                <div className="box-row">
                  <button className="btn sm" onClick={() => setBoxes(Math.max(0, boxes - 1))} aria-label="减少一箱">
                    −
                  </button>
                  <input
                    className="input num"
                    inputMode="numeric"
                    value={boxes || ''}
                    onChange={(e) => setBoxes(Math.max(0, Number(e.target.value) || 0))}
                    placeholder="0"
                  />
                  <button className="btn sm" onClick={() => setBoxes(boxes + 1)} aria-label="增加一箱">
                    +
                  </button>
                  <button className="btn sm" onClick={() => setBoxes(FULL_PALLET)}>
                    满板
                  </button>
                </div>

                <div className="stack-sum" style={{ marginTop: 12 }}>
                  <div>
                    <b>{boxes}</b>
                    <span>箱</span>
                  </div>
                  <div>
                    <b>{boxes * sku.perBox}</b>
                    <span>件</span>
                  </div>
                  <div>
                    <b>{leftBoxes - boxes}</b>
                    <span>该日期剩余</span>
                  </div>
                </div>

                {over > 0 && (
                  <div className="alert" style={{ margin: '10px 0 0' }}>
                    这个日期只剩 {leftBoxes} 箱，超出 {over} 箱，发车时会记成超发
                  </div>
                )}
                {boxes > FULL_PALLET && (
                  <div className="hint" style={{ margin: '8px 2px 0' }}>
                    {boxes} 箱会自动装成 {Math.ceil(boxes / FULL_PALLET)} 块板（整板 {FULL_PALLET} 箱）
                  </div>
                )}

                <button className="btn primary" style={{ marginTop: 14 }} onClick={addItem}>
                  加入订单
                </button>
              </>
            )}

            {sku && dates.length === 0 && (
              <div className="hint" style={{ margin: '10px 2px 0' }}>
                这个品还没有库存，先去「库存」入库再发
              </div>
            )}
          </div>
        )}

        {items.length > 0 && (
          <>
            <div className="section-head">
              <span>已加入 {items.length} 项</span>
              <span className="num">
                {totalBoxes} 箱 · {totalQty} 件
              </span>
            </div>
            {items.map((it) => {
              const k = db.skus.find((s) => s.id === it.skuId)
              const pallets = Math.max(1, Math.ceil(it.boxes / FULL_PALLET))
              return (
                <div className="card card-pad pallet-card" key={it.key}>
                  <div className="pallet-head">
                    <span className="pallet-name">{k?.shortName ?? '—'}</span>
                    <span className="pallet-boxes">{it.boxes} 箱</span>
                  </div>
                  <div className="pallet-meta">
                    <span className="dot" style={{ background: k?.accentColor ?? '#999' }} />
                    {fmtDate(it.prodDate)} · {it.boxes * (k?.perBox ?? 0)} 件 · {pallets} 块板
                  </div>
                  <div className="pallet-actions">
                    <button
                      className="btn sm"
                      onClick={() => setItems((p) => p.filter((x) => x.key !== it.key))}
                    >
                      删掉
                    </button>
                  </div>
                </div>
              )
            })}
          </>
        )}

        <div style={{ height: 12 }} />
      </div>

      <div className="dock">
        <button className="btn primary" onClick={create} disabled={!destination.trim() || !customerId}>
          {items.length > 0 ? `创建车次（${totalBoxes} 箱）` : '创建车次'}
        </button>
      </div>
    </>
  )
}

/* ---------- 加 / 改一块拖板 ---------- */

function PalletSheet({
  open,
  order,
  editing,
  onClose,
}: {
  open: boolean
  order: Order
  editing: Pallet | null
  onClose: () => void
}) {
  const db = useDB()
  const skus = skusOfCustomer(db, order.customerId)

  const [skuId, setSkuId] = useState(editing?.skuId ?? '')
  const [prodDate, setProdDate] = useState(editing?.prodDate ?? '')
  const [layers, setLayers] = useState(editing?.layers ?? DEFAULT_LAYERS)
  const [perLayer, setPerLayer] = useState(editing?.perLayer ?? DEFAULT_PER_LAYER)
  const [topCount, setTopCount] = useState(editing?.topCount ?? DEFAULT_PER_LAYER)

  const sku = skus.find((s) => s.id === skuId)
  const dates = sku ? stockByDate(db, sku.id) : []
  const top = Math.min(topCount, perLayer)
  const boxes = Math.max(0, (layers - 1) * perLayer + top)
  const qty = sku ? boxes * sku.perBox : 0
  const picked = dates.find((d) => d.prodDate === prodDate)
  /** 这个日期还剩多少箱，可装 */
  const leftBoxes = sku ? Math.floor((picked?.left ?? 0) / (sku.perBox || 1)) : 0

  const pickSku = (id: string) => {
    setSkuId(id)
    setProdDate(stockByDate(db, id)[0]?.prodDate ?? '')
  }

  const save = () => {
    if (!sku) return toast('先选一个品')
    if (!prodDate) return toast('这个品还没有库存')
    const payload = { skuId, prodDate, layers, perLayer, topCount: top }
    if (editing) updatePallet(order.id, editing.id, payload)
    else addPallet(order.id, payload)
    onClose()
    toast(editing ? '已更新拖板' : '已加到车上')
  }

  return (
    <Sheet open={open} title={editing ? `编辑 ${editing.no}` : '加一块拖板'} onClose={onClose}>
      {!editing && (
        <>
          <label className="field-label">装什么</label>
          <div className="pick-list">
            {skus.map((s) => {
              const left = stockByDate(db, s.id).reduce((sum, d) => sum + d.left, 0)
              return (
                <button key={s.id} className={`pick-row ${skuId === s.id ? 'on' : ''}`} onClick={() => pickSku(s.id)}>
                  <span className="pick-swatch" style={{ background: s.accentColor }} />
                  <span className="pick-main">
                    <span className="pick-name">{s.shortName}</span>
                    <span className="pick-spec">{s.spec}</span>
                  </span>
                  <span className={`pick-stock ${left > 0 ? '' : 'none'}`}>
                    {left > 0 ? `${Math.floor(left / (s.perBox || 1))} 箱` : '无库存'}
                  </span>
                </button>
              )
            })}
            {skus.length === 0 && <div className="hint">这个收货方还没有建档的品项，先去「档案」加一个</div>}
          </div>
        </>
      )}

      {editing && sku && (
        <div className="edit-head">
          <span className="pick-swatch" style={{ background: sku.accentColor }} />
          <span>
            <b>{sku.shortName}</b>
            <em>{sku.spec}</em>
          </span>
        </div>
      )}

      {sku && (
        <>
          <label className="field-label" style={{ marginTop: 18 }}>
            生产日期
          </label>
          {dates.length > 0 ? (
            <div className="chips">
              {dates.map((d) => (
                <button
                  key={d.prodDate}
                  className={`chip ${prodDate === d.prodDate ? 'on' : ''}`}
                  onClick={() => setProdDate(d.prodDate)}
                >
                  {fmtDate(d.prodDate)}
                  <em>{Math.floor(d.left / (sku.perBox || 1))}</em>
                </button>
              ))}
            </div>
          ) : (
            <div className="hint">这个品还没有库存，先去「库存」入库</div>
          )}

          <div className="stack-box">
            <div className="stack-row">
              <span>层数</span>
              <Stepper value={layers} onChange={(v) => setLayers(Math.max(1, Math.min(20, v)))} min={1} />
            </div>
            <div className="stack-row">
              <span>每层几个</span>
              <Stepper
                value={perLayer}
                onChange={(v) => {
                  const n = Math.max(1, Math.min(20, v))
                  setPerLayer(n)
                  setTopCount((t) => Math.min(t, n))
                }}
                min={1}
              />
            </div>
            <div className="stack-row">
              <span>顶层几个</span>
              <Stepper value={top} onChange={(v) => setTopCount(Math.max(0, Math.min(perLayer, v)))} min={0} />
            </div>
          </div>

          <div className="stack-sum">
            <div>
              <b>{boxes}</b>
              <span>箱</span>
            </div>
            <div>
              <b>{qty}</b>
              <span>件</span>
            </div>
            <div>
              <b>{picked ? leftBoxes : 0}</b>
              <span>该日期剩余</span>
            </div>
          </div>

          {picked && leftBoxes < boxes && (
            <div className="alert" style={{ margin: '10px 0 0' }}>
              这个日期只有 {leftBoxes} 箱，装完会超出 {boxes - leftBoxes} 箱
            </div>
          )}
        </>
      )}

      <div className="sheet-actions">
        <button className="btn primary" onClick={save} disabled={!sku || !prodDate}>
          {editing ? '保存' : '加到车上'}
        </button>
      </div>
    </Sheet>
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
            <span>{l.sku.shortName}</span>
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
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState<Pallet | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  /** 刚发完车的单：单据已经不是草稿了，但 3D 要接着展示 */
  const [shippedPreview, setShippedPreview] = useState<Order | null>(null)

  const sum = draft ? summarize(db, draft) : null

  const confirmShip = () => {
    if (!draft) return
    if (draft.pallets.length === 0) return toast('车上还没有货')
    const short = shortages(db, draft)
    if (short.length > 0) {
      const msg = short
        .slice(0, 3)
        .map((s) => `${s.sku.shortName} ${fmtDate(s.prodDate)} 差 ${Math.ceil(s.short / (s.sku.perBox || 1))} 箱`)
        .join('\n')
      if (!confirm(`这些货不够：\n${msg}\n\n仍然发车？缺口会记成超发。`)) return
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
          toast('车次已建好')
        }}
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
                填收货地、选收货方，一块板一块板装
                <br />
                每板一种商品、一个生产日期
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
          <span>拖板清单</span>
          {draft.pallets.length > 0 && (
            <button className="link-btn" onClick={() => setViewerOpen(true)}>
              看 3D
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
                <span className="pallet-name">{sku?.shortName ?? '品项已删除'}</span>
                <span className="pallet-boxes">{boxes} 箱</span>
              </div>
              <div className="pallet-meta">
                <span className="dot" style={{ background: sku?.accentColor ?? '#999' }} />
                {fmtDate(p.prodDate)} · {p.layers} 层 × {p.perLayer}
                {p.topCount !== p.perLayer ? ` + 顶层 ${p.topCount}` : ''} · {sku ? boxes * sku.perBox : 0} 件
              </div>
              <div className="pallet-actions">
                <button className="btn sm" onClick={() => setEditing(p)}>
                  改层数
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

        <button className="btn" style={{ marginTop: 12 }} onClick={() => setPicking(true)}>
          + 加一块拖板
        </button>

        <div style={{ height: 12 }} />
      </div>

      <div className="dock">
        <button className="btn primary" onClick={confirmShip} disabled={draft.pallets.length === 0}>
          确认发车（扣库存）
        </button>
      </div>

      {picking && <PalletSheet open order={draft} editing={null} onClose={() => setPicking(false)} />}
      {editing && <PalletSheet key={editing.id} open order={draft} editing={editing} onClose={() => setEditing(null)} />}

      <Viewer3D open={viewerOpen} order={draft} onClose={() => setViewerOpen(false)} />
    </>
  )
}
