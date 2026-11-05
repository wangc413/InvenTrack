import { useState } from 'react'
import { removeSku, stockOf, useDB, type Sku } from '../lib/store'
import SkuForm from '../components/SkuForm'
import { Icon, toast } from '../components/UI'

export default function Catalog() {
  const db = useDB()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Sku | null>(null)

  const add = () => {
    setEditing(null)
    setOpen(true)
  }

  return (
    <>
      <header className="topbar">
        <h1>品项档案</h1>
        <button className="icon-btn" onClick={add} aria-label="新增品项">
          <Icon name="plus" size={20} />
        </button>
        <p className="sub">箱规、每箱件数和箱面配色，3D 装箱图按这些来画</p>
      </header>

      <main className="page">
        {db.customers.map((c) => {
          const list = db.skus.filter((s) => s.customerId === c.id)
          if (list.length === 0) return null
          return (
            <section key={c.id}>
              <div className="group-label">
                {c.name}
                <span>{list.length} 个品</span>
              </div>
              <div className="card">
                {list.map((s) => (
                  <div
                    className="row"
                    key={s.id}
                    onClick={() => {
                      setEditing(s)
                      setOpen(true)
                    }}
                  >
                    <span className="pick-swatch" style={{ background: s.accentColor, height: 30 }} />
                    <div className="grow">
                      <div className="name">{s.shortName}</div>
                      <div className="meta">
                        {s.spec || '无规格'}
                      </div>
                      <div className="meta">
                        {s.boxL}×{s.boxW}×{s.boxH} mm · {s.boxWeight} kg/箱
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
                      <div className="tag info">每箱 {s.perBox}</div>
                      <div className="meta num" style={{ marginTop: 4 }}>
                        存 {stockOf(db, s.id)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )
        })}

        <div className="hint">
          箱规照外箱稿上的「长*宽*高（外径）」填，单位毫米。填得越准，3D 装箱图和装车数越靠谱。
        </div>
      </main>

      <SkuForm
        open={open}
        initial={editing}
        onClose={() => setOpen(false)}
        onDelete={
          editing
            ? () => {
                if (confirm(`删除「${editing.name}」及其所有批次？`)) {
                  removeSku(editing.id)
                  setOpen(false)
                  toast('已删除')
                }
              }
            : undefined
        }
      />
    </>
  )
}
