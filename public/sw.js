/* 发货助手 service worker：首次打开把整个应用缓存到手机，之后断网也能开、秒开。
 * 策略：
 *  - 静态资源走「缓存优先 + 后台更新」，在 fetch 时逐个缓存，不依赖 install 时一次性 addAll
 *    （避免某个 URL 失败导致整个 SW 安装失败）。
 *  - 数据不走网络（存 IndexedDB），这里不拦截、不缓存任何数据。
 *  - 版本号变化时旧缓存清理。
 */
const CACHE = 'fahuo-v2'
const INDEX_URL = './index.html'

self.addEventListener('install', () => {
  // 不预缓存，只声明接管，避免 install 失败；资源在首次 fetch 时落缓存
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // 页面导航：网络优先，失败回退缓存（断网时也能进应用）
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(INDEX_URL, copy))
          return res
        })
        .catch(() => caches.match(INDEX_URL)),
    )
    return
  }

  // 其余静态资源：网络优先，拿到最新代码就更新缓存；断网时回退缓存（离线仍可用）
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
        }
        return res
      })
      .catch(() => caches.match(req)),
  )
})
