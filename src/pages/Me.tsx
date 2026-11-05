import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { getState, replaceAll, resetAll, useDB, useStorageInfo, type DB } from '../lib/store'
import { boxVolume } from '../lib/calc'
import { toast } from '../components/UI'

function download(name: string, content: BlobPart, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function Me() {
  const db = useDB()
  const info = useStorageInfo()
  const [qr, setQr] = useState('')
  const [quota, setQuota] = useState({ usage: 0, quota: 0 })
  const fileRef = useRef<HTMLInputElement>(null)
  const url = typeof window !== 'undefined' ? window.location.href.split('?')[0].split('#')[0] : ''

  useEffect(() => {
    if (!url) return
    QRCode.toDataURL(url, { width: 420, margin: 1, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(''))
  }, [url])

  useEffect(() => {
    let alive = true
    try {
      const p = navigator.storage?.estimate?.()
      p?.then((e) => {
        if (alive) setQuota({ usage: e.usage ?? 0, quota: e.quota ?? 0 })
      }).catch(() => undefined)
    } catch {
      /* 忽略 */
    }
    return () => {
      alive = false
    }
  }, [info.chars, info.savedAt])

  const exportJson = () => {
    download(`发货助手备份-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(getState(), null, 2), 'application/json')
    toast('备份已导出')
  }

  const exportCsv = () => {
    const rows: string[][] = [
      ['发货单号', '日期', '客户', '拖板号', '品名', '规格', '箱数', '件数', '体积m3', '重量kg'],
    ]
    for (const o of db.orders) {
      for (const p of o.pallets) {
        for (const it of p.items) {
          const sku = db.skus.find((s) => s.id === it.skuId)
          if (!sku) continue
          rows.push([
            o.no,
            new Date(o.createdAt).toLocaleDateString('zh-CN'),
            o.customer,
            p.no,
            sku.name,
            sku.spec,
            String(it.boxes),
            String(it.boxes * sku.perBox),
            (it.boxes * boxVolume(sku)).toFixed(3),
            String(it.boxes * sku.boxWeight),
          ])
        }
      }
    }
    const csv = '\ufeff' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
    download(`发货明细-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8')
    toast('明细已导出，可用 Excel 打开')
  }

  const exportMoves = () => {
    const label: Record<string, string> = { in: '入库', out: '出库', return: '回补', adjust: '调整' }
    const rows: string[][] = [['时间', '类型', '品项', '批次', '数量(正入负出)', '单据/来源', '说明']]
    for (const m of db.moves) {
      const sku = db.skus.find((s) => s.id === m.skuId)
      const batch = db.batches.find((b) => b.id === m.batchId)
      rows.push([
        new Date(m.at).toLocaleString('zh-CN'),
        label[m.type] ?? m.type,
        sku?.name ?? '（品项已删）',
        batch?.batchNo ?? '—',
        String(m.qty),
        m.ref,
        m.note,
      ])
    }
    const csv = '\ufeff' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
    download(`库存流水-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv;charset=utf-8')
    toast('流水已导出，可用 Excel 对账')
  }

  const importJson = async (file: File) => {
    try {
      const text = await file.text()
      const data = JSON.parse(text) as DB
      if (!Array.isArray(data.skus) || !Array.isArray(data.orders)) throw new Error('格式不对')
      if (!confirm('导入会覆盖本机现有数据，确定继续？')) return
      replaceAll(data)
      toast('导入成功')
    } catch {
      toast('文件格式不对，导入失败')
    }
  }

  const clearAll = () => {
    if (confirm('清空本机所有品项、库存和发货单？此操作不可撤销，建议先导出备份。')) {
      resetAll()
      toast('已恢复初始状态')
    }
  }

  const dataSize = new Blob([JSON.stringify(getState())]).size
  const pallets = db.orders.reduce((n, o) => n + o.pallets.length, 0)
  const perOrder = db.orders.length ? dataSize / db.orders.length : 1400
  const remain = quota.quota > 0 ? Math.max(0, quota.quota - quota.usage) : 0
  const remainOrders = quota.quota > 0 ? Math.floor(remain / perOrder) : 0
  const pct = quota.quota > 0 ? Math.min(100, (quota.usage / quota.quota) * 100) : 0
  const fmt = (n: number) => n.toLocaleString('zh-CN')
  const mb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${(n / 1024 ** 2).toFixed(0)} MB`)

  return (
    <>
      <header className="topbar">
        <div style={{ flex: 1 }}>
          <h1>我的</h1>
          <div className="sub">数据存在这台手机上</div>
        </div>
      </header>

      <main className="page">
        <div className="card card-pad" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.3px', marginBottom: 5 }}>扫这个码，别人就能试用</div>
          <div style={{ fontSize: 13, color: 'var(--sub)', marginBottom: 16 }}>
            打开后点「添加到主屏幕」，和 App 一样用
          </div>
          {qr ? (
            <img src={qr} alt="试用二维码" style={{ width: 176, height: 176, display: 'block', margin: '0 auto', borderRadius: 6 }} />
          ) : (
            <div className="empty" style={{ padding: 20 }}>
              二维码生成中
            </div>
          )}
          <div
            className="num"
            style={{ fontSize: 12, color: 'var(--faint)', marginTop: 14, wordBreak: 'break-all', lineHeight: 1.6 }}
          >
            {url}
          </div>
        </div>

        <div className="sec-title">数据</div>
        <div className="card">
          <div className="row" onClick={exportJson}>
            <div className="grow">
              <div className="name">导出备份</div>
              <div className="meta">JSON 文件，换手机或发给同事用</div>
            </div>
            <span className="tag">{(dataSize / 1024).toFixed(0)} KB</span>
          </div>
          <div className="row" onClick={() => fileRef.current?.click()}>
            <div className="grow">
              <div className="name">导入备份</div>
              <div className="meta">用别人的备份文件覆盖本机</div>
            </div>
          </div>
          <div className="row" onClick={exportCsv}>
            <div className="grow">
              <div className="name">导出发货明细</div>
              <div className="meta">CSV，Excel 可直接打开</div>
            </div>
          </div>
          <div className="row" onClick={exportMoves}>
            <div className="grow">
              <div className="name">导出库存流水</div>
              <div className="meta">每一笔入库、发车、退货、盘点，用来对账</div>
            </div>
            <span className="tag">{db.moves.length} 条</span>
          </div>
          <div className="row" onClick={clearAll}>
            <div className="grow">
              <div className="name" style={{ color: 'var(--danger)' }}>
                清空本机数据
              </div>
              <div className="meta">不可撤销</div>
            </div>
          </div>
        </div>

        <div className="sec-title">容量</div>
        <div className="card card-pad">
          <div className="cap-head">
            <div className="cap-main">
              <div className="cap-title">已用 {(dataSize / 1024).toFixed(0)} KB</div>
              <div className="cap-sub">
                {info.mode === 'idb' ? '浏览器数据库' : '浏览器缓存（老模式）'}
                {quota.quota > 0 ? ` · 上限约 ${mb(quota.quota)}` : ' · 上限读取中'}
              </div>
            </div>
            <span className={`tag ${pct > 70 ? 'warn' : 'ok'}`}>{pct > 70 ? '偏满' : '充足'}</span>
          </div>

          <div className="bar">
            <i
              className={pct > 85 ? 'bad' : pct > 70 ? 'warn' : ''}
              style={{ width: `${pct > 0 ? Math.max(pct, 1.5) : 0}%` }}
            />
          </div>

          <div className="stat3">
            <div>
              <b>{fmt(db.orders.length)}</b>
              <span>车次</span>
            </div>
            <div>
              <b>{fmt(pallets)}</b>
              <span>块拖板</span>
            </div>
            <div>
              <b>{fmt(db.skus.length)}</b>
              <span>品项</span>
            </div>
          </div>

          <div className="cap-sub" style={{ marginTop: 10 }}>
            一车 8 块板约 1.3 KB
            {quota.quota > 0 ? `，按剩余空间还能再记约 ${fmt(remainOrders)} 车` : ''}。
            {info.mode === 'idb'
              ? '数据存在浏览器数据库里，容量按手机剩余空间分配，不再是 5 MB 上限。'
              : '当前是缓存模式，上限约 5 MB，容量偏紧，请多导出备份。'}
          </div>

          <div className="cap-sub" style={{ marginTop: 6 }}>
            长期保留：{info.persisted ? '已开启，系统不会主动清理' : '未开启，加个「添加到主屏幕」更容易获批'}
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) importJson(f)
            e.target.value = ''
          }}
        />

        <div className="sec-title">说明</div>
        <div className="card card-pad" style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--sub)' }}>
          <p style={{ margin: '0 0 10px' }}>
            这是一个纯网页应用（PWA），不装 App、不走应用商店。数据和记录都保存在当前手机浏览器里，不会上传到任何服务器。
          </p>
          <p style={{ margin: '0 0 10px' }}>
            <b style={{ color: 'var(--text)' }}>换手机、清缓存、换浏览器都会读不到旧数据</b>，所以重要数据请定期「导出备份」。
          </p>
          <p style={{ margin: 0 }}>
            你和同事各自扫码打开，是各自独立的一份数据。要多人实时共享同一份库存，需要额外接一个后端。
          </p>
        </div>
      </main>
    </>
  )
}
