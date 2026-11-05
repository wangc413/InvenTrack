import { useState } from 'react'
import {
  addPallet,
  createOrder,
  removeOrder,
  removePallet,
  setItemBoxes,
  shipOrder,
  shortages,
  updateOrder,
  useDB,
  type Pallet,
} from '../lib/store'
import { PALLET_COLORS, fmt, summarize, type PalletStat } from '../lib/calc'
import { Icon, Sheet, Stepper, toast } from '../components/UI'

const PER_ROW = 6

function PalletArt({ segs, empty }: { segs: PalletStat['segments']; empty: string }) {
  const total = segs.reduce((s, x) => s + x.count, 0)
  const rows = Math.max(1, Math.ceil(total / PER_ROW))
  const cellW = 44
  const cellH = Math.min(26, 138 / rows)
  const gap = 2.5
  const W = PER_ROW * cellW + 8
  const palletH = 11
  const H = rows * cellH + palletH + 8
  const top = H - palletH - 5

  const boxes: number[] = []
  for (const s of segs) for (let i = 0; i < s.count; i++) boxes.push(s.color)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img">
      <title>{`拖板装载示意，共 ${total} 箱`}</title>
      {boxes.map((c, i) => {
        const row = Math.floor(i / PER_ROW)
        const col = i % PER_ROW
        const color = PALLET_COLORS[c % PALLET_COLORS.length]
        return (
          <rect
            key={i}
            x={4 + col * cellW + gap / 2}
            y={top - (row + 1) * cellH + gap / 2}
            width={cellW - gap}
            height={cellH - gap}
            rx={2}
            fill={color.fill}
            stroke={color.stroke}
            strokeWidth={0.8}
          />
        )
      })}
      <rect x="2" y={top} width={W - 4} height={palletH} rx="2" fill="#d7bb95" stroke="#a8875f" strokeWidth="0.8" />
      <rect x="2" y={H - 5} width={W - 4} height="3.5" rx="1.5" fill="#a8875f" />
      {total === 0 && (
        <text x={W / 2} y={top - 14} textAnchor="middle" fontSize="11" fill="#9aa1ab">
          {empty}
        </text>
      )}
    </svg>
  )
}

