#!/usr/bin/env node
/**
 * 离线能力静态校验（方案 6）。
 *
 * 为什么这类问题必须用静态校验挡住：离线相关的失败**几乎全都是静默的** ——
 *   · 清单里少一个文件 → 预缓存 addAll 整体失败 → 离线功能完全不生效，但页面毫无异常；
 *   · 清单里误收一尊精细模型 → 体积翻倍、可能超配额 → 同样是"看起来没事、现场才发现没缓存"；
 *   · Service Worker 作用域不对 → 注册成功但接管不到页面，一样静默。
 * 这些在浏览器里只有"主动断网试"才能发现，所以在构建期先把它们变成明确报错。
 *
 * 用法：node scripts/check-offline.cjs [--dist dist]
 * 退出码 0 = 通过；1 = 有问题（可直接接进 build 流程）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const distIndex = process.argv.indexOf('--dist');
const dist = path.resolve(root, distIndex > -1 ? process.argv[distIndex + 1] : 'dist');

let failures = 0;
let warnings = 0;
const ok = message => console.log(`   ✅ ${message}`);
const bad = message => { console.log(`   ❌ ${message}`); failures++; };
const warn = message => { console.log(`   ⚠️  ${message}`); warnings++; };
const head = title => console.log(`\n=== ${title} ===`);

if (!fs.existsSync(dist)) {
  console.error(`❌ 找不到构建产物：${dist}（先跑 npm run build）`);
  process.exit(1);
}

const swPath = path.join(dist, 'service-worker.js');
const indexPath = path.join(dist, 'index.html');
if (!fs.existsSync(swPath)) { console.error('❌ dist/service-worker.js 不存在 —— 离线能力没有发布出去'); process.exit(1); }
const sw = fs.readFileSync(swPath, 'utf8');
const html = fs.readFileSync(indexPath, 'utf8');

/* ---------------------------------------------------------------- *
 * ① 注入点是否都被替换
 * ---------------------------------------------------------------- */
head('① 构建注入');
const leftover = ['__PRECACHE_MANIFEST__', '__BUILD_ID__', '__RUNTIME_BUDGET__'].filter(token => sw.includes(token));
if (leftover.length) bad(`service-worker.js 里残留占位符：${leftover.join(', ')}（构建脚本没替换成功，离线会直接坏掉）`);
else ok('预缓存清单 / BUILD_ID / 运行时预算都已注入');

const manifestMatch = /const MANIFEST = (\[[\s\S]*?\]);/.exec(sw);
if (!manifestMatch) { bad('找不到内联的预缓存清单'); }
const manifest = manifestMatch ? JSON.parse(manifestMatch[1]) : [];
const buildId = /const BUILD_ID = "([^"]+)"/.exec(sw)?.[1] || '';

/* ---------------------------------------------------------------- *
 * ② 清单里的每个文件都要真实存在
 * ---------------------------------------------------------------- */
