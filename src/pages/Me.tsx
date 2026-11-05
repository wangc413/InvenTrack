import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { getState, replaceAll, resetAll, useDB, type DB } from '../lib/store'
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
  const [qr, setQr] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const url = typeof window !== 'undefined' ? window.location.href.split('?')[0].split('#')[0] : ''

  useEffect(() => {
    if (!url) return
    QRCode.toDataURL(url, { width: 420, margin: 1, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(''))
  }, [url])

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
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>扫这个码，别人就能试用</div>
          <div style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 14 }}>
            打开后点「添加到主屏幕」，和 App 一样用
          </div>
          {qr ? (
            <img src={qr} alt="试用二维码" style={{ width: 190, height: 190, display: 'block', margin: '0 auto', borderRadius: 8 }} />
          ) : (
            <div className="empty" style={{ padding: 20 }}>
              二维码生成中
            </div>
          )}
          <div
            className="num"
            style={{ fontSize: 12, color: 'var(--sub)', marginTop: 12, wordBreak: 'break-all', lineHeight: 1.6 }}
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
          <div className="row" onClick={clearAll}>
            <div className="grow">
              <div className="name" style={{ color: 'var(--danger)' }}>
                清空本机数据
              </div>
              <div className="meta">不可撤销</div>
            </div>
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
