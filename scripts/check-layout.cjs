#!/usr/bin/env node
/**
 * 排版与可读性校验：水平溢出、文本重叠、WCAG AA 对比度。
 *
 * 为什么要单独一个检查（而不是只靠人眼看截图）：
 *   · 本站曾把全站的对比度问题从 74 处修到 0，**这是宝贵的既有状态**，
 *     新加内容时最容易悄悄退回去（本次新增"版本对照"一节就出现了 8 处未达标）；
 *   · "刚够不到"的失败（4.43:1、4.49:1）肉眼完全看不出来，只有量才知道；
 *   · 窄屏的水平溢出在桌面浏览器里永远发现不了。
 *
 * 三条都刻意做了**假阳性过滤**（不加过滤会淹没真问题，实测过）：
 *   · 跳过隐藏元素 —— 窄屏会 display:none 掉表格头，不跳过就会量出"看不见的文字对比度不足"；
 *   · 对比度只测"叶子节点"，避免父子重复计数；
 *   · 重叠只在**同一父容器**的同级之间检测 —— 相邻并排的 span（如"勇气 COURAGE"）
 *     与 `<b><br>` 这类同容器换行，矩形会重叠但并没有压字。
 *
 * 用法：
 *   node scripts/check-layout.mjs                    # 默认测 http://127.0.0.1:4173/
 *   TEST_URL=... node scripts/check-layout.mjs
 *   node scripts/check-layout.mjs '#versions'        # 只测某一节
 */
const { launch } = require('./browser.cjs');

const base = process.env.TEST_URL || 'http://127.0.0.1:4173/';
const selector = process.argv.slice(2).find(arg => !arg.startsWith('-'));
const SECTIONS = ['#home', '#heroes', '#epic', '#versions', '#stories', '#living-epic', '#motifs', '#craft', '#discover'];
const VIEWPORTS = [['桌面 1440', 1440, 1000], ['平板 900', 900, 1000], ['手机 390', 390, 844]];

let failures = 0;
const ok = message => console.log(`   ✅ ${message}`);
const bad = message => { console.log(`   ❌ ${message}`); failures++; };

const toRgb = value => (String(value).match(/\d+/g) || []).slice(0, 3).map(Number);
/** 背景不含渐变/图片时才算得出对比度。
 *  压在图片或渐变遮罩上的文字（如首页说明文字）**无法用计算样式可靠测量**：
 *  取到的是半透明色，真实底色取决于图片像素。这类元素一律跳过并计数，
 *  交给项目自带的 scripts/audit-visual.cjs（它会真实取像素）去判断 ——
 *  否则这里会稳定虚报失败，"狼来了"几次之后这个检查就没人看了（实测踩过）。 */
