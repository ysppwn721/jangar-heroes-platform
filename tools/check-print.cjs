/**
 * 打印/PDF 场景检查：把四页各自渲染成 PDF，检查有没有内容丢失。
 *
 * 为什么单独查这个：答辩与材料评审都可能打印。若打印出来是深色底、白字丢失或大片空白，
 * 评委拿到手就是废纸。而这个风险**在屏幕上完全看不出来**——只有真打印才知道。
 *
 * 检查方式（客观、可复跑）：
 *   ① 生成 PDF，记录页数与文件体积；
 *   ② 用 DOM 侧量测替代肉眼看：注入 print 媒体查询后统计"不可见文字"比例
 *      —— 即在 print 媒体下计算 color 与 background 亮度接近的文字节点。
 *
 * 用法：node tools/check-print.cjs [baseUrl] [outDir]
 */
const fs = require('node:fs');
const path = require('node:path');
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE
  || 'C:/Users/Administrator/Desktop/互联网+/jiangger-blindbox-website/node_modules/playwright-core';
const { chromium } = require(PLAYWRIGHT);

const BASE = process.argv[2] || 'http://127.0.0.1:4183';
const OUT = path.resolve(process.argv[3] || 'test-results/print');
const PAGES = ['index.html', 'console.html', 'graph.html', 'ask.html'];

function luminance(rgb) {
  const m = String(rgb).match(/(\d+(?:\.\d+)?)/g);
  if (!m || m.length < 3) return null;
  const [r, g, b] = m.slice(0, 3).map(Number).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

(async () => {
  await fs.promises.mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: 'zh-CN' });

  const findings = [];
  console.log('打印 / PDF 场景检查');
  console.log('='.repeat(76));

  for (const page of PAGES) {
    const tab = await context.newPage();
    await tab.goto(`${BASE}/${page}`, { waitUntil: 'load' });
    await tab.waitForTimeout(page === 'index.html' ? 3000 : 1200);

    // 切到 print 媒体后再量测：这样拿到的是"打印时会生效"的样式
    await tab.emulateMedia({ media: 'print' });
    await tab.waitForTimeout(300);

    const metrics = await tab.evaluate(() => {
      const lum = (rgb) => {
        const m = String(rgb).match(/(\d+(?:\.\d+)?)/g);
        if (!m || m.length < 3) return null;
        const [r, g, b] = m.slice(0, 3).map(Number).map(v => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const seen = [];
      let total = 0;
      for (const el of document.querySelectorAll('body *')) {
        // 只看直接含文字的叶子元素
        const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 3);
        if (!hasText) continue;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.15) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        total++;
        const fg = lum(style.color);
        if (fg === null) continue;
        // 向上找第一个非透明背景
        let node = el;
        let bg = null;
        while (node && node !== document.documentElement) {
          const b = getComputedStyle(node).backgroundColor;
          const bl = lum(b);
          if (bl !== null && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(b)) { bg = bl; break; }
          node = node.parentElement;
        }
        const bodyBg = lum(getComputedStyle(document.body).backgroundColor);
        const bgL = bg === null ? (bodyBg === null ? 1 : bodyBg) : bg;
        // WCAG 对比度
        const hi = Math.max(fg, bgL), lo = Math.min(fg, bgL);
        const ratio = (hi + 0.05) / (lo + 0.05);
        if (ratio < 3) {
          seen.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className || '').toString().slice(0, 40),
            text: el.textContent.trim().slice(0, 46),
            ratio: Number(ratio.toFixed(2)),
          });
        }
      }
      return {
        total,
        lowContrast: seen.length,
        worst: seen.sort((a, b) => a.ratio - b.ratio).slice(0, 6),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        bodyColor: getComputedStyle(document.body).color,
      };
    });

    // 生成 PDF 作为留档
    const pdfPath = path.join(OUT, `${page.replace('.html', '')}.pdf`);
    await tab.pdf({ path: pdfPath, format: 'A4', printBackground: true });
    const pdfBytes = fs.statSync(pdfPath).size;

    const ok = metrics.lowContrast === 0;
    if (!ok) findings.push(`${page}: ${metrics.lowContrast} 个文字节点在打印媒体下对比度 < 3`);

    console.log(`\n${ok ? '✓' : '✗'} ${page}`);
    console.log(`    文字节点 ${metrics.total}，打印媒体下低对比度 ${metrics.lowContrast}`);
    console.log(`    body 背景 ${metrics.bodyBg} / 文字 ${metrics.bodyColor}`);
    console.log(`    PDF ${(pdfBytes / 1024).toFixed(0)} KiB → ${path.relative(process.cwd(), pdfPath)}`);
    for (const w of metrics.worst) {
      console.log(`      × [${w.ratio}] <${w.tag} class="${w.cls}"> ${w.text}`);
    }

    await tab.close();
  }

  await browser.close();
  console.log('\n' + '='.repeat(76));
  if (findings.length) {
    console.log(`✗ 打印场景存在问题（${findings.length} 页）：`);
    for (const f of findings) console.log(`   - ${f}`);
    process.exit(1);
  }
  console.log('✓ 四页在打印媒体下均无低对比度文字，且已生成 PDF 留档');
})();