head('② 预缓存清单完整性');
let totalBytes = 0;
const missing = [];
const sizes = [];
for (const entry of manifest) {
  const relative = entry.replace(/^\.\//, '');
  if (!relative || relative.endsWith('/')) continue;
  const file = path.join(dist, relative);
  if (!fs.existsSync(file)) { missing.push(entry); continue; }
  const size = fs.statSync(file).size;
  totalBytes += size;
  sizes.push({ entry, size });
}
if (missing.length) bad(`清单里有 ${missing.length} 项在产物中不存在：${missing.slice(0, 6).join(', ')}（addAll 会整体失败 → 离线完全不可用）`);
else ok(`清单 ${manifest.length} 项全部存在`);
ok(`清单体积 ${(totalBytes / 1048576).toFixed(2)} MiB（BUILD_ID ${buildId}）`);

/* ---------------------------------------------------------------- *
 * ③ 不能误收精细模型：这是最贵的一类错误
 * ---------------------------------------------------------------- */
head('③ 不该进预缓存的东西');
const detailInManifest = manifest.filter(entry => /-detail\.[0-9a-f]+\.glb/.test(entry));
if (detailInManifest.length) bad(`预缓存里混进了精细模型：${detailInManifest.join(', ')}（每尊 ≈4.8 MiB，会把离线配额吃光）`);
else ok('没有精细模型被预缓存（它们应是运行时缓存）');

const swManifestSelf = manifest.filter(entry => /sw-manifest/.test(entry));
if (swManifestSelf.length) warn(`预缓存里含构建期模块：${swManifestSelf.join(', ')}（浏览器不会请求它，纯属浪费）`);
else ok('没有收录构建期专用模块');

const externals = manifest.filter(entry => /^https?:/.test(entry));
if (externals.length) bad(`预缓存里出现外部 URL：${externals.join(', ')}（外链不该被本站缓存）`);
else ok('清单里没有外部 URL');

/* ---------------------------------------------------------------- *
 * ④ 首屏模型：断了网还能不能看到 3D
 * ---------------------------------------------------------------- */
head('④ 断网时的 3D 可用性');
const previews = manifest.filter(entry => /-preview\.[0-9a-f]+\.glb(\.gz)?$/.test(entry));
if (previews.length === 0) bad('清单里没有预览档模型 —— 断网时 3D 展厅会是空的（这正是本方案要解决的问题）');
else ok(`预置 ${previews.length} 尊预览模型（断网可看）`);
const previewBytes = previews.reduce((sum, entry) => sum + (fs.existsSync(path.join(dist, entry.replace(/^\.\//, ''))) ? fs.statSync(path.join(dist, entry.replace(/^\.\//, ''))).size : 0), 0);
ok(`首屏模型共 ${(previewBytes / 1048576).toFixed(2)} MiB`);

/* ---------------------------------------------------------------- *
 * ⑤ 缓存策略是否齐全
 * ---------------------------------------------------------------- */
head('⑤ 缓存策略');
const strategies = [
  [/request\.mode === 'navigate'/, '导航请求（HTML）'],
  [/isImmutable/, '内容哈希资源 cache-first'],
  [/isDetailModel/, '精细模型运行时缓存'],
  [/trimRuntimeCache/, '运行时缓存 LRU 淘汰'],
  [/caches\.keys\(\)/, '旧版本缓存清理'],
  [/skipWaiting/, '激活后立即接管'],
  [/clients\.claim/, '接管已打开的页面'],
];
for (const [pattern, label] of strategies) {
  if (pattern.test(sw)) ok(label);
  else bad(`缺少策略：${label}`);
}
/* 判断顺序：精细模型必须排在"内容哈希资源"之前。
 * 两者都匹配带哈希的模型路径，顺序反了精细档就会被当成永不过期的外壳资源、
 * 永不淘汰（实测踩过：shell 分区里躺着一尊 4.8 MiB 精细模型，runtime 是空的）。 */
const detailAt = sw.indexOf('if (isDetailModel(url))');
const immutableAt = sw.indexOf('if (isImmutable(url))');
if (detailAt === -1 || immutableAt === -1) bad('找不到精细模型 / 内容哈希资源的分支');
else if (detailAt < immutableAt) ok('精细模型分支排在内容哈希分支之前（否则精细档永不淘汰）');
else bad('精细模型分支排在内容哈希分支之后 —— 精细档会被永久缓存、吃光站点配额');
if (/caches\.delete\(SHELL_CACHE\)/.test(sw)) ok('预缓存失败时清理半套缓存（避免"以为能离线"）');
else bad('预缓存失败后没有清理半套缓存');
if (/url\.origin !== self\.location\.origin[^\n]*return/.test(sw)) ok('跨域请求不接管（外链走网络）');
else warn('没有显式的跨域判断，可能把外链也纳入缓存');

/* ---------------------------------------------------------------- *
 * ⑥ 页面侧接线
 * ---------------------------------------------------------------- */
head('⑥ 页面接线');
const offlineModule = fs.readdirSync(path.join(dist, 'src')).find(name => name.startsWith('offline.') && name.endsWith('.js'));
if (offlineModule) ok(`离线模块已发布（src/${offlineModule}）`);
else bad('src/offline.js 没有被构建发布 —— 页面侧不会注册 Service Worker');

if (offlineModule) {
  const offlineJs = fs.readFileSync(path.join(dist, 'src', offlineModule), 'utf8');
  if (/serviceWorker\.register\(/.test(offlineJs)) ok('页面会注册 Service Worker');
  else bad('离线模块里没有注册调用');
  if (/readyState === 'complete'/.test(offlineJs)) ok('注册延后到 load 之后（不抢首屏带宽）');
  else warn('注册时机不确定，可能影响首屏');
  if (/navigator\.onLine/.test(offlineJs)) ok('使用 navigator.onLine 判断在线状态');
  else bad('没有在线/离线判断，状态条无法工作');
  if (/'https:'/.test(offlineJs) || /https:/.test(offlineJs)) ok('只在不安全协议之外注册（避免无意义的报错）');
  else warn('没有协议判断');
}

const banner = /id="offline-banner"/.test(html);
banner ? ok('首页有离线状态条容器') : bad('首页缺少离线状态条容器');
const demoSwitch = /id="demo-mode"/.test(html);
demoSwitch ? ok('首页有省流量模式开关') : bad('首页缺少省流量模式开关');
if (/navigator\.onLine === false/.test(html)) bad('HTML 里有内联的在线判断（应在模块里）');

/* ---------------------------------------------------------------- *
 * ⑦ 预算
 * ---------------------------------------------------------------- */
head('⑦ 预算');
const budgetMatch = /export const PRECACHE_BUDGET = (\d+) \* 1024 \* 1024/.exec(fs.readFileSync(path.join(root, 'src', 'sw-manifest.js'), 'utf8'));
const budget = budgetMatch ? Number(budgetMatch[1]) * 1048576 : 12 * 1048576;
if (totalBytes > budget) bad(`预缓存 ${(totalBytes / 1048576).toFixed(2)} MiB 超过预算 ${(budget / 1048576).toFixed(0)} MiB`);
else ok(`预缓存 ${(totalBytes / 1048576).toFixed(2)} MiB / ${(budget / 1048576).toFixed(0)} MiB`);
const runtimeBudget = /const RUNTIME_BUDGET = (\d+)/.exec(sw)?.[1];
runtimeBudget ? ok(`运行时缓存预算 ${(Number(runtimeBudget) / 1048576).toFixed(0)} MiB`) : bad('没有运行时缓存预算（精细模型会无限堆积）');

/* ---------------------------------------------------------------- *
 * 汇总
 * ---------------------------------------------------------------- */
console.log(`\n=== 汇总 ===`);
if (failures === 0) {
  console.log(`✅ 离线能力检查通过（${warnings} 条提醒）`);
  console.log('   下一步的实测必须在真实浏览器里做：node scripts/check-offline-live.cjs');
  process.exit(0);
}
console.log(`❌ ${failures} 项未通过`);
process.exit(1);