const measurableBg = node => {
  let current = node;
  while (current) {
    const style = getComputedStyle(current);
    if (style.backgroundImage && style.backgroundImage !== 'none') return false;
    const bg = style.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return true;
    current = current.parentElement;
  }
  return true;
};
const luminance = rgb => {
  const [r, g, b] = rgb.map(value => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (fg, bg) => {
  const a = luminance(toRgb(fg)), b = luminance(toRgb(bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

/** 在页面里量一节：溢出、叶子文本、同级重叠 */
const measure = (sel) => {
  const root = document.querySelector(sel);
  if (!root) return null;
  const docWidth = document.documentElement.clientWidth;
  const visible = node => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width >= 1 && rect.height >= 1;
  };
  const effectiveBg = node => {
    let current = node;
    while (current) {
      const bg = getComputedStyle(current).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
      current = current.parentElement;
    }
    return 'rgb(255, 255, 255)';
  };

  const overflow = [];
  let skippedComplex = 0;   // 压在图片/渐变上、无法测量对比度的文本数量
  const samples = [];
  const leaves = new Map();   // 叶子节点 → 矩形（用于同父重叠检测）
  for (const node of root.querySelectorAll('*')) {
    if (!visible(node)) continue;
    const rect = node.getBoundingClientRect();
    if (rect.right > docWidth + 1 || rect.left < -1) {
      overflow.push(`${(node.className || node.tagName).toString().split(' ')[0]} right=${Math.round(rect.right)} left=${Math.round(rect.left)}`);
    }
    // 只看叶子：直接含文本且没有元素子节点
    const ownText = [...node.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
    if (!ownText || node.children.length) continue;
    /* 装饰元素按设计就该低对比（水印"壹"、序号"12"、箭号 ↗）。
     * WCAG 对纯装饰内容是豁免的；正确做法是给它们 aria-hidden="true"（本项目多数已经标了），
     * 校验时跳过 —— 而不是把装饰硬拉成 4.5:1，那会毁掉版面层次（实测踩过这个假阳性）。 */
    if (node.closest('[aria-hidden="true"]')) continue;
    /* 压在图片/渐变上的文字算不出对比度（见 measurableBg 的说明）：跳过并计数。
     * 这个判断必须在浏览器里做（要读计算样式），所以放在页面函数中。 */
    let onComplexBg = false;
    for (let current = node; current; current = current.parentElement) {
      const bgImage = getComputedStyle(current).backgroundImage;
      if (bgImage && bgImage !== 'none') { onComplexBg = true; break; }
      const bg = getComputedStyle(current).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') break;
    }
    if (onComplexBg) { skippedComplex++; continue; }
    const style = getComputedStyle(node);
    samples.push({
      tag: node.tagName.toLowerCase(),
      cls: (node.className || '').toString().split(' ')[0],
      text: ownText.slice(0, 18),
      fontSize: parseFloat(style.fontSize),
      bold: Number(style.fontWeight) >= 600,
      color: style.color,
      bg: effectiveBg(node),
    });
    leaves.set(node, rect);
  }

  // 同级重叠：同一父容器下，两个都在同一行（垂直区间重叠）且水平区间也重叠
  const overlaps = [];
  const byParent = new Map();
  for (const node of leaves.keys()) {
    const parent = node.parentElement;
    if (!parent) continue;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(node);
  }
  for (const [parent, nodes] of byParent) {
    if (nodes.length < 2) continue;
    const parentText = parent.textContent.trim();
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = leaves.get(nodes[i]), b = leaves.get(nodes[j]);
        const hOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const vOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (hOverlap <= 2 || vOverlap <= 2) continue;
        // 同一父容器内的文本片段：HTML 里相邻的 span 会共处一行（"勇气 COURAGE"），
        // 这属于正常排版；只有**区域整体被压住**才算问题，所以这里按父容器整体矩形判断。
        const pr = parent.getBoundingClientRect();
        const overflowInside = a.right > pr.right + 1 || b.right > pr.right + 1;
        if (overflowInside) overlaps.push(`${(nodes[i].className || '').toString().split(' ')[0]}「${nodes[i].textContent.trim().slice(0, 12)}」× ${(nodes[j].className || '').toString().split(' ')[0]}「${nodes[j].textContent.trim().slice(0, 12)}」（父「${parentText.slice(0, 16)}」）`);
      }
    }
  }
  return { overflow, samples, overlaps, skippedComplex };
};

(async () => {
  const browser = await launch();
  for (const [label, width, height] of VIEWPORTS) {
    console.log(`\n═══ ${label} ═══`);
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(base, { waitUntil: 'load' });

    const targets = selector ? [selector] : SECTIONS;
    let overflowCount = 0;
    let skippedComplexTotal = 0;
    const contrastFailures = [];
    const allOverlaps = [];
    let checkedSections = 0;

    for (const target of targets) {
      if (!(await page.locator(target).count())) continue;
      await page.locator(target).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      const report = await page.evaluate(measure, target);
      if (!report) continue;
      checkedSections++;
      overflowCount += report.overflow.length;
      report.overflow.slice(0, 3).forEach(item => console.log(`   溢出 ${target}：${item}`));
      const seen = new Set();
      for (const sample of report.samples) {
        const key = `${sample.color}|${sample.bg}|${sample.cls}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const ratio = contrast(sample.color, sample.bg);
        const large = sample.fontSize >= 24 || (sample.bold && sample.fontSize >= 18.66);
        const need = large ? 3 : 4.5;
        if (ratio < need) contrastFailures.push(`${target} ${sample.cls || sample.tag}「${sample.text}」${ratio.toFixed(2)}:1 < ${need}:1`);
      }
      allOverlaps.push(...report.overlaps);
      skippedComplexTotal += report.skippedComplex;
    }

    console.log(`   检查了 ${checkedSections} 个小节；${skippedComplexTotal} 处文字压在图片/渐变上（由 audit-visual 负责）`);
    overflowCount === 0 ? ok('没有水平溢出') : bad(`${overflowCount} 处水平溢出`);
    allOverlaps.length === 0 ? ok('没有内容被压出容器') : bad(`${allOverlaps.length} 处内容溢出父容器：\n      ${allOverlaps.slice(0, 5).join('\n      ')}`);
    contrastFailures.length === 0 ? ok('对比度全部达到 WCAG AA')
      : bad(`对比度 ${contrastFailures.length} 处不足：\n      ${contrastFailures.slice(0, 8).join('\n      ')}`);
    await context.close();
  }

  await browser.close();
  console.log(`\n=== 汇总 ===\n${failures === 0 ? '✅ 排版与可读性检查通过' : `❌ ${failures} 项未通过`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
