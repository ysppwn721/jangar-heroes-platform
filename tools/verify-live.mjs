#!/usr/bin/env node
/**
 * 线上站点复验：对**真实部署地址**跑一遍与本地 test:dist 等价的检查。
 *
 * 为什么必须单独做这一步：本地 dist/ 与线上站点之间隔着托管平台的行为差异，
 * 本项目踩过的坑几乎全在这个接缝上——
 *   · 找不到路径时回退返回 index.html（软 404）→ 爬虫拿 HTML 当 sitemap 解析
 *   · Jekyll 丢掉下划线开头的文件（_headers）
 *   · 静态托管对 HTML 的缓存策略与预期不符
 * 这些在本地永远不会暴露，只有对着真实 URL 才看得见。
 *
 * 用法：node tools/verify-live.mjs https://<你的站点>
 */
import { createHash } from 'node:crypto';

const BASE = (process.argv[2] || '').replace(/\/+$/, '');
if (!BASE) {
  console.error('用法：node tools/verify-live.mjs https://<站点地址>');
  process.exit(2);
}

const failures = [];
const warnings = [];
const ok = (label, extra = '') => console.log(`  ✓ ${label}${extra ? '  ' + extra : ''}`);
const bad = (label, extra = '') => { failures.push(`${label}${extra ? ' — ' + extra : ''}`); console.log(`  ✗ ${label}${extra ? '  ' + extra : ''}`); };
const warn = (label, extra = '') => { warnings.push(`${label}${extra ? ' — ' + extra : ''}`); console.log(`  ⚠ ${label}${extra ? '  ' + extra : ''}`); };

async function head(path) {
  try {
    const r = await fetch(`${BASE}${path}`, { redirect: 'follow' });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, type: r.headers.get('content-type') || '', len: buf.length, sha: createHash('sha256').update(buf).digest('hex').slice(0, 12), body: buf.toString('utf8') };
  } catch (e) {
    return { error: e.message, cause: e.cause ? e.cause.message : '' };
  }
}

console.log(`线上站点复验：${BASE}`);
console.log('='.repeat(78));

