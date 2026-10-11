/**
 * 交付产物验收：对构建后的 dist/ 做端到端检查。
 *
 * 这不是"再跑一遍单元测试"，而是模拟评委打开站点的真实路径：
 * 逐个请求四个页面 → 检查页面引用的静态资源都能 200 →
 * 用真实浏览器打开每一页、捕获控制台错误与失败请求 →
 * 在 ask.html 上真的问一个问题，确认模块化脚本与数据文件在生产构建里能加载。
 *
 * 用法：node tools/verify-dist.cjs [baseUrl]
 */
const path = require('node:path');
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE
  || 'C:/Users/Administrator/Desktop/互联网+/jiangger-blindbox-website/node_modules/playwright-core';
const { chromium } = require(PLAYWRIGHT);

const BASE = process.argv[2] || 'http://127.0.0.1:4175';
const PAGES = ['index.html', 'console.html', 'graph.html', 'ask.html'];

async function fetchStatus(url) {
  const res = await fetch(url);
  return { status: res.status, bytes: (await res.arrayBuffer()).byteLength };
}

(async () => {
  const failures = [];
  const notes = [];

  console.log('交付产物验收');
  console.log('='.repeat(74));
  console.log(`目标：${BASE}\n`);

  /* ① 四个页面可访问 */
  console.log('① 页面可访问性');
  const html = {};
  for (const page of PAGES) {
    try {
      const res = await fetch(`${BASE}/${page}`);
      const text = await res.text();
      html[page] = text;
      const ok = res.status === 200 && text.length > 1000;
      console.log(`  ${ok ? '✓' : '✗'} ${page.padEnd(15)} ${res.status}  ${text.length} 字符`);
      if (!ok) failures.push(`${page} 不可访问或内容过短`);
    } catch (error) {
      console.log(`  ✗ ${page.padEnd(15)} ${error.message}`);
      failures.push(`${page} 请求失败：${error.message}`);
    }
  }

  /* ② 页面内引用的本地资源必须全部能取到 */
  console.log('\n② 页面内引用资源');
  const referenced = new Set();
  for (const [page, text] of Object.entries(html)) {
    for (const m of text.matchAll(/(?:src|href)="\.\/([^"#?]+)"/g)) referenced.add(m[1]);
  }
  let assetOk = 0;
  for (const ref of [...referenced].sort()) {
    try {
      const res = await fetch(`${BASE}/${ref}`);
      if (res.status === 200) assetOk++;
      else { failures.push(`资源 ${ref} 返回 ${res.status}`); console.log(`  ✗ ${ref} → ${res.status}`); }
    } catch (error) {
      failures.push(`资源 ${ref} 请求失败`);
      console.log(`  ✗ ${ref} → ${error.message}`);
    }
  }
  console.log(`  ✓ ${assetOk} / ${referenced.size} 个引用资源可访问`);

  /* ③ 真实浏览器打开每一页，捕获控制台错误与失败请求 */
  console.log('\n③ 浏览器运行时（控制台错误 / 失败请求）');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });

  for (const page of PAGES) {
    const tab = await context.newPage();
    const consoleErrors = [];
    const failedRequests = [];
    tab.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    tab.on('requestfailed', r => failedRequests.push(`${r.url()} — ${r.failure()?.errorText}`));
    tab.on('response', r => { if (r.status() >= 400) failedRequests.push(`${r.url()} — HTTP ${r.status()}`); });

    await tab.goto(`${BASE}/${page}`, { waitUntil: 'load' });
    await tab.waitForTimeout(page === 'index.html' ? 3500 : 1200);

    // 页面必须有可见正文
    const textLength = (await tab.evaluate(() => document.body.innerText.trim().length));
    const realErrors = consoleErrors.filter(t => !/favicon|net::ERR_ABORTED/i.test(t));
    const realFailed = failedRequests.filter(u => !/favicon/i.test(u));

    const ok = realErrors.length === 0 && realFailed.length === 0 && textLength > 200;
    console.log(`  ${ok ? '✓' : '✗'} ${page.padEnd(15)} 正文 ${String(textLength).padStart(5)} 字符  ` +
      `错误 ${realErrors.length}  失败请求 ${realFailed.length}`);
    if (realErrors.length) {
      failures.push(`${page} 控制台错误：${realErrors[0].slice(0, 160)}`);
      realErrors.slice(0, 3).forEach(e => console.log(`      × ${e.slice(0, 150)}`));
    }
    if (realFailed.length) {
      failures.push(`${page} 失败请求：${realFailed[0].slice(0, 160)}`);
      realFailed.slice(0, 5).forEach(u => console.log(`      × ${u.slice(0, 150)}`));
    }
    if (textLength <= 200) failures.push(`${page} 正文过短（${textLength} 字符），可能未渲染`);

    /* ④ 在 ask.html 上真的问一次，验证模块脚本与语料在生产构建里可用 */
    if (page === 'ask.html') {
      console.log('\n④ AI 叙述模块功能验证（生产构建）');
      await tab.fill('#q', '洪古尔为什么叫雄狮英雄');
      await tab.click('#send');
      await tab.waitForTimeout(900);
      const answerText = await tab.evaluate(() => {
        const first = document.querySelector('.turn');
        return first ? first.innerText.slice(0, 300) : '';
      });
      const answered = /依据充足/.test(await tab.evaluate(() => document.body.innerText));
      const hasHits = /实际命中的语料段落/.test(answerText) || /实际命中的语料段落/.test(await tab.evaluate(() => document.body.innerText));
      console.log(`  ${answered ? '✓' : '✗'} 问答返回「依据充足」`);
      console.log(`  ${hasHits ? '✓' : '✗'} 展示了命中的语料段落`);
      if (!answered) failures.push('ask.html 生产构建下未能作答（模块化脚本或语料未加载）');
      if (!hasHits) failures.push('ask.html 未展示命中语料，可核验性缺失');
      notes.push(`ask.html 回答片段：${answerText.replace(/\s+/g, ' ').slice(0, 120)}…`);
    }
    await tab.close();
  }

  /* ⑤ 首页必须能走到其它三页 */
  console.log('\n⑤ 首页入口可达性');
  const indexHtml = html['index.html'] || '';
  for (const page of PAGES.filter(p => p !== 'index.html')) {
    const ok = indexHtml.includes(page);
    console.log(`  ${ok ? '✓' : '✗'} index.html → ${page}`);
    if (!ok) failures.push(`index.html 未链接 ${page}`);
  }

  await browser.close();

  console.log('\n' + '='.repeat(74));
  if (failures.length) {
    console.log(`✗ 验收失败 ${failures.length} 项：`);
    for (const f of failures) console.log(`   - ${f}`);
    process.exit(1);
  }
  console.log('✓ 全部通过：四页可访问、资源完整、运行时无错误、入口可达、AI 模块可用');
  for (const n of notes) console.log(`  · ${n}`);
})().catch(error => {
  console.error('验收脚本异常：', error);
  process.exit(1);
});
