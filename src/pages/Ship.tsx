import { lazy, Suspense, useRef, useState } from 'react'
import {
  bumpLine,
  createOrder,
  findByCode,
  getState,
  removeOrder,
  setLineQty,
  shipOrder,
  updateOrder,
  useDB,
} from '../lib/store'
import { boxify, fmt, summarize } from '../lib/calc'
import SkuForm from '../components/SkuForm'
import { Icon, Sheet, Stepper, toast } from '../components/UI'

const Scanner = lazy(() => import('../components/Scanner'))

export default function Ship() {
  const db = useDB()
  const draft = db.orders.find((o) => o.status === 'draft')

  const [scanning, setScanning] = useState(false)
  const [byBox, setByBox] = useState(false)
  const [scanCount, setScanCount] = useState(0)
  const [formOpen, setFormOpen] = useState(false)
  const [customer, setCustomer] = useState('')
  const [remark, setRemark] = useState('')
  const [unknown, setUnknown] = useState<string | null>(null)
  const [lastAdded, setLastAdded] = useState('')
  const [quickOpen, setQuickOpen] = useState(false)
  const pendingCode = useRef('')

  const sum = draft ? summarize(db, draft) : null

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
      toast('已更新发货单')
    } else {
      const id = createOrder(customer.trim(), remark)
      if (id) toast('发货单已创建，开始扫码')
    }
    setFormOpen(false)
  }

  const handleScan = (code: string) => {
    const cur = getState().orders.find((o) => o.status === 'draft')
    if (!cur) return
    const sku = findByCode(getState(), code)
    if (!sku) {
      setScanning(false)
      setUnknown(code)
      return
    }
    const delta = byBox ? Math.max(1, sku.perBox) : 1
    bumpLine(cur.id, sku.id, delta)
    setScanCount((c) => c + 1)
    setLastAdded(`${sku.name} +${delta}${byBox ? '件（1箱）' : '件'}`)
  }

  const confirmShip = () => {
    if (!draft || draft.lines.length === 0) return toast('还没有加货')
    shipOrder(draft.id)
    setScanCount(0)
    setLastAdded('')
    toast('已确认发货，库存已扣减')
  }

  return (
    <>
      <header className="topbar">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>{draft ? draft.customer : '发货'}</h1>
          <div className="sub">
            {draft ? `${draft.no} · 进行中` : '新建一张单，扫码往上加货'}
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
          <>
            <div className="card card-pad" style={{ textAlign: 'center', paddingTop: 32, paddingBottom: 28 }}>
              <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 12, color: 'var(--primary)' }}>
                <Icon name="ship" size={44} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>今天发哪一单？</div>
              <div style={{ fontSize: 13, color: 'var(--sub)', lineHeight: 1.7, marginBottom: 18 }}>
                建单后，扫一件加一件
                <br />
                系统自动算箱数、扣库存、出单据
              </div>
              <button className="btn primary" onClick={openCreate}>
                新建发货单
              </button>
            </div>

            <div className="sec-title">最近发货</div>
            <div className="card">
              {db.orders.filter((o) => o.status === 'shipped').slice(0, 5).length === 0 ? (
                <div className="empty" style={{ padding: 28 }}>
                  还没有发货记录
                </div>
              ) : (
                db.orders
                  .filter((o) => o.status === 'shipped')
                  .slice(0, 5)
                  .map((o) => (
                    <div className="row" key={o.id}>
                      <div className="grow">
                        <div className="name">{o.customer}</div>
                        <div className="meta">{o.no}</div>
                      </div>
                      <span className="tag ok">已发货</span>
                    </div>
                  ))
              )}
            </div>
          </>
        ) : (
          <>
            <button className="big-scan" onClick={() => setScanning(true)}>
              <Icon name="scan" size={26} />
              <div className="t1">扫码加货</div>
              <div className="t2">当前每扫一次 = {byBox ? '1 箱' : '1 件'}</div>
            </button>

            <div className="row-2" style={{ marginTop: 10 }}>
              <button
                className={`btn sm ${byBox ? '' : 'primary'}`}
                style={{ flex: 1, height: 40 }}
                onClick={() => setByBox(false)}
              >
                按件扫
              </button>
              <button
                className={`btn sm ${byBox ? 'primary' : ''}`}
                style={{ flex: 1, height: 40 }}
                onClick={() => setByBox(true)}
              >
                按箱扫
              </button>
              <button className="btn sm" style={{ flex: 1, height: 40 }} onClick={() => setUnknown('')}>
                手动加
              </button>
            </div>

            <div className="stat-grid">
              <div className="stat">
                <div className="v num">{sum?.totalQty ?? 0}</div>
                <div className="k">总件数</div>
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
              <span>本单明细</span>
              <span style={{ fontWeight: 400, color: 'var(--faint)' }}>
                {scanCount > 0 ? `本次已扫 ${scanCount} 次` : ''}
              </span>
            </div>

            <div className="card">
              {draft.lines.length === 0 ? (
                <div className="empty" style={{ padding: 34 }}>
                  扫第一件货开始
                  {lastAdded && <div style={{ marginTop: 8, color: 'var(--primary)' }}>{lastAdded}</div>}
                </div>
              ) : (
                sum?.lines.map((l) => {
                  const b = boxify(l.qty, l.sku.perBox)
                  return (
                    <div className="row" key={l.sku.id}>
                      <div className="grow">
                        <div className="name">{l.sku.name}</div>
                        <div className="meta num">
                          {l.qty} 件 = {b.total} 箱
                          {b.tail > 0 ? `（${b.full} 整箱 + 尾箱 ${b.tail} 件）` : ''}
                        </div>
                      </div>
                      <Stepper
                        value={l.qty}
                        step={byBox ? Math.max(1, l.sku.perBox) : 1}
                        onChange={(v) => setLineQty(draft.id, l.sku.id, v)}
                      />
                    </div>
                  )
                })
              )}
            </div>

            {lastAdded && draft.lines.length > 0 && (
              <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--primary)', marginTop: 10 }}>
                刚刚：{lastAdded}
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <button
                className="btn primary"
                onClick={confirmShip}
                disabled={draft.lines.length === 0}
              >
                确认发货（扣库存）
              </button>
            </div>
          </>
        )}
      </main>

      {scanning && (
        <Suspense fallback={null}>
          <Scanner onResult={handleScan} onClose={() => setScanning(false)} count={scanCount} />
        </Suspense>
      )}

      <Sheet open={formOpen} title={draft ? '编辑发货单' : '新建发货单'} onClose={() => setFormOpen(false)}>
        <div className="field">
          <label>客户 / 收货方</label>
          <input
            className="input"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            placeholder="例如：上海仓调拨 / 张三"
          />
        </div>
        <div className="field">
          <label>备注</label>
          <textarea
            className="input"
            rows={2}
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="车次、司机、特殊要求"
          />
        </div>
        <button className="btn primary" onClick={submitForm}>
          {draft ? '保存' : '创建并开始'}
        </button>
        {draft && (
          <button
            className="btn danger"
            style={{ marginTop: 10 }}
            onClick={() => {
              removeOrder(draft.id)
              setFormOpen(false)
              setScanCount(0)
              toast('已删除该发货单')
            }}
          >
            删除这张单
          </button>
        )}
      </Sheet>

      <Sheet open={unknown !== null} title={unknown ? '这个条码还没建档' : '手动加货'} onClose={() => setUnknown(null)}>
        <div style={{ fontSize: 13, color: 'var(--sub)', lineHeight: 1.7, marginBottom: 14 }}>
          {unknown ? (
            <>
              条码 <b className="num">{unknown}</b> 不在档案里。先补一个品项，再扫就能自动带出名称和箱规。
            </>
          ) : (
            '从已有品项里选一个加入本单。'
          )}
        </div>
        {unknown ? (
          <button
            className="btn primary"
            onClick={() => {
              pendingCode.current = unknown
              setUnknown(null)
              setQuickOpen(true)
            }}
          >
            立即建档
          </button>
        ) : (
          <div style={{ maxHeight: '50dvh', overflowY: 'auto', margin: '0 -16px' }}>
            {db.skus.map((s) => (
              <div
                className="row"
                key={s.id}
                style={{ paddingLeft: 16, paddingRight: 16 }}
                onClick={() => {
                  if (draft) bumpLine(draft.id, s.id, byBox ? Math.max(1, s.perBox) : 1)
                  setUnknown(null)
                  toast(`${s.name} 已加入`)
                }}
              >
                <div className="grow">
                  <div className="name">{s.name}</div>
                  <div className="meta">{s.spec || '—'} · 每箱 {s.perBox} 件</div>
                </div>
                <span className="tag info">加入</span>
              </div>
            ))}
          </div>
        )}
      </Sheet>

      <SkuForm
        open={quickOpen}
        presetCode={pendingCode.current}
        onClose={() => {
          setQuickOpen(false)
          pendingCode.current = ''
        }}
      />
    </>
  )
}