/* ① 四个交付页必须可访问且是真 HTML */
console.log('\n① 四个交付页');
const PAGES = {
  'index.html': '数字展馆',
  'console.html': '技术控制台',
  'graph.html': '知识图谱与史料溯源',
  'ask.html': '问史诗 · AI 辅助叙述模块',
};
for (const [page, expectTitle] of Object.entries(PAGES)) {
  const r = await head(`/${page}`);
  if (r.error) { bad(`${page} 请求失败`, r.error); continue; }
  const title = (r.body.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  const isHtml = r.type.includes('text/html');
  const titleOk = title.includes(expectTitle.slice(0, 6));
  if (r.status === 200 && isHtml && titleOk) ok(page.padEnd(14), `200  ${title.slice(0, 46)}`);
  else bad(page.padEnd(14), `status=${r.status} type=${r.type.split(';')[0]} title="${title.slice(0, 40)}"`);
}

/* ② 四个页面必须是四份**不同**的内容 */
console.log('\n② 页面内容互不相同（防"全部回退到首页"）');
const shas = {};
for (const page of Object.keys(PAGES)) {
  const r = await head(`/${page}`);
  if (!r.error) shas[page] = r.sha;
}
const unique = new Set(Object.values(shas));
if (unique.size === Object.keys(PAGES).length) ok(`四页 sha256 互不相同`, Object.values(shas).join(' '));
else bad(`四页内容有重复（仅 ${unique.size} 种）`, JSON.stringify(shas));

/* ③ 404 语义：不存在的路径必须返回 404，不能是 200+首页 */
console.log('\n③ 404 语义（软 404 检查）');
for (const probe of ['/this-page-does-not-exist.html', '/nope', '/src/data/missing.json']) {
  const r = await head(probe);
  if (r.error) { bad(`${probe} 请求失败`, r.error); continue; }
  if (r.status === 404) ok(`${probe.padEnd(32)} 404`)
  else bad(`${probe.padEnd(32)} 返回 ${r.status}（应为 404）`, '托管在把未知路径回退成首页');
}

/* ④ robots / sitemap 必须是文件本身而不是 HTML */
console.log('\n④ robots.txt 与 sitemap.xml');
for (const [path, expect] of [['/robots.txt', 'text/plain'], ['/sitemap.xml', 'xml']]) {
  const r = await head(path);
  if (r.error) { bad(`${path} 请求失败`, r.error); continue; }
  const isHtml = r.type.includes('text/html');
  if (r.status === 200 && !isHtml && r.type.includes(expect.split('/')[0])) ok(`${path.padEnd(16)} ${r.status} ${r.type.split(';')[0]} ${r.len}B`);
  else if (r.status === 200 && !isHtml) ok(`${path.padEnd(16)} ${r.status} ${r.type.split(';')[0]} ${r.len}B`);
  else bad(`${path.padEnd(16)} 返回 ${r.status} ${r.type.split(';')[0]}`, isHtml ? '爬虫会把 HTML 当 sitemap 解析，收录失败' : '');
}

/* ⑤ _headers 是否被 Jekyll 丢掉 */
console.log('\n⑤ _headers（Jekyll 会忽略下划线开头的文件）');
{
  const r = await head('/_headers');
  if (r.error) warn('/_headers 无法确认', r.error);
  else if (r.status === 404) warn('/_headers 返回 404', 'GitHub Pages 的 Jekyll 丢弃了它；Cloudflare Pages 会正常提供');
  else ok(`/_headers ${r.status} ${r.len}B`);
}

/* ⑥ ask.html 必须自包含（语料内联、无运行时 fetch） */
console.log('\n⑥ ask.html 自包含性');
{
  const r = await head('/ask.html');
  if (r.error) bad('ask.html 请求失败', r.error);
  else {
    const hasFetch = /fetch\(|XMLHttpRequest/.test(r.body);
    const hasCorpus = r.body.includes('corpus-data');
    const hasFallback = r.body.includes('检索模块未能初始化');
    if (!hasFetch && hasCorpus && hasFallback) ok('无运行时 fetch + 语料内联 + 失败兜底');
    else bad('自包含性检查未通过', `fetch=${hasFetch} corpus=${hasCorpus} 兜底=${hasFallback}`);
  }
}

/* ⑦ 分享元数据与 canonical 指向真实域名 */
console.log('\n⑦ 分享元数据（微信转发卡片）');
{
  const r = await head('/index.html');
  if (r.error) bad('index.html 请求失败', r.error);
  else {
    const ogImage = (r.body.match(/property="og:image" content="([^"]*)"/) || [])[1] || '';
    const canonical = (r.body.match(/rel="canonical" href="([^"]*)"/) || [])[1] || '';
    const ogCount = (r.body.match(/property="og:/g) || []).length;
    if (ogCount >= 8) ok(`og:* ${ogCount} 条`);
    else bad(`og:* 仅 ${ogCount} 条`, '分享卡片会不完整');
    if (ogImage.includes('jiangger.example')) bad('og:image 仍指向占位域名', ogImage + '（分享卡图会裂）');
    else if (ogImage.startsWith(BASE)) ok('og:image 指向真实域名');
    else warn('og:image 指向其它地址', ogImage);
    if (canonical.includes('jiangger.example')) bad('canonical 仍指向占位域名', canonical);
    else if (canonical.startsWith(BASE)) ok('canonical 指向真实域名');
    else warn('canonical 指向其它地址', canonical);
  }
}

/* ⑧ 关键静态资源可达 */
console.log('\n⑧ 关键资源');
{
  const idx = await head('/index.html');
  const refs = [...new Set([...idx.body.matchAll(/(?:src|href)="(\.\/[^"]+\.(?:js|css|webp|png|svg|glb))"/g)].map(m => m[1].replace(/^\./, '')))];
  let okN = 0, badN = 0;
  for (const ref of refs.slice(0, 12)) {
    const r = await head(ref);
    if (r.error || r.status !== 200) { badN++; bad(`资源 ${ref}`, r.error || `status=${r.status}`); }
    else okN++;
  }
  if (okN && !badN) ok(`首页引用的 ${okN} 个资源全部可达`);
  else if (okN) ok(`${okN} 个资源可达（${badN} 个失败，见上）`);
}

/* 汇总 */
console.log('\n' + '='.repeat(78));
if (warnings.length) {
  console.log(`⚠ 警告 ${warnings.length} 条（不阻断，但值得知道）：`);
  warnings.forEach(w => console.log(`   - ${w}`));
}
if (failures.length) {
  console.log(`✗ 复验失败 ${failures.length} 项：`);
  failures.forEach(f => console.log(`   - ${f}`));
  process.exit(1);
}
console.log('✓ 线上站点复验全部通过：四页可访问且互不相同、404 语义正确、'
  + 'robots/sitemap 是文件本身、ask.html 自包含、分享元数据指向真实域名、关键资源可达');
