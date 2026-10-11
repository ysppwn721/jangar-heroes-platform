/** 离线能力实测（方案 6）—— 在真实浏览器里真断网，验证"离线可看"。
 *
 * 为什么必须实测：离线相关的失败几乎全是静默的（见 scripts/check-offline.mjs 的说明）。
 * 静态校验能挡住清单断链、误收精细模型这类问题，但"Service Worker 真的接管了吗"、
 * "断网后 3D 展厅真的还在吗"只有真浏览器 + 真断网能回答。
 *
 * 四个断言：
 *   ① Service Worker 注册成功并接管页面；
 *   ② 预缓存内容真实可读（从 Cache API 里读出来，不是看日志）；
 *   ③ **断网后重新打开页面**：首页仍可访问、离线状态条出现、预览模型能加载并出图；
 *   ④ 省流量模式：不开它才请求精细模型；开了它一个精细模型都不请求。
 *
 * 用法：
 *   node scripts/preview-static.mjs --dist          # 另开一个终端
 *   node scripts/check-offline-live.cjs
 * 环境变量：TEST_URL（默认 http://127.0.0.1:4173）、PLAYWRIGHT_MODULE、BROWSER_CHANNEL、BUNDLED_CHROMIUM
 */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const fs = require('node:fs');

const base = process.env.TEST_URL || 'http://127.0.0.1:4173';
let failures = 0;
const check = (condition, message) => {
  console.log(`   ${condition ? '✅' : '❌'} ${message}`);
  if (!condition) failures++;
};
const head = title => console.log(`\n=== ${title} ===`);