export default function Pallets() {
  const db = useDB()
  const draft = db.orders.find((o) => o.status === 'draft')
  const sum = draft ? summarize(db, draft) : null

  const [formOpen, setFormOpen] = useState(false)
  const [customer, setCustomer] = useState('')
  const [remark, setRemark] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)

  const editing: Pallet | undefined = draft?.pallets.find((p) => p.id === editingId)

  const openCreate = () => {
    setCustomer('')
    setRemark('')
    setFormOpen(true)
  }

  const openEdit = () => {
    if (!draft) return
    setCustomer(draft.customer)
    setRemark(draft.remark)
    setFormOpen(true)
  }

  const submitForm = () => {
    if (draft) {
      updateOrder(draft.id, { customer: customer.trim() || '未填客户', remark })
      toast('已更新')
    } else {
      createOrder(customer.trim(), remark)
      toast('车次已建，开始加拖板')
    }
    setFormOpen(false)
  }

  const newPallet = () => {
    if (!draft) return
    const id = addPallet(draft.id)
    setEditingId(id)
    setPicker(true)
  }

  const confirmShip = () => {
    if (!draft) return
    const filled = draft.pallets.filter((p) => p.items.length > 0)
    if (filled.length === 0) return toast('还没有装货')
    const empties = draft.pallets.length - filled.length
    if (empties > 0 && !confirm(`有 ${empties} 块空拖板，确认按 ${filled.length} 块拖板发车？`)) return

    const lack = shortages(db, draft)
    if (lack.length > 0) {
      const detail = lack.map((l) => `${l.sku.name} 差 ${l.short} 件`).join('、')
      if (
        !confirm(
          `库存不够：${detail}。\n\n继续发车的话，缺的部分会记成超发（账面负数），事后可以用入库或盘点把它平掉。\n\n确认继续发车？`,
        )
      )
        return
    }

    shipOrder(draft.id)
    setEditingId(null)
    toast('已发车，库存已扣减')
  }

  return (
    <>
      <header className="topbar">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>{draft ? draft.customer : '装板'}</h1>
          <div className="sub">
            {draft
              ? `${draft.no} · ${sum?.totalPallets ?? 0} 块拖板 · ${sum?.totalBoxes ?? 0} 箱`
              : '一块一块录，发车前自动汇总'}
          </div>
        </div>
        {draft && (
          <button className="icon-btn" onClick={openEdit} aria-label="编辑">
            ✎
          </button>
        )}
      </header>

      <main className="page">
        {!draft ? (
          <div className="card card-pad" style={{ textAlign: 'center', paddingTop: 32, paddingBottom: 28 }}>
            <div style={{ color: 'var(--primary)', marginBottom: 12 }}>
              <Icon name="pallet" size={44} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>这一车装了什么？</div>
            <div style={{ fontSize: 13, color: 'var(--sub)', lineHeight: 1.7, marginBottom: 18 }}>
              建一个车次，然后一块拖板一块拖板地录
              <br />
              装完自动算总箱数、体积和装车方案
            </div>
            <button className="btn primary" onClick={openCreate}>
              新建车次
            </button>
          </div>
        ) : (
          <>
            <div className="stat-grid" style={{ marginTop: 0 }}>
              <div className="stat">
                <div className="v num">{sum?.totalPallets ?? 0}</div>
                <div className="k">拖板数</div>
              </div>
              <div className="stat">
                <div className="v num">{sum?.totalBoxes ?? 0}</div>
                <div className="k">总箱数</div>
              </div>
              <div className="stat">
                <div className="v num">{fmt(sum?.totalVolume ?? 0, 2)}</div>
                <div className="k">体积 m³</div>
              </div>
            </div>

            <div className="sec-title">
              <span>拖板清单</span>
              <span style={{ fontWeight: 400, color: 'var(--faint)' }}>点一块可以改</span>
            </div>

            {draft.pallets.length === 0 ? (
              <div className="card">
                <div className="empty" style={{ padding: 34 }}>
                  还没有拖板
                  <br />
                  点下面按钮加第一块
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {sum?.pallets.map((ps, idx) => (
                  <div className="pallet-card" key={ps.pallet.id} onClick={() => setEditingId(ps.pallet.id)}>
                    <div className="pallet-head">
                      <span className="pallet-no">{ps.pallet.no}</span>
                      <span className="pallet-stats num">
                        {ps.boxes} 箱 · {fmt(ps.volume, 2)} m³
                      </span>
                      <span style={{ flex: 1 }} />
                      {idx === (sum?.pallets.length ?? 0) - 1 && ps.boxes === 0 && (
                        <span className="tag warn">空</span>
                      )}
                    </div>

                    <div className="pallet-art">
                      <PalletArt segs={ps.segments} empty="空拖板，点开加货" />
                    </div>

                    {ps.segments.length > 0 && (
                      <div className="pallet-items">
                        {ps.segments.map((s) => {
                          const sku = db.skus.find((x) => x.id === s.skuId)
                          const color = PALLET_COLORS[s.color % PALLET_COLORS.length]
                          return (
                            <span className="pallet-chip" key={s.skuId}>
                              <i style={{ background: color.stroke }} />
                              {sku?.name ?? '已删除品项'}
                              <b className="num">{s.count}箱</b>
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <button className="btn" style={{ marginTop: 14 }} onClick={newPallet}>
              ＋ 加一块拖板
            </button>

            <div style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={confirmShip} disabled={!sum || sum.totalBoxes === 0}>
                确认发车（扣库存）
              </button>
            </div>
          </>
        )}
      </main>

      <Sheet open={formOpen} title={draft ? '编辑车次' : '新建车次'} onClose={() => setFormOpen(false)}>
        <div className="field">
          <label>客户 / 收货方</label>
          <input
            className="input"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            placeholder="例如：上海仓 / 张三"
          />
        </div>
        <div className="field">
          <label>备注</label>
          <textarea
            className="input"
            rows={2}
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="车牌、司机、注意事项"
          />
        </div>
        <button className="btn primary" onClick={submitForm}>
          {draft ? '保存' : '创建车次'}
        </button>
        {draft && (
          <button
            className="btn danger"
            style={{ marginTop: 10 }}
            onClick={() => {
              removeOrder(draft.id)
              setFormOpen(false)
              toast('已删除该车次')
            }}
          >
            删除这个车次
          </button>
        )}
      </Sheet>

      <Sheet
        open={!!editing}
        title={`${editing?.no ?? ''} 上的货`}
        onClose={() => {
          setEditingId(null)
          setPicker(false)
        }}
      >
        {editing && draft && (
          <>
            {editing.items.length === 0 && !picker && (
              <div className="empty" style={{ padding: '20px 0', color: 'var(--faint)' }}>
                这块还是空的
              </div>
            )}

            {editing.items.map((it) => {
              const sku = db.skus.find((s) => s.id === it.skuId)
              if (!sku) return null
              return (
                <div className="row" key={it.skuId} style={{ padding: '10px 0', borderTop: 0 }}>
                  <div className="grow">
                    <div className="name">{sku.name}</div>
                    <div className="meta">
                      {sku.spec || '无规格'} · {sku.perBox} 件/箱
                    </div>
                  </div>
                  <Stepper
                    value={it.boxes}
                    onChange={(v) => setItemBoxes(draft.id, editing.id, it.skuId, v)}
                  />
                </div>
              )
            })}

            {picker && (
              <>
                <div style={{ fontSize: 13, color: 'var(--sub)', margin: '14px 0 8px' }}>
                  选一个品项加到 {editing.no}：
                </div>
                <div style={{ maxHeight: '38dvh', overflowY: 'auto', margin: '0 -16px' }}>
                  {db.skus.length === 0 && <div className="empty">还没有品项，先去「档案」建一个</div>}
                  {db.skus.map((s) => {
                    const already = editing.items.find((i) => i.skuId === s.id)
                    return (
                      <div
                        className="row"
                        key={s.id}
                        style={{ paddingLeft: 16, paddingRight: 16 }}
                        onClick={() => {
                          setItemBoxes(draft.id, editing.id, s.id, (already?.boxes ?? 0) + 1)
                          setPicker(false)
                        }}
                      >
                        <div className="grow">
                          <div className="name">{s.name}</div>
                          <div className="meta">{s.spec || '无规格'} · {s.perBox} 件/箱</div>
                        </div>
                        {already ? <span className="tag info">已放 {already.boxes} 箱</span> : <span className="tag">添加</span>}
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {!picker && (
              <button className="btn primary" style={{ marginTop: 14 }} onClick={() => setPicker(true)}>
                ＋ 添加品项
              </button>
            )}

            <button
              className="btn danger"
              style={{ marginTop: 10 }}
              onClick={() => {
                removePallet(draft.id, editing.id)
                setEditingId(null)
                setPicker(false)
                toast('已删除这块拖板')
              }}
            >
              删除这块拖板
            </button>
          </>
        )}
      </Sheet>
    </>
  )
}
