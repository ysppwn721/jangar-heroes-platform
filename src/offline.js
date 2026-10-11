/**
 * 离线能力与"省流量模式"的页面侧接线（方案 6：零等待与离线可看）。
 *
 * 三件事，刻意都做成**不阻塞首屏**：
 *   ① 注册 Service Worker（等 load 之后再注册，绝不和首屏抢带宽）；
 *   ② 在线/离线状态提示：断网时顶部出现一条克制的状态条，而不是让观众对着转圈猜；
 *   ③ 省流量模式：跳过精细模型下载。答辩现场如果不确定网络，直接开它 ——
 *      轻量档已经能转能看，精细档只是锦上添花（每尊 ≈4.8 MiB）。
 *
 * 为什么"省流量模式"同时接受 URL 参数 `?demo=1`：
 * 现场演示时最可靠的是**扫码即生效**，不必先教观众去点开关。
 */

const STORAGE_KEY = 'jangar-demo-mode';

/** 省流量模式是否开启（URL 参数优先于本地记忆，方便现场切换） */
export function isDemoMode() {
  try {
    const query = new URLSearchParams(location.search);
    if (query.has('demo')) return query.get('demo') !== '0';
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDemoMode(on) {
  try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0'); } catch { /* 隐私模式下写入会失败，忽略 */ }
  document.dispatchEvent(new CustomEvent('jangar:demo-mode', { detail: { on } }));
}

/** 订阅"省流量模式"变化（渲染器用它决定要不要补下精细模型）。返回取消订阅函数。 */
export function onDemoModeChange(handler) {
  const listener = event => handler(!!(event.detail && event.detail.on));
  document.addEventListener('jangar:demo-mode', listener);
  return () => document.removeEventListener('jangar:demo-mode', listener);
}

/** 离线状态条：只在"确实离线"时显示，在线时不占任何视觉空间 */
function wireOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  const text = document.getElementById('offline-text');
  if (!banner) return;
  const sync = () => {
    const offline = navigator.onLine === false;
    banner.hidden = !offline;
    if (offline && text) text.textContent = '离线模式 · 正在展示已缓存的内容';
  };
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  // Service Worker 也会广播（覆盖"页面不知道自己在离线"的边缘情况）
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type === 'offline') sync();
    if (event.data?.type === 'online') sync();
  });
  sync();
}

/** 注册 Service Worker，并在成功后提示"离线浏览已可用" */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // 只在 https 或 localhost 下注册：其它情况浏览器本身就会拒绝，提前判断避免噪音报错
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!secure) return;
  try {
    const registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
    // 有更新时静默生效：内容会变（文案、模型），不该让观众长期看到旧版
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          installing.postMessage('skip-waiting');
        }
      });
    });
    const hint = document.getElementById('offline-hint');
    if (hint) hint.hidden = false;
  } catch (error) {
    // 离线不可用不该影响任何主功能，只记日志
    console.warn('[offline] Service Worker 注册失败：', error && error.message);
  }
}

export function initOffline() {
  wireOfflineBanner();

  const toggle = document.getElementById('demo-mode');
  if (toggle) {
    toggle.checked = isDemoMode();
    toggle.addEventListener('change', () => setDemoMode(toggle.checked));
  }

  // 注册放在 load 之后：首屏的字体、图片、模型优先，离线能力晚一步没有任何损失
  if (document.readyState === 'complete') registerServiceWorker();
  else window.addEventListener('load', registerServiceWorker, { once: true });
}
