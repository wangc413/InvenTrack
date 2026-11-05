import { useEffect, useState } from 'react'
import { saveSku, type Sku } from '../lib/store'
import { Sheet, toast } from './UI'

const blank = {
  code: '',
  name: '',
  spec: '',
  unit: '件',
  perBox: 12,
  boxL: 40,
  boxW: 30,
  boxH: 25,
  boxWeight: 5,
}

export default function SkuForm({
  open,
  initial,
  presetCode,
  onClose,
  onDelete,
}: {
  open: boolean
  initial?: Sku | null
  presetCode?: string
  onClose: () => void
  onDelete?: () => void
}) {
  const [f, setF] = useState(blank)

  useEffect(() => {
    if (!open) return
    if (initial) {
      const { id: _id, ...rest } = initial
      setF({ ...blank, ...rest })
    } else {
      setF({ ...blank, code: presetCode ?? '' })
    }
  }, [open, initial, presetCode])

  const set = <K extends keyof typeof blank>(k: K, v: (typeof blank)[K]) => setF((p) => ({ ...p, [k]: v }))
  const num = (v: string) => (v === '' ? 0 : Number(v))

  const submit = () => {
    if (!f.name.trim()) return toast('请填写品名')
    if (f.perBox <= 0) return toast('每箱件数要大于 0')
    saveSku({ ...f, name: f.name.trim(), code: f.code.trim(), id: initial?.id })
    toast(initial ? '已保存' : '已新增品项')
    onClose()
  }

  return (
    <Sheet open={open} title={initial ? '编辑品项' : '新增品项'} onClose={onClose}>
      <div className="field">
        <label>品名 *</label>
        <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="例如：红富士苹果 80# 精品箱" />
      </div>

      <div className="row-2">
        <div className="field" style={{ flex: 1 }}>
          <label>条码 / 货号</label>
          <input className="input num" inputMode="numeric" value={f.code} onChange={(e) => set('code', e.target.value)} placeholder="扫码自动填" />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>规格</label>
          <input className="input" value={f.spec} onChange={(e) => set('spec', e.target.value)} placeholder="5kg×4" />
        </div>
      </div>

      <div className="row-2">
        <div className="field" style={{ flex: 1 }}>
          <label>每箱件数 *</label>
          <input className="input num" inputMode="numeric" value={f.perBox || ''} onChange={(e) => set('perBox', num(e.target.value))} placeholder="12" />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>单箱重量 (kg)</label>
          <input className="input num" inputMode="decimal" value={f.boxWeight || ''} onChange={(e) => set('boxWeight', num(e.target.value))} placeholder="5" />
        </div>
      </div>

      <div className="field">
        <label>箱规 长 × 宽 × 高 (cm)</label>
        <div className="row-2">
          <input className="input num" inputMode="decimal" value={f.boxL || ''} onChange={(e) => set('boxL', num(e.target.value))} placeholder="长" />
          <input className="input num" inputMode="decimal" value={f.boxW || ''} onChange={(e) => set('boxW', num(e.target.value))} placeholder="宽" />
          <input className="input num" inputMode="decimal" value={f.boxH || ''} onChange={(e) => set('boxH', num(e.target.value))} placeholder="高" />
        </div>
      </div>

      <button className="btn primary" onClick={submit} style={{ marginTop: 4 }}>
        保存
      </button>
      {onDelete && (
        <button className="btn danger" style={{ marginTop: 10 }} onClick={onDelete}>
          删除这个品项
        </button>
      )}
    </Sheet>
  )
}
