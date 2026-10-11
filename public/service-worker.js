/**
 * Service Worker —— 「零等待与离线可看」（方案 6 的保命项）。
 *
 * 为什么需要它：答辩现场的网络一定不稳。这个项目首屏要下模型（预览档 ≈0.5 MiB/尊），
 * 一旦现场网络抽风，最糟的情况是评委看着"正在加载 360° 模型"转圈。
 * 有了它，**第二次打开整站可直接离线**：外壳 + 首屏模型都在本地。
 *
 * 策略分工（每一条都有明确理由，不要随意合并）：
 *   ① 导航请求（HTML）→ network-first，失败回落缓存。
 *      为什么要网络优先：内容是会改的（文案、模型），必须先看到新版；
 *      缓存只是"没网时的兜底"。用 cache-first 会让观众长期看到旧版而毫无察觉。
 *   ② 带内容哈希的静态资源（./src/*.js、./models/v/*）→ cache-first。
 *      文件名即内容摘要，永不变更 —— 命中缓存就是最新，无需再问网络。
 *   ③ 首屏预缓存清单 → install 阶段 addAll。
 *      全部成功才激活；任何一项失败就整体不激活（宁可没有离线，也不要"半套"离线）。
 *   ④ 精细模型 → **不预缓存**，只用运行时缓存（看过哪尊留哪尊，LRU 淘汰）。
 *      12 尊精细档近 58 MiB，超过站点存储配额会让 addAll 整体失败 —— 实测的坑，见下。
 *   ⑤ 其它同源 GET（图片等）→ stale-while-revalidate：先给缓存、后台悄悄更新。
 *   ⑥ 跨域请求（非遗网等外链）→ 不缓存，直接走网络；断网时由页面给兜底文案。
 *
 * 调试：在页面控制台执行 `localStorage.setItem('jangar-sw-debug','1')` 可看到策略日志。
 */

/* PRECACHE_MANIFEST 由构建脚本内联，形如 ['./index.html','./src/main.abc.js',…] */
const MANIFEST = /* __PRECACHE_MANIFEST__ */ ['./', './index.html'];
const BUILD_ID = /* __BUILD_ID__ */ 'dev';
const CACHE_VERSION = `jangar-${BUILD_ID}`;
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const RUNTIME_BUDGET = /* __RUNTIME_BUDGET__ */ 40 * 1024 * 1024;

const debug = () => {
  try { return self.localStorage ? self.localStorage.getItem('jangar-sw-debug') === '1' : false; } catch { return false; }
};
const log = (...args) => { if (debug()) console.log('[sw]', ...args); };

/** 最近一次缓存写入失败的原因。离线缓存的失败默认是静默的，
 *  留一条记录方便排查（页面控制台里 `caches.keys()` 与网络面板能对上）。 */
let lastCacheError = '';

/** 内容哈希命名的资源：URL 变了内容才变，可以永久缓存。
 *  ⚠️ 注意它与 isDetailModel 有重叠（精细档也带哈希），所以**精细模型要先判**，
 *  见 fetch 处理里的顺序说明。 */
const isImmutable = url => /\/src\/[\w.-]+\.[0-9a-f]{8,}\.js$/.test(url.pathname)
  || /\/models\/v\/[\w-]+-(preview|detail)\.[0-9a-f]{8,}\.glb(\.gz)?$/.test(url.pathname);

/** 精细档模型：体积大，只做运行时缓存 + 限额淘汰 */
const isDetailModel = url => /-detail\.[0-9a-f]+\.glb(\.gz)?$/.test(url.pathname)
  || /\/models\/[^/]+\.glb(\.gz)?$/.test(url.pathname);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    try {
      // addAll 是原子的：任何一项失败（404 / 配额不足）都会抛错，于是整体不激活。
      // 这是刻意的 —— "半套离线"比"没有离线"更危险：它会让人以为能离线，现场才发现缺东西。
      await cache.addAll(MANIFEST.map(url => new Request(url, { cache: 'reload' })));
      log('预缓存完成', MANIFEST.length, '项，版本', BUILD_ID);
    } catch (error) {
      console.warn('[sw] 预缓存失败，本次不启用离线：', error && error.message);
      await caches.delete(SHELL_CACHE);
      throw error;
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // 清掉旧版本缓存（BUILD_ID 变了说明产物变了）
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith('jangar-') && !name.startsWith(CACHE_VERSION))
      .map(name => { log('清理旧缓存', name); return caches.delete(name); }));
    await self.clients.claim();
  })());
});