(async () => {
  /* 浏览器选择顺序，每个都有理由：
   *   ① BROWSER_CHANNEL 显式指定（CI 或换浏览器时用）；
   *   ② 本机有 Edge 就用 Edge —— playwright-core 不自带浏览器，
   *      而 Edge 是 Windows 上一定存在的 Chromium 内核，省掉一次几百 MB 的下载；
   *   ③ 都没有才让 playwright-core 找它自带的 Chromium（那需要 npx playwright install chromium）。 */
  const launchOptions = { headless: true };
  if (process.env.BROWSER_CHANNEL) launchOptions.channel = process.env.BROWSER_CHANNEL;
  else if (process.platform === 'win32') launchOptions.channel = 'msedge';
  let browser;
  try {
    browser = await chromium.launch(launchOptions);
  } catch (error) {
    console.error(`❌ 无法启动浏览器（${launchOptions.channel || 'bundled chromium'}）：${error.message.split('\n')[0]}`);
    console.error('   可设 BROWSER_CHANNEL=chrome / msedge，或跑 npx playwright install chromium');
    process.exit(1);
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  /* ---------------------------------------------------------------- *
   * ⓪ 先把浏览器状态清干净
   * ---------------------------------------------------------------- */
  /* 这台浏览器用的是**持久化 profile**，上一轮跑完会留下缓存与 Service Worker 注册。
   * 不清掉的话，"首次访问才会发生的注册与预缓存"在这轮根本不发生 ——
   * 第二次运行就失败，而第一次是绿的：**不可重复的测试等于没有测试**（实测踩过）。
   * 所以每次先卸掉 SW、清掉所有缓存，再从零跑一遍完整的安装流程。 */
  head('⓪ 清空上一轮的缓存与 Service Worker（保证可重复）');
  await page.goto(base, { waitUntil: 'domcontentloaded' }).catch(() => {});
  const cleared = await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations?.() || [];
    await Promise.all(registrations.map(registration => registration.unregister()));
    const names = await caches.keys();
    await Promise.all(names.map(name => caches.delete(name)));
    return { unregistered: registrations.length, caches: names.length };
  });
  console.log(`   卸载 SW ${cleared.unregistered} 个，清空缓存分区 ${cleared.caches} 个`);
  check(await page.evaluate(async () => (await caches.keys()).length === 0), '缓存已清空（从零开始）');

  /* ---------------------------------------------------------------- *
   * ① 首次访问：Service Worker 注册并接管
   * ---------------------------------------------------------------- */
  head('① 首次访问 → Service Worker 注册与接管');
  await page.goto(base, { waitUntil: 'load' });
  // 注册发生在 load 之后，所以这里等一下；sw 激活还要再晚一点
  const registered = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready.catch(() => null);
    return {
      hasContainer: 'serviceWorker' in navigator,
      scope: registration ? registration.scope : '',
      controlling: !!navigator.serviceWorker.controller,
    };
  });
  check(registered.hasContainer, '环境支持 Service Worker');
  check(!!registered.scope, `注册成功（scope ${registered.scope}）`);
  console.log(`   controller: ${registered.controlling ? '已接管' : '尚未接管（首次访问正常，刷新后接管）'}`);

  // 首次访问时 controller 可能还是空（页面在 SW 激活前就加载完了），刷新一次即可接管
  await page.reload({ waitUntil: 'load' });
  /**
   * 等"当前生效的 Service Worker 就是刚部署的这一代"。
   *
   * 为什么必须等：Service Worker 的更新是异步的 —— 刷新后新实例才接管，
   * 而**接管前页面仍由旧实例服务**。我们真的踩过：断言读到的是旧实例写的缓存，
   * 新逻辑还没生效，看起来像"缓存没写"。
   *
   * 判断方式刻意用 `caches.keys()` 而不是 postMessage：
   * 每一代 SW 的缓存名里就带着自己的 BUILD_ID（`jangar-<buildId>-shell`），
   * 从页面直接读得到、不依赖消息通道，比问 SW 要可靠得多。
   */
  const expectedBuildId = /const BUILD_ID = "([^"]+)"/.exec(fs.readFileSync('dist/service-worker.js', 'utf8'))?.[1] || '';
  const liveBuildId = () => page.evaluate(async () => {
    const names = await caches.keys();
    const name = names.find(item => /^jangar-[0-9a-f]+-shell$/.test(item));
    return name ? name.replace(/^jangar-/, '').replace(/-shell$/, '') : '';
  });
  let activeBuild = await liveBuildId();
  for (let attempt = 0; attempt < 12 && activeBuild !== expectedBuildId; attempt++) {
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(600);
    activeBuild = await liveBuildId();
  }
  console.log(`   SW 代次：期望 ${expectedBuildId} / 生效 ${activeBuild || '(未知)'}`);
  check(!!expectedBuildId && activeBuild === expectedBuildId, '生效的 Service Worker 就是当前构建这一代');
  const afterReload = await page.evaluate(() => ({ controlling: !!navigator.serviceWorker.controller }));
  check(afterReload.controlling, '刷新后页面已被 Service Worker 接管');

  /* ---------------------------------------------------------------- *
   * ② 预缓存内容真实可读
   * ---------------------------------------------------------------- */
  head('② 预缓存内容（从 Cache API 真读一遍）');
  const cacheInfo = await page.evaluate(async () => {
    const names = await caches.keys();
    const out = { names, entries: [], models: [], bytes: 0 };
    for (const name of names) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        const length = Number(response?.headers.get('content-length') || 0);
        out.entries.push({ url: new URL(request.url).pathname, status: response?.status || 0, length });
        out.bytes += length;
        if (/-preview\.[0-9a-f]+\.glb\.gz$/.test(request.url)) out.models.push(new URL(request.url).pathname);
      }
    }
    return out;
  });
  console.log(`   缓存分区：${cacheInfo.names.join(', ')}`);
  check(cacheInfo.names.some(name => name.includes('shell')), '存在外壳缓存分区');
  check(cacheInfo.entries.length > 0, `缓存了 ${cacheInfo.entries.length} 项`);
  const badStatus = cacheInfo.entries.filter(entry => entry.status !== 200);
  check(badStatus.length === 0, badStatus.length ? `有非 200 响应被缓存：${badStatus.map(e => e.url).join(', ')}` : '缓存里的响应都是 200');
  check(cacheInfo.models.length > 0, `缓存里有预览模型 ${cacheInfo.models.length} 尊（断网可看 3D 的前提）`);
  check(cacheInfo.bytes > 1024 * 1024, `缓存体积 ${(cacheInfo.bytes / 1048576).toFixed(2)} MiB`);

  /* ---------------------------------------------------------------- *
   * 交互辅助：走真实观众路径进入 3D 展厅
   * ---------------------------------------------------------------- */
  /** 为什么要这么麻烦：自动升级精细档只在"预览档就绪 + 容器可见"时调度，
   *  只 scrollIntoView() 不会真正开始加载模型，于是测出来的"没请求精细档"是假阴性
   *  （实测踩过：第一版测试就是这么骗过自己的）。 */
  const enterViewer = async target => {
    await target.evaluate(() => document.getElementById('heroes')?.scrollIntoView({ block: 'start' }));
    await target.waitForTimeout(600);
    await target.evaluate(() => {
      const card = document.querySelector('#hero-grid .hero-card, .hero-card');
      (card?.querySelector('button:not(.save-button)') || card)?.click();
    });
    await target.waitForTimeout(400);
    await target.evaluate(() => document.getElementById('dialog-view')?.click());
  };
  const qualityOf = target => target.evaluate(() => document.getElementById('model-viewer')?.dataset.quality || '');
  const waitForQuality = async (target, wanted, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await qualityOf(target) === wanted) return true;
      await target.waitForTimeout(200);
    }
    return false;
  };
  /** 读 Service Worker 记下的"最近一次缓存写入失败"（没有就算了，不阻塞断言）。 */
  const swStatus = target => target.evaluate(() => new Promise(resolve => {
    const controller = navigator.serviceWorker?.controller;
    if (!controller) { resolve(null); return; }
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 1500);
    channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data); };
    controller.postMessage('status', [channel.port2]);
  }));

  /* ---------------------------------------------------------------- *
   * ③ 真断网：重新打开页面
   * ---------------------------------------------------------------- */
  head('③ 真断网后重新打开');
  await context.setOffline(true);
  const offlineRequests = [];
  page.on('requestfailed', request => offlineRequests.push(request.url()));
  let offlineHtml = '';
  try {
    const response = await page.goto(base, { waitUntil: 'load', timeout: 20000 });
    offlineHtml = await page.content();
    check(!!response, '断网后仍能打开页面（由 Service Worker 提供）');
  } catch (error) {
    check(false, `断网后无法打开页面：${error.message}`);
  }
  check(/宝木巴/.test(offlineHtml), '页面内容完整渲染（不是浏览器错误页）');

  const banner = await page.evaluate(() => {
    const node = document.getElementById('offline-banner');
    return { exists: !!node, hidden: node ? node.hidden : true, text: node ? node.textContent.trim() : '' };
  });
  check(banner.exists, '存在离线状态条');
  check(!banner.hidden, `断网时状态条显示（文案：${banner.text.slice(0, 24)}）`);

  // 断网状态下真的去加载 3D 模型：先进入展厅触发下载，再验证缓存能不能供上
  await enterViewer(page);
  const offlinePreview = await waitForQuality(page, 'preview', 20000);
  check(offlinePreview, offlinePreview
    ? '断网状态下 3D 展厅正常出模型（预览档）'
    : `断网状态下 3D 展厅没能出模型（档位 ${await qualityOf(page)}）`);

  const modelOffline = await page.evaluate(async () => {
    const urls = performance.getEntriesByType('resource')
      .map(entry => entry.name)
      .filter(name => /-preview\.[0-9a-f]+\.glb/.test(name));
    const first = urls[0];
    if (!first) return { tried: false };
    const response = await fetch(first);
    return { tried: true, ok: response.ok, bytes: (await response.arrayBuffer()).byteLength, url: first };
  });
  check(modelOffline.tried && modelOffline.ok, modelOffline.tried
    ? `断网后仍能取到预览模型（${(modelOffline.bytes / 1024).toFixed(0)} KiB）`
    : '页面没有请求过预览模型，无法验证（检查是否禁用了 3D）');

  const glState = await page.evaluate(async () => {
    const canvas = document.getElementById('model-canvas');
    if (!canvas) return { canvas: false };
    return {
      canvas: true,
      width: canvas.width,
      height: canvas.height,
      quality: document.getElementById('model-viewer')?.dataset.quality || '',
    };
  });
  check(glState.canvas && glState.width > 0, `画布已就绪（${glState.width}×${glState.height}，档位 ${glState.quality || '未标'}）`);

  await context.setOffline(false);

  /* ---------------------------------------------------------------- *
   * ④ 省流量模式：不请求精细模型
   * ---------------------------------------------------------------- */
  head('④ 省流量模式');
  const demoPage = await context.newPage();
  const demoRequests = [];
  demoPage.on('request', request => { if (/-detail\.[0-9a-f]+\.glb/.test(request.url())) demoRequests.push(request.url()); });
  demoPage.on('pageerror', error => console.log(`   [演示页报错] ${error.message.slice(0, 80)}`));
  /* 诊断：这一页为什么会是空的。之前出现过"开关 undefined、档位 undefined"，
   * 说明 DOM 根本没建立（导航失败或离线状态残留），而不是 demo 逻辑坏了。 */
  /* ⚠️ 这里曾经写成 `${base}/?demo=1`，而 base 本身已以 `/` 结尾 ——
   * 于是请求变成 `http://host//?demo=1`，本地静态服务器把 `//` 解析成 404，
   * 演示页拿到一个 160 字节的"Not found"，两个断言随之失败。
   * 排查时最有价值的一行是下面的"演示页 URL"输出 —— 双斜杠一眼可见。 */
  await demoPage.goto(`${base}?demo=1`, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
  const demoAtLoad = await demoPage.evaluate(() => ({
    title: document.title,
    readyState: document.readyState,
    htmlLength: document.documentElement.outerHTML.length,
    body: document.body ? document.body.textContent.trim().slice(0, 30) : '(无 body)',
    checked: document.getElementById('demo-mode')?.checked,
    hasBanner: !!document.getElementById('offline-banner'),
    search: location.search,
    frameUrl: location.href,
  }));
  console.log(`   演示页：${demoAtLoad.frameUrl}`);
  console.log(`   文档 ${demoAtLoad.readyState}，${demoAtLoad.htmlLength} 字节，body=「${demoAtLoad.body}」`);
  console.log(`   载入 ?demo=1 后：开关=${demoAtLoad.checked}，离线条=${demoAtLoad.hasBanner}，query=${demoAtLoad.search}`);
  await enterViewer(demoPage);
  const demoPreviewReady = await waitForQuality(demoPage, 'preview', 15000);
  await demoPage.waitForTimeout(3000);   // 给"本应发生的升级"留足触发时间
  const demoState = await demoPage.evaluate(() => ({
    demoOn: document.getElementById('demo-mode')?.checked ?? null,
    quality: document.getElementById('model-viewer')?.dataset.quality,
    status: document.getElementById('load-status')?.textContent,
  }));
  console.log(`   进入展厅后：开关=${demoState.demoOn}，档位=${demoState.quality}，状态=${demoState.status}`);
  check(demoPreviewReady, '省流量模式下预览档正常加载（3D 可用）');
  check(demoState.demoOn === true, 'URL 参数 ?demo=1 已让开关处于开启状态');
  check(demoRequests.length === 0, demoRequests.length ? `仍请求了精细模型：${demoRequests[0]}` : '等了 3 秒也没请求精细模型（省流量真的生效）');
  await demoPage.close();

  /* ---------------------------------------------------------------- *
   * ⑤ 正常模式：精细模型进入运行时缓存
   * ---------------------------------------------------------------- */
  head('⑤ 正常模式下的精细模型运行时缓存');
  const normalPage = await context.newPage();
  const detailRequests = [];
  normalPage.on('request', request => { if (/-detail\.[0-9a-f]+\.glb/.test(request.url())) detailRequests.push(request.url()); });
  await normalPage.goto(base, { waitUntil: 'load' });
  await enterViewer(normalPage);
  const upgraded = await waitForQuality(normalPage, 'detail', 30000);
  check(upgraded, upgraded ? '自动升级到精细档（无需手动点击）' : '未能在 30 秒内自动升级到精细档');
  check(detailRequests.length > 0, `确实请求了精细模型（${detailRequests.length} 个）`);

  /** 轮询等缓存落盘。
   *  不能"升级完立刻查"：写缓存是后台异步的，精细档 4.8 MiB 落盘要几秒，
   *  固定等 1.5 秒会得到假阴性（实测踩过 —— 报"没缓存"，其实是还没写完）。 */
  const readRuntime = () => normalPage.evaluate(async () => {
    const names = await caches.keys();
    const runtimeName = names.find(name => name.includes('runtime'));
    if (!runtimeName) return { runtimeName: '', details: [], bytes: 0 };
    const cache = await caches.open(runtimeName);
    let bytes = 0;
    const details = [];
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      const length = response ? (await response.clone().arrayBuffer()).byteLength : 0;
      bytes += length;
      if (/-detail\./.test(request.url)) details.push({ url: new URL(request.url).pathname, length });
    }
    return { runtimeName, details, bytes };
  });
  let runtime = { runtimeName: '', details: [], bytes: 0 };
  for (let attempt = 0; attempt < 20; attempt++) {
    runtime = await readRuntime();
    if (runtime.details.length > 0) break;
    await normalPage.waitForTimeout(1000);
  }
  check(runtime.runtimeName !== '', '存在运行时缓存分区');
  check(runtime.details.length > 0, runtime.details.length
    ? `精细模型已进入运行时缓存（${runtime.details.length} 尊，共 ${(runtime.bytes / 1048576).toFixed(2)} MiB）`
    : '精细模型没有进入运行时缓存（断网后这一尊就看不到了）');
  // 缓存写入失败默认是静默的，顺手读一下 SW 记下的原因（读不到不影响结论）
  const status = await swStatus(normalPage);
  if (status && status.lastCacheError) console.log(`   ⚠️ Service Worker 记录的写入失败：${status.lastCacheError}`);
  check(!status || !status.lastCacheError, status && status.lastCacheError ? `缓存写入报错：${status.lastCacheError}` : '没有缓存写入报错');
  await normalPage.close();

  head('页面错误');
  check(errors.length === 0, errors.length ? `有 ${errors.length} 条页面错误：${errors[0]}` : '没有页面错误');

  await browser.close();
  console.log(`\n=== 汇总 ===\n${failures === 0 ? '✅ 离线能力实测通过' : `❌ ${failures} 项未通过`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
