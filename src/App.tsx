import { useState } from 'react'
import Load from './pages/Load'
import Records from './pages/Records'
import Stock from './pages/Stock'
import Catalog from './pages/Catalog'
import Me from './pages/Me'
import { Icon, ToastHost } from './components/UI'
import { useStorageInfo } from './lib/store'

const TABS = [
  { key: 'ship', label: '装车', icon: 'pallet' },
  { key: 'records', label: '记录', icon: 'records' },
  { key: 'stock', label: '库存', icon: 'stock' },
  { key: 'catalog', label: '档案', icon: 'catalog' },
  { key: 'me', label: '我的', icon: 'me' },
] as const

type TabKey = (typeof TABS)[number]['key']

/** 兼容旧链接里的 ?tab=pallet / ?tab=load */
const ALIAS: Record<string, TabKey> = {
  pallet: 'ship',
  load: 'ship',
  record: 'records',
}

/** 支持 ?tab=stock 这样的深链，方便直接把某一页发给别人 */
function initialTab(): TabKey {
  try {
    const p = new URLSearchParams(window.location.search).get('tab')
    if (p) {
      if (ALIAS[p]) return ALIAS[p]
      if (TABS.some((t) => t.key === p)) return p as TabKey
    }
  } catch {
    /* 忽略 */
  }
  return 'ship'
}

export default function App() {
  const [tab, setTab] = useState<TabKey>(initialTab)
  const info = useStorageInfo()

  return (
    <div className="app">
      {info.error && (
        <div className="alert" role="alert">
          <span>⚠️</span>
          <span style={{ flex: 1 }}>
            {info.error}
            <br />
            请到「我的 → 导出备份」先存一份，再继续操作。
          </span>
        </div>
      )}

      {tab === 'ship' && <Load />}
      {tab === 'records' && <Records />}
      {tab === 'stock' && <Stock />}
      {tab === 'catalog' && <Catalog />}
      {tab === 'me' && <Me />}

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>
            <span className="ico">
              <Icon name={t.icon} size={20} />
            </span>
            {t.label}
          </button>
        ))}
      </nav>

      <ToastHost />
    </div>
  )
}
