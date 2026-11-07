import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initStore } from './lib/store'

// 注册 service worker，首次打开后缓存整个应用，之后断网也能开、秒开。
// 只在正式环境（生产构建）注册，开发时用 vite 自己起服务，避免缓存捣乱。
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined)
    // 检测到新版本 SW 接管后，自动刷新一次，让用户拿到最新代码
    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return
      reloading = true
      window.location.reload()
    })
  })
}

// 先把数据从手机里读回内存，再渲染界面，避免闪一下示例数据
initStore()
  .catch(() => undefined)
  .finally(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
