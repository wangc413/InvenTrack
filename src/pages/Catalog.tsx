import { useEffect, useState } from 'react'
import {
  removeCustomer,
  saveCustomer,
  stockOf,
  updateCustomer,
  useDB,
  type Customer,
  type Sku,
} from '../lib/store'
import SkuDetail from './SkuDetail'
import { boxText, layerPlan } from '../lib/calc'
import { Icon, Sheet, toast } from '../components/UI'

/* ---------- 客户 ---------- */

function CustomerSheet({
  open,
  initial,
  onClose,
}: {
  open: boolean
  initial: Customer | null
  onClose: () => void
}) {
  const db = useDB()
  const [name, setName] = useState('')

  useEffect(() => {
    if (open) setName(initial?.name ?? '')
  }, [open, initial])

  const usedBy = initial ? db.skus.filter((s) => s.customerId === initial.id).length : 0

  const submit = () => {
    if (!name.trim()) return toast('请填写客户名称')
    if (initial) updateCustomer(initial.id, name)
    else saveCustomer(name)
    toast(initial ? '已保存' : '已新增客户')
    onClose()
  }

  const del = () => {
    if (!initial) return
    if (usedBy > 0) return toast(`名下还有 ${usedBy} 个品，先把品改到别的客户`)
    if (!confirm(`删除客户「${initial.name}」？`)) return
    removeCustomer(initial.id)
    toast('已删除')
    onClose()
  }

  return (
    <Sheet open={open} title={initial ? '编辑客户' : '新增客户'} onClose={onClose}>
      <div className="field">
        <label>客户名称 *</label>
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：盒马"
          autoFocus
        />
      </div>
      {initial && (
        <div className="hint" style={{ margin: '0 2px' }}>
          名下 {usedBy} 个品。品项在下面按客户分组，装车时选的「收货方」就是这里。
        </div>
      )}
      <div className="sheet-actions">
        <button className="btn primary" onClick={submit}>
          保存
        </button>
        {initial && (
          <button className="btn danger" style={{ marginTop: 10 }} onClick={del}>
            删除这个客户
          </button>
        )}
      </div>
    </Sheet>
  )
}

/* ---------- 页面 ---------- */

export default function Catalog() {
  const db = useDB()
  const [viewing, setViewing] = useState<Sku | null>(null)
  const [custOpen, setCustOpen] = useState(false)
  const [custEditing, setCustEditing] = useState<Customer | null>(null)

  const openCustomer = (c: Customer | null) => {
    setCustEditing(c)
    setCustOpen(true)
  }

  return (
    <>
      <header className="topbar">
        <h1>品项档案</h1>
        <p className="sub">点开品项看它的外箱和规格，对着现场核对</p>
      </header>

      <main className="page">
        {db.customers.map((c) => {
          const list = db.skus.filter((s) => s.customerId === c.id)
          return (
            <section key={c.id}>
              <div className="group-label">
                {c.name}
                <span>{list.length} 个品</span>
              </div>
              {list.length === 0 ? (
                <div className="card card-pad">
                  <div className="hint" style={{ margin: 0 }}>
                    还没有品项。点右上角 + 新增，归到「{c.name}」名下。
                  </div>
                </div>
              ) : (
                <div className="card">
                  {list.map((s) => (
                    <div
                      className="row"
                      key={s.id}
                      onClick={() => setViewing(s)}
                    >
                      <span className="pick-swatch" style={{ background: s.accentColor, height: 30 }} />
                      <div className="grow">
                        <div className="name">{s.name}</div>
                        <div className="meta">{s.spec || '无规格'}</div>
                        <div className="meta">
                          {s.boxL}×{s.boxW}×{s.boxH} mm · {s.boxWeight} kg/箱
                        </div>
                        <div className="meta">
                          一层 {layerPlan(s).perLayer} 个 · {layerPlan(s).note}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
                        <div className="tag info">每箱 {s.perBox} 件</div>
                        <div className="meta num" style={{ marginTop: 4 }}>
                          存 {boxText(stockOf(db, s.id), s.perBox)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )
        })}

        <section>
          <div className="group-label">
            客户
            <span>{db.customers.length} 家</span>
          </div>
          <div className="card">
            {db.customers.map((c) => (
              <div className="row" key={c.id} onClick={() => openCustomer(c)}>
                <div className="grow">
                  <div className="name">{c.name}</div>
                </div>
                <span className="meta">{db.skus.filter((s) => s.customerId === c.id).length} 个品</span>
              </div>
            ))}
            <div className="row" onClick={() => openCustomer(null)}>
              <div className="grow">
                <div className="name" style={{ color: 'var(--primary)' }}>
                  新增客户
                </div>
              </div>
              <Icon name="plus" size={16} />
            </div>
          </div>
        </section>

        <div className="hint">
          点开品项看它的外箱和体积，对着现场核对。客户可以随时加，装车时填的「收货方」就是这里列出来的这些。
        </div>
      </main>

      {viewing && <SkuDetail sku={viewing} onClose={() => setViewing(null)} />}

      <CustomerSheet open={custOpen} initial={custEditing} onClose={() => setCustOpen(false)} />
    </>
  )
}
