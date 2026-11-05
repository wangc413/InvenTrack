import { useState } from 'react'
import Pallets from './pages/Pallets'
import Stock from './pages/Stock'
import Catalog from './pages/Catalog'
import Load from './pages/Load'
import Me from './pages/Me'
import { Icon, ToastHost } from './components/UI'
import { useStorageInfo } from './lib/store'

const TABS = [
  { key: 'pallet', label: '装板', icon: 'pallet' },
  { key: 'stock', label: '库存', icon: 'stock' },
  { key: 'catalog', label: '档案', icon: 'catalog' },
  { key: 'load', label: '装车', icon: 'load' },
  { key: 'me', label: '我的', icon: 'me' },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function App() {
  const [tab, setTab] = useState<TabKey>('pallet')
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

      {tab === 'pallet' && <Pallets />}
      {tab === 'stock' && <Stock />}
      {tab === 'catalog' && <Catalog />}
      {tab === 'load' && <Load />}
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
