import { useState } from 'react'
import { saveTruck, unshipOrder, useDB, type Truck } from '../lib/store'
import { fmt, planTruck, summarize } from '../lib/calc'
import { Sheet, toast } from '../components/UI'

function gridOf(truck: Truck, l: number, w: number) {
  let best = { na: 0, nb: 0, a: l, b: w }
  for (const [a, b] of [
    [l, w],
    [w, l],
  ]) {
    const na = Math.floor(truck.L / a)
    const nb = Math.floor(truck.W / b)
    if (na * nb > best.na * best.nb) best = { na, nb, a, b }
  }
  return best
}

export default function Load() {
  const db = useDB()
  // 只列未发车的单 + 最近 15 条已发车单：数据攒到几千条时也不会一次渲染上千个按钮
  const all = db.orders.filter((o) => o.pallets.some((p) => p.items.length > 0))
  const orders = [...all.filter((o) => o.status === 'draft'), ...all.filter((o) => o.status === 'shipped').slice(0, 15)]
  const truncated = all.length > orders.length
  const [pickedId, setPickedId] = useState('')
  const [editing, setEditing] = useState(false)

  const truck = db.trucks[0]
  const order = orders.find((o) => o.id === pickedId) ?? orders[0]
  const sum = order ? summarize(db, order) : null
  const plan = sum && truck ? planTruck(truck, sum) : null
  const dominant = plan?.layout[0]

  const [form, setForm] = useState({ L: 420, W: 200, H: 220, maxWeight: 2000, name: '4.2米厢货' })

  const openEdit = () => {
    if (truck) setForm({ L: truck.L, W: truck.W, H: truck.H, maxWeight: truck.maxWeight, name: truck.name })
    setEditing(true)
  }

  const saveNow = () => {
    if (!form.L || !form.W || !form.H) return toast('车厢尺寸不能为空')
    saveTruck({ ...form, id: truck?.id })
    setEditing(false)
    toast('车厢参数已保存')
  }

  const grid = truck && dominant ? gridOf(truck, dominant.boxL, dominant.boxW) : null

  return (
    <>
      <header className="topbar">
        <div style={{ flex: 1 }}>
          <h1>装车方案</h1>
          <div className="sub">{truck ? `${truck.name} · ${truck.L}×${truck.W}×${truck.H}cm` : '还没设置车厢'}</div>
        </div>
        <button className="icon-btn" onClick={openEdit} aria-label="设置车厢">
          ⚙
        </button>
      </header>

      <main className="page">
        {orders.length === 0 ? (
          <div className="empty">
            还没有可装车的单
            <br />
            先去「发货」加几件货
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, marginBottom: 10 }}>
              {orders.map((o) => (
                <button
                  key={o.id}
                  className={`btn sm ${o.id === order?.id ? 'primary' : ''}`}
                  style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}
                  onClick={() => setPickedId(o.id)}
                >
                  {o.customer}
                </button>
              ))}
              {truncated && (
                <span className="meta" style={{ alignSelf: 'center', whiteSpace: 'nowrap' }}>
                  仅显示未发车 + 最近 15 单
                </span>
              )}
            </div>

            {sum && plan && (
              <>
                <div className="card card-pad">
                  <div className="kv">
                    <span className="k">总件数 / 箱数</span>
                    <span className="v num">
                      {sum.totalQty} 件 · {sum.totalBoxes} 箱
                    </span>
                  </div>
                  <div className="kv">
                    <span className="k">货物体积</span>
                    <span className="v num">
                      {fmt(sum.totalVolume, 2)} m³ / 车厢 {fmt(plan.capacityVolume, 1)} m³
                    </span>
                  </div>
                  <div className="bar">
                    <i className={plan.volumeRate > 1 ? 'bad' : plan.volumeRate > 0.9 ? 'warn' : ''} style={{ width: `${Math.min(100, plan.volumeRate * 100)}%` }} />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--sub)', marginTop: 6 }}>
                    体积利用率 {fmt(plan.volumeRate * 100, 0)}%
                  </div>

                  <div className="kv" style={{ marginTop: 10 }}>
                    <span className="k">总重量</span>
                    <span className="v num">
                      {fmt(sum.totalWeight, 0)} kg / 载重 {truck?.maxWeight} kg
                    </span>
                  </div>
                  <div className="bar">
                    <i className={plan.weightRate > 1 ? 'bad' : plan.weightRate > 0.9 ? 'warn' : ''} style={{ width: `${Math.min(100, plan.weightRate * 100)}%` }} />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--sub)', marginTop: 6 }}>
                    重量利用率 {fmt(plan.weightRate * 100, 0)}%
                  </div>
                </div>

                <div
                  className="card card-pad"
                  style={{
                    marginTop: 12,
                    background: plan.overVolume || plan.overWeight ? 'var(--danger-soft)' : 'var(--ok-soft)',
                    borderColor: 'transparent',
                  }}
                >
                  <div style={{ fontSize: 15, fontWeight: 600, color: plan.overVolume || plan.overWeight ? 'var(--danger)' : 'var(--ok)' }}>
                    {plan.overVolume || plan.overWeight
                      ? plan.overWeight && !plan.overVolume
                        ? '超重，需要分车'
                        : '装不下，需要分车'
                      : '一车能装完'}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--sub)', marginTop: 6, lineHeight: 1.7 }}>
                    {dominant
                      ? `按「${dominant.skuName}」的箱规，每层可摆 ${dominant.perLayer} 箱，最多叠 ${dominant.layers} 层，单车上限 ${dominant.perLayer * dominant.layers} 箱。`
                      : '暂无箱规数据'}
                    {plan.trucksNeeded > 1 && ` 本单建议 ${plan.trucksNeeded} 车。`}
                  </div>
                </div>

                {order?.status === 'shipped' && (
                  <div className="card card-pad" style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>这单已发车</div>
                    <div style={{ fontSize: 12, color: 'var(--sub)', marginTop: 6, lineHeight: 1.75 }}>
                      发错货、客户临时取消，都可以撤销。撤销会把扣掉的库存按原批次加回去，单据退回「未发车」，改完能再发一次。
                    </div>
                    <button
                      className="btn sm"
                      style={{ marginTop: 10, width: '100%' }}
                      onClick={() => {
                        if (!order) return
                        if (!confirm(`撤销 ${order.no}？库存会按原批次回补。`)) return
                        unshipOrder(order.id)
                        toast('已撤销，库存已回补')
                      }}
                    >
                      撤销发车 · 库存回补
                    </button>
                  </div>
                )}

                {grid && truck && dominant && (
                  <>
                    <div className="sec-title">第一层铺法（俯视）</div>
                    <div className="card card-pad">
                      <div style={{ background: '#fbfcfd', border: '1px dashed #c9ced6', borderRadius: 10, padding: 10 }}>
                        <svg viewBox={`0 0 ${truck.L} ${truck.W}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
                          <rect x="0" y="0" width={truck.L} height={truck.W} fill="#eef1f5" stroke="#9aa1ab" strokeWidth="3" vectorEffect="non-scaling-stroke" />
                          {Array.from({ length: grid.nb }).map((_, j) =>
                            Array.from({ length: grid.na }).map((_, i) => (
                              <rect
                                key={`${i}-${j}`}
                                x={i * grid.a + 1}
                                y={j * grid.b + 1}
                                width={grid.a - 2}
                                height={grid.b - 2}
                                rx={3}
                                fill={(i + j) % 2 === 0 ? '#c7d7f5' : '#dbe6fa'}
                                stroke="#2563eb"
                                strokeWidth="1"
                                vectorEffect="non-scaling-stroke"
                              />
                            )),
                          )}
                        </svg>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--sub)', marginTop: 8 }}>
                        <span>
                          车头 → 车尾 {truck.L} cm（{grid.na} 列）
                        </span>
                        <span>
                          宽 {truck.W} cm（{grid.nb} 排）
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--sub)', marginTop: 8, lineHeight: 1.7 }}>
                        每箱 {dominant.boxL}×{dominant.boxW}×{dominant.boxH}cm，本层共 {grid.na * grid.nb} 箱；
                        叠 {Math.min(dominant.layers, Math.ceil(sum.totalBoxes / (grid.na * grid.nb)))} 层装完。
                      </div>
                    </div>
                  </>
                )}

                <div className="sec-title">各品项装车能力</div>
                <div className="card">
                  {plan.layout.map((l) => (
                    <div className="row" key={l.skuName} style={{ alignItems: 'flex-start' }}>
                      <div className="grow">
                        <div className="name">{l.skuName}</div>
                        <div className="meta num">
                          {l.boxL}×{l.boxW}×{l.boxH}cm · 每层 {l.perLayer} 箱 × {l.layers} 层
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="tag info">单车 {l.capacityPerTruck} 箱</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: 12, color: 'var(--faint)', lineHeight: 1.7, marginTop: 14, padding: '0 4px' }}>
                  这里按「同类箱规整层堆码」估算，不考虑混装插空和重心。实际装车以现场为准，超重优先于超体积。
                </div>
              </>
            )}
          </>
        )}
      </main>

      <Sheet open={editing} title="车厢参数" onClose={() => setEditing(false)}>
        <div className="field">
          <label>车型名称</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="field">
          <label>内尺寸 长 × 宽 × 高 (cm)</label>
          <div className="row-2">
            <input className="input num" inputMode="decimal" value={form.L} onChange={(e) => setForm({ ...form, L: Number(e.target.value) })} />
            <input className="input num" inputMode="decimal" value={form.W} onChange={(e) => setForm({ ...form, W: Number(e.target.value) })} />
            <input className="input num" inputMode="decimal" value={form.H} onChange={(e) => setForm({ ...form, H: Number(e.target.value) })} />
          </div>
        </div>
        <div className="field">
          <label>额定载重 (kg)</label>
          <input className="input num" inputMode="numeric" value={form.maxWeight} onChange={(e) => setForm({ ...form, maxWeight: Number(e.target.value) })} />
        </div>
        <button className="btn primary" onClick={saveNow}>
          保存
        </button>
      </Sheet>
    </>
  )
}
