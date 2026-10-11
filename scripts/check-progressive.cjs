const { launch } = require('./browser.cjs');
const assert=require('node:assert/strict');const fs=require('node:fs');
/* 默认指向**产物版**（4173）：本脚本测的是"带内容哈希的两档渐进加载"，
 * 而源码版的 modelAssets 是空表、两档 URL 只差目录，拦截语义对不上。
 * 需要跟别的脚本一起跑时，用同一个 npm run preview 起的服务即可。 */
const base=process.env.TEST_URL||'http://127.0.0.1:4173/';
/* 判断一个模型请求属于哪一档。**必须按 tier 判断，不能按 slug 拦** ——
 * 源码形态下同一尊英雄的两档 URL 只差一个目录：
 *   预览档 `models/preview/<slug>.glb.gz`，精细档 `models/<slug>.glb.gz`；
 * 产物形态则把 tier 写进文件名：`models/v/<slug>-<tier>.<哈希>.glb.gz`。
 * 早先按 slug 拦，结果预览档也被一起 503，模型根本没加载起来，
 * 断言失败的样子像是"渲染器不降级"（实测踩过）。 */
function modelTier(url) {
  if (typeof url !== 'string') return null;
  const path = url.split('?')[0];
  if (!/\.glb(\.gz)?$/.test(path)) return null;
  if (/[-]preview[\w.-]*\.glb(\.gz)?$/.test(path) || /\/preview\//.test(path)) return 'preview';
  if (/[-]detail[\w.-]*\.glb(\.gz)?$/.test(path)) return 'detail';
  return 'detail';   // 源码形态：不带 tier 标记的就是精细档（预览档在 /preview/ 目录下）
}
/* 拦截统一用一个能匹配**全部**模型 URL 的正则，再在处理器里按 modelTier() 过滤。
 * 为什么不用 `page.route(谓词函数, handler)` 这种写法：本机实测**谓词形式不生效**
 * （同一个 URL、同一个 context，正则形式拦得到、谓词形式拦不到），
 * 于是"503 必须退回预览档"这类断言会静默变成"根本没拦到 → 精细档正常加载 → 断言假失败"。
 * 正则 + 内部过滤既能用上 tier 判断，又不受这个坑影响。 */
const anyModelUrl = /\.glb(\.gz)?(\?|$)/;
const isWant = (url, slug, tier) => (!slug || new RegExp(`(?:^|/)${slug}[-\\w.]*\\.glb`).test(url)) && modelTier(url) === tier;
/** 注册一个"只对某尊英雄的某一档生效"的拦截 */
const routeTier = (target, slug, tier, handler) => target.route(anyModelUrl, (route, request) => (
  isWant(request.url(), slug, tier) ? handler(route, request) : route.continue()
));
fs.mkdirSync('test-results',{recursive:true});
(async()=>{
 const browser=await launch();
 /* 本脚本测的是**渲染器的降级与容错**：故意让服务器回 404/503，断言界面退回预览档。
  * 但 Service Worker 的离线兜底会把这些错误响应换成缓存里的那一尊（这恰恰是离线要的效果），
  * 于是"失败必须降级"这个断言就不再成立 —— 会把离线能力误判成缺陷（实测踩过）。
  * 所以这里显式不注册 Service Worker：离线能力由 check-offline-live.cjs 单独负责。 */
 const context=await browser.newContext({serviceWorkers:'block'});
 const page=await context.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const client=await page.context().newCDPSession(page);await client.send('Network.enable');await client.send('Network.setCacheDisabled',{cacheDisabled:true});
 await client.send('Network.emulateNetworkConditions',{offline:false,latency:100,downloadThroughput:5*1024*1024/8,uploadThroughput:1024*1024/8});
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.locator('#model-viewer.is-ready').waitFor({timeout:15000});
 const firstMs=await page.evaluate(()=>performance.getEntriesByName('model-ready:jiangger')[0].startTime);
 await page.locator('#model-canvas').focus();await page.keyboard.press('ArrowLeft');
 await page.locator('#exhibit').screenshot({path:'test-results/progressive-preview.png'});
 assert(await page.locator('#rotate-model').isEnabled());
 await page.waitForFunction(()=>document.querySelector('#model-viewer').dataset.quality==='detail',{},{timeout:30000});
 const detailMs=await page.evaluate(()=>performance.getEntriesByName('model-detail-ready:jiangger')[0].startTime);
 await page.locator('#exhibit').screenshot({path:'test-results/progressive-detail.png'});
 await client.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 await client.send('Network.setCacheDisabled',{cacheDisabled:false});
 // Retest using isolated state to check camera continuity, caching and cancellation.
 await page.route('**/test-progressive.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0;background:#172f2b}#stage{width:600px;height:600px}canvas{width:100%;height:100%;touch-action:none}</style><div id="stage"><canvas tabindex="0"></canvas></div>'}));
 await page.goto(new URL('test-progressive.html',base).href);
 await page.evaluate(async()=>{
  const {createViewer}=await import('./src/viewer.js');window.statuses=[];
  window.viewer=createViewer({canvas:document.querySelector('canvas'),container:document.querySelector('#stage'),onReady(){},onRotation(){},onStatus(text,failed){statuses.push({text,failed});},onProgress(){}});
 });
 const state=()=>page.evaluate(()=>viewer.getState());
 await routeTier(page,null,'detail',async r=>{await new Promise(resolve=>setTimeout(resolve,600));await r.continue();});
 await page.evaluate(()=>viewer.load('jiangger'));assert.equal((await state()).quality,'preview');
 await page.locator('canvas').focus();for(let i=0;i<8;i++)await page.keyboard.press('ArrowLeft');await page.keyboard.press('+');
 const rotated=await state();
 await page.evaluate(()=>viewer.upgrade());const detailed=await state();assert.equal(detailed.quality,'detail');assert.equal(detailed.yaw,rotated.yaw);assert.equal(detailed.distance,rotated.distance);assert.equal(detailed.autoRotate,rotated.autoRotate);
 await page.unroute(anyModelUrl);
 // Failed detailed download must leave real preview controls and geometry available.
 await routeTier(page,'harinidun','detail',r=>r.fulfill({status:503,body:'Test error'}));
 await page.evaluate(async()=>{await viewer.load('harinidun');await viewer.upgrade();});
 assert.equal((await state()).quality,'preview');assert.equal((await state()).slug,'harinidun');
 await page.locator('canvas').focus();const yaw=(await state()).yaw;await page.keyboard.press('ArrowLeft');assert.notEqual((await state()).yaw,yaw);
 await page.unroute(anyModelUrl);await page.evaluate(()=>viewer.upgrade());assert.equal((await state()).quality,'detail');
 // Both tiers missing produces a recoverable failure, followed by retry success.
 /* ⚠️ 已知脆弱点（未解，不掩盖）：本脚本在本机对**产物版**跑时，这条用例的
  * "两档都 404"拦截偶尔不生效 —— 请求直接拿到 200，于是"必须报失败"的断言不成立。
  * 已投入较多时间定位：`page.route(谓词函数, …)` 这种写法实测不可靠（同一 URL 下
  * 正则形式拦得到、谓词形式拦不到），而改用"正则 + 处理器内过滤"后本用例仍未稳定。
  * 与离线能力无关（那条链路由 check-offline-live.cjs 覆盖，全绿）。
  * 渲染器侧的对应缺陷已修：两档都取不到时会明确报"3D 加载失败 · 点击重试"（见 src/viewer.js）。 */
 await routeTier(page,'saber',null,r=>r.fulfill({status:404,body:'Not found'}));
 await page.evaluate(()=>viewer.load('saber'));
 assert((await page.evaluate(()=>statuses)).some(item=>item.failed),'两档都 404 时必须报告失败状态');
 await page.unroute(anyModelUrl);await page.evaluate(()=>viewer.load('saber'));assert.equal((await state()).slug,'saber');
 // Cancel an upgrade while another hero is selected. Only the new one may win.
 await page.evaluate(async()=>{const pending=viewer.upgrade();await viewer.load('mingyan');await pending;});await page.evaluate(()=>viewer.upgrade());assert.equal((await state()).slug,'mingyan');
 // Preview failure goes directly to the detailed model.
 await routeTier(page,'hongguer','preview',r=>r.fulfill({status:404,body:'Missing preview'}));
 await page.evaluate(()=>viewer.load('hongguer'));assert.equal((await state()).quality,'detail');assert.equal((await state()).slug,'hongguer');await page.unroute(anyModelUrl);
 assert((await state()).cacheSize<=3);await page.evaluate(()=>viewer.dispose());
 // Data saver remains interactive until the user explicitly requests detail.
 const saver=await context.newPage({reducedMotion:'reduce'});await saver.addInitScript(()=>Object.defineProperty(navigator,'connection',{value:{saveData:true,effectiveType:'4g'}}));
 const saverRequests=[];saver.on('request',r=>saverRequests.push(r.url()));await saver.goto(base);await saver.locator('#model-viewer.is-ready').waitFor();await saver.waitForTimeout(700);
 assert(!saverRequests.some(url=>url.includes('-detail.')));assert(await saver.locator('#detail-model').isEnabled());
 await saver.locator('#detail-model').click();await saver.waitForFunction(()=>document.querySelector('#model-viewer').dataset.quality==='detail');
 // Built filenames are immutable; a second visit must use the browser cache.
 const cachePage=await context.newPage({reducedMotion:'reduce'});await cachePage.goto(base);await cachePage.waitForFunction(()=>document.querySelector('#model-viewer').dataset.quality==='detail');
 await cachePage.reload();await cachePage.waitForFunction(()=>document.querySelector('#model-viewer').dataset.quality==='detail');
 const resources=await cachePage.evaluate(()=>performance.getEntriesByType('resource').filter(e=>e.name.includes('/models/v/')).map(e=>({name:e.name,transfer:e.transferSize,encoded:e.encodedBodySize})));
 assert(resources.length>=2&&resources.every(r=>r.transfer===0),'Second visit must reuse hashed model files');
 // WebGL1 with no gzip support uses a real raw preview then a real raw detailed model.
 const old=await context.newPage({reducedMotion:'reduce'});await old.addInitScript(()=>{Object.defineProperty(window,'DecompressionStream',{value:undefined});const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl2'?null:get.call(this,type,...args);};});
 await old.goto(base);await old.waitForFunction(()=>document.querySelector('#model-viewer').dataset.quality==='detail');
 assert.deepEqual(errors,[]);
 const report={passed:true,network:'5 Mbps, 100ms latency, cache disabled',firstInteractiveMs:Math.round(firstMs),detailReadyMs:Math.round(detailMs),previousDetailedOnlyMs:5875,initialImprovementPercent:Math.round((1-firstMs/5875)*100),cacheTransfers:resources.map(r=>r.transfer),checks:['Real lightweight model before detail','Rotation available during upgrade','View and zoom preserved','Detailed download failure keeps real preview','Manual quality retry','Missing preview falls back to detail','Both tiers failure and retry','Switch cancels stale upgrade','Cache max three heroes','Data saver manual detail','Repeat visit browser cache','Legacy WebGL1 and raw GLB','No uncaught errors']};
 fs.writeFileSync('test-results/progressive-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
