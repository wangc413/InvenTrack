import { useState } from 'react'
import Ship from './pages/Ship'
import Stock from './pages/Stock'
import Catalog from './pages/Catalog'
import Load from './pages/Load'
import Me from './pages/Me'
import { Icon, ToastHost } from './components/UI'

const TABS = [
  { key: 'ship', label: '发货', icon: 'ship' },
  { key: 'stock', label: '库存', icon: 'stock' },
  { key: 'catalog', label: '档案', icon: 'catalog' },
  { key: 'load', label: '装车', icon: 'load' },
  { key: 'me', label: '我的', icon: 'me' },
] as const

type TabKey = (typeof TABS)[number]['key']

export default function App() {
  const [tab, setTab] = useState<TabKey>('ship')

  return (
    <div className="app">
      {tab === 'ship' && <Ship />}
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