/** 通知所有页面"现在离线/在线"，让界面显示相应状态（页面不主动轮询） */
async function broadcast(type) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of clients) client.postMessage({ type, buildId: BUILD_ID });
}

/** 运行时缓存限额：超出后按插入顺序淘汰（Cache API 的 keys() 即插入顺序，够用） */
async function trimRuntimeCache() {
  const cache = await caches.open(RUNTIME_CACHE);
  const keys = await cache.keys();
  let total = 0;
  const sizes = [];
  for (const request of keys) {
    const response = await cache.match(request);
    if (!response) continue;
    const length = Number(response.headers.get('content-length') || 0);
    sizes.push({ request, length });
    total += length;
  }
  if (total <= RUNTIME_BUDGET) return;
  log('运行时缓存超限，开始淘汰', (total / 1048576).toFixed(1), 'MiB');
  for (const item of sizes) {
    if (total <= RUNTIME_BUDGET) break;
    await cache.delete(item.request);
    total -= item.length;
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // 跨域不接管：外链（非遗网等）本来就该走网络，缓存它们既不合规也没必要
  if (url.origin !== self.location.origin) return;

  // ① 导航：网络优先，离线回落缓存
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('./index.html', response.clone());
        return response;
      } catch (error) {
        const cached = await caches.match('./index.html', { cacheName: SHELL_CACHE })
          || await caches.match('./', { cacheName: SHELL_CACHE });
        log('导航离线，回落缓存', !!cached);
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }

  /* ⚠️ 顺序至关重要：**精细模型必须先判**。
   * 精细模型的文件名同样带内容哈希（`<slug>-detail.<散列>.glb.gz`），
   * 所以它也满足 isImmutable —— 早先把 isImmutable 放前面，精细档就全被当成
   * "永不过期的外壳资源"塞进 shell 缓存，永不淘汰：看几尊就把站点配额吃光
   * （实测踩过：缓存分区里躺着一尊 4.8 MiB 的精细模型，而 runtime 是空的）。
   * 精细档的正确待遇是"运行时缓存 + LRU 限额"，所以它必须先被认出来。 */
  if (isDetailModel(url)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          /* 关键：**先把响应还给渲染器，缓存在后台写**。
           * 早先写成 `await cache.put(...); return response;` —— 那会让渲染器干等
           * 一次完整的"写缓存"（精细档 4.8 MiB，落盘期间 3D 一直不显示），
           * 而且 `cache.put` 只要抛错整条链就进 catch，响应被吞掉、缓存也没写成。
           * 现在：响应立刻返回，写缓存失败只记日志（离线时少一尊，但不影响当场观看）。 */
          const copy = response.clone();
          (async () => {
            try {
              const cache = await caches.open(RUNTIME_CACHE);
              await cache.put(request, copy);
              await trimRuntimeCache();
            } catch (error) {
              lastCacheError = `runtime put 失败：${error && error.message}`;
              console.warn('[sw] 精细模型写入运行时缓存失败：', error && error.message);
            }
          })();
        }
        return response;
      } catch (error) {
        const cached = await caches.match(request, { cacheName: RUNTIME_CACHE });
        if (cached) { log('精细模型离线命中缓存', url.pathname); return cached; }
        throw error;   // 让渲染器走它自己的错误分支（页面上有"重新加载"按钮）
      }
    })());
    return;
  }

  // ② 内容哈希资源（模块、首屏预览模型）：缓存优先，永不失效
  if (isImmutable(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(request, { cacheName: SHELL_CACHE })
        || await caches.match(request, { cacheName: RUNTIME_CACHE });
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(SHELL_CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })());
    return;
  }

  // ⑤ 其它同源 GET：先给缓存，后台更新（图片、图标这类）
  event.respondWith((async () => {
    const cached = await caches.match(request, { cacheName: SHELL_CACHE })
      || await caches.match(request, { cacheName: RUNTIME_CACHE });
    const network = fetch(request).then(async response => {
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(RUNTIME_CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    }).catch(() => null);
    return cached || await network || Response.error();
  })());
});

/* ---- 在线/离线状态广播：界面据此显示"离线模式 · 展示已缓存内容" ---- */
self.addEventListener('online', () => broadcast('online'));
self.addEventListener('offline', () => broadcast('offline'));

/* ---- 页面主动要求跳过等待（"立即更新"按钮用） ---- */
self.addEventListener('message', event => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
