/**
 * 用真实浏览器给作品截图——参赛材料要求"作品截图 ≤10 张"，
 * 且答辩演示需要可复现的证据。这里把截图流程脚本化，避免手工截图不可复现。
 *
 * 用法：node tools/capture.cjs [baseUrl] [outDir]
 * 依赖：本机 playwright-core + 系统 Edge（Chromium 内核），不下载浏览器。
 */
const path = require('node:path');
const fs = require('node:fs/promises');

const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE
  || 'C:/Users/Administrator/Desktop/互联网+/jiangger-blindbox-website/node_modules/playwright-core';
const { chromium } = require(PLAYWRIGHT);

const BASE = process.argv[2] || 'http://127.0.0.1:4174';
const OUT = path.resolve(process.argv[3] || 'test-results/shots');

async function waitModels(page) {
  // 等到首屏模型真的画出来：canvas 有非零像素，且加载状态不再是"加载中"
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#model-canvas');
    if (!canvas || !canvas.width) return false;
    try {
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return false;
      const px = new Uint8Array(4 * 64);
      gl.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px.some(v => v > 8);
    } catch { return false; }
  }, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

const shots = [];

async function shoot(page, name, { full = false, note = '' } = {}) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: full });
  const stat = await fs.stat(file);
  shots.push({ name, note, file, bytes: stat.size, full });
  console.log(`  ✓ ${name.padEnd(38)} ${(stat.size / 1024).toFixed(0).padStart(6)} KiB  ${note}`);
}

(async () => {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  /* ── 桌面端 ── */
  const desktop = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
  });
  const page = await desktop.newPage();

  console.log('\n技术控制台 (console.html)');
  await page.goto(`${BASE}/console.html`, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await shoot(page, '01-console-hero', { note: '控制台首屏 · 技术命题' });

  await page.locator('#metrics').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shoot(page, '02-console-metrics', { note: '处理结果量化指标' });

  await page.locator('#arch').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shoot(page, '03-console-architecture', { note: '四层软件架构图' });

  await page.locator('#assets').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shoot(page, '04-console-assets', { note: '24 个资产逐条量化清单' });

  await page.locator('#cli').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shoot(page, '05-console-cli', { note: '命令行接口与设计取舍' });

  await page.locator('#constraints').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shoot(page, '06-console-constraints', { note: '运行约束与构建期断言' });

  console.log('\n知识图谱与史料溯源 (graph.html)');
  await page.goto(`${BASE}/graph.html`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  // 滚到图谱舞台，并选中一位"来源最薄弱"的节点——溯源卡与待核对标注是这个模块的卖点
  await page.locator('#graph').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shoot(page, '07-graph-overview', { note: '知识图谱总览 · 十二英雄 + 概念节点' });

  await page.evaluate(() => {
    const groups = [...document.querySelectorAll('#nodes g')];
    const target = groups.find(g => (g.querySelector('title')?.textContent || '').includes('纳钦尚胡尔'));
    if (target) target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  await shoot(page, '08-graph-provenance', { note: '节点详情 · 异名对照与溯源卡（含待核对标注）' });

  await page.locator('#sources').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shoot(page, '09-graph-sources', { note: '来源台账 · 可靠性分级' });

  await page.locator('#gaps').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shoot(page, '10-graph-gaps', { note: '已知缺口 · 显式标注未核实项' });

  console.log('\nAI 辅助叙述模块 (ask.html)');
  await page.goto(`${BASE}/ask.html`, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await shoot(page, '11-ask-hero', { note: 'AI 模块 · 界面化的使用披露' });

  // 滚到提问区，让"提问 + 回答 + 命中出处"同框
  const askBox = page.locator('.ask-box');
  await askBox.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);

  // 真的问一个问题，拿到"作答 + 命中出处 + 可核验标注"的完整证据
  await page.fill('#q', '洪古尔为什么叫雄狮英雄');
  await page.click('#send');
  await page.waitForTimeout(600);
  await askBox.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shoot(page, '12-ask-answer', { note: '作答 · 命中语料与出处公开' });

  // 再问一个站内没有的事实，展示"拒答"——这是本模块最关键的一张证据
  await page.fill('#q', '洪古尔的父亲是谁');
  await page.click('#send');
  await page.waitForTimeout(600);
  await askBox.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await shoot(page, '13-ask-refusal', { note: '拒答 · 站内未记载的事实不编造' });

  await page.locator('#probe').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shoot(page, '14-ask-probes', { note: '47 条边界测试 · 构建期门禁' });

  console.log('\n应用实例 (index.html)');
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  await waitModels(page);
  await shoot(page, '15-app-hero-3d', { note: '展馆首屏 · 真实 3D 模型' });

  // 评审入口：评委通常只打开首页，这一屏是通往工程与数据证据的门
  await page.locator('#evidence').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shoot(page, '16-app-evidence-nav', { note: '首页评审入口 · 四份证据的入口' });

  // 切一位英雄，证明不是单张静态图
  const cards = page.locator('.hero-card');
  const cardCount = await cards.count();
  if (cardCount > 1) {
    await page.locator('#heroes').scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await shoot(page, '17-app-heroes-grid', { note: `十二英雄图鉴（${cardCount} 张卡片）` });
  }

  await desktop.close();

  /* ── 移动端 ── */
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'zh-CN',
  });
  const mpage = await mobile.newPage();
  console.log('\n移动端 390×844');
  await mpage.goto(`${BASE}/console.html`, { waitUntil: 'load' });
  await mpage.waitForTimeout(700);
  await shoot(mpage, '18-console-mobile', { note: '控制台移动端适配' });

  await mpage.goto(`${BASE}/graph.html`, { waitUntil: 'load' });
  await mpage.waitForTimeout(800);
  await shoot(mpage, '19-graph-mobile', { note: '知识图谱移动端适配' });

  await mpage.goto(`${BASE}/ask.html`, { waitUntil: 'load' });
  await mpage.waitForTimeout(700);
  await shoot(mpage, '20-ask-mobile', { note: 'AI 模块移动端适配' });
  await mpage.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  await waitModels(mpage);
  await shoot(mpage, '21-app-mobile-3d', { note: '展馆移动端 · 3D 模型' });

  await mobile.close();
  await browser.close();

  const manifest = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    count: shots.length,
    totalBytes: shots.reduce((s, x) => s + x.bytes, 0),
    shots,
  };
  await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\n共 ${shots.length} 张，合计 ${(manifest.totalBytes / 1024 / 1024).toFixed(2)} MiB`);
  console.log(`清单：${path.relative(process.cwd(), path.join(OUT, 'manifest.json'))}`);
})().catch(error => {
  console.error('\n截图失败：', error.message);
  process.exit(1);
});
