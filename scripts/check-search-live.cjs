/** 站内搜索实测（方案 A：内容定位）—— 在真实浏览器里跑断言。
 *
 * 为什么要这部分测试，而不是只看"能不能打开"：
 *   搜索最容易出的错不是崩，而是**排错**：搜「宝木巴」返回了一串英雄卡片
 *   （因为英雄简介里顺带提到宝木巴），真正讲宝木巴的那一节被挤到后面。
 *   这种错误静态检查发现不了 —— 必须真跑、真看返回的第一条是谁。
 *
 * ⚠️ 这里同时是一份**回归清单**：
 *   下面每一条「输入 → 期望第一条」都是施工中真实踩过的坑（见注释），
 *   改动搜索排序时如果它挂了，说明改动把某个坑又踩回去了。
 *
 * 用法：
 *   node scripts/preview-static.mjs --dist      # 另开一个终端
 *   node scripts/check-search-live.cjs
 * 环境变量：TEST_URL
 */
const { launch } = require('./browser.cjs');

const base = process.env.TEST_URL || 'http://127.0.0.1:4173/';
let failures = 0;
const check = (condition, message) => {
  console.log(`   ${condition ? '✅' : '❌'} ${message}`);
  if (!condition) failures++;
};
const head = title => console.log(`\n=== ${title} ===`);

/* 输入 → 期望出现在第一条的标题关键词；第三条是"为什么会有这条期望"的来历 */
const CASES = [
  ['洪古尔', '洪古尔', '点名找一位英雄 —— 精确命中'],
  ['射箭', '哈日吉拉根', '换个说法也要能搜到（靠别名「射箭」），这是搜索最容易失手的一类'],
  ['云纹', '云纹', '纹样名称'],
  ['宝木巴', '走进江格尔', '曾经第一名是萨纳拉（英雄简介里顺带提到宝木巴），修正后应由专题章节胜出'],
  ['多少个英雄', '探索问答与参观说明', '曾经这个 section 漏登记、根本不进索引，于是搜不到'],
  ['怎么去展馆', '探索问答与参观说明', '导航类问法 —— 观众会这么问，但页面从没用过这个词'],
  ['十二英雄', '十二英雄图鉴', '图鉴章节'],
  ['江格尔齐', '口传心授', '口头传承主题'],
];

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });

  await page.goto(base, { waitUntil: 'load' });

  head('① 搜索入口');
  const entry = await page.evaluate(() => ({
    button: !!document.getElementById('search-open'),
    dialog: !!document.getElementById('search-dialog'),
    input: !!document.getElementById('search-input'),
    results: !!document.getElementById('search-results'),
    progressBar: !!document.getElementById('reading-progress-bar'),
  }));
  check(entry.button && entry.dialog && entry.input && entry.results, '搜索按钮 / 对话框 / 输入框 / 结果容器齐全');
  check(entry.progressBar, '阅读进度条存在');

  await page.click('#search-open');
  await page.waitForTimeout(250);
  const opened = await page.evaluate(() => ({
    open: document.getElementById('search-dialog')?.open,
    focused: document.activeElement?.id,
  }));
  check(opened.open === true, '点击后对话框打开');
  check(opened.focused === 'search-input', '焦点自动落在输入框（键盘用户不必再点一次）');

  head('② 每个查询的第一条是否命中期望（回归清单）');
  const query = async text => {
    await page.fill('#search-input', text);
    await page.waitForTimeout(160);
    return page.evaluate(() => [...document.querySelectorAll('.search-item')].map(item => ({
      kind: item.querySelector('.search-kind')?.textContent || '',
      title: item.querySelector('.search-item-title')?.textContent || '',
      snippet: item.querySelector('.search-item-snippet')?.textContent || '',
    })));
  };
  for (const [input, expected, why] of CASES) {
    const rows = await query(input);
    const first = rows[0];
    check(!!first && first.title.includes(expected),
      `「${input}」→ ${first ? `[${first.kind}] ${first.title}` : '（无结果）'}　（期望含「${expected}」：${why}）`);
  }

  head('③ 空态与兜底');
  const empty = await query('打油诗');
  const emptyText = await page.textContent('#search-empty');
  check(empty.length === 0, '无关输入没有结果（而不是硬凑几条）');
  check(/换个说法|讲解员/.test(emptyText || ''), '空态给出可操作的下一步（换说法 / 去问讲解员）');

  head('④ 键盘操作');
  /* 每一步都先显式确保对话框处于期望状态 ——
   * 曾因为"上一步的结尾状态"导致后面误判（playwright 的 page.fill 会先点击输入框，
   * 那个点击落在"按 / 唤起"之前，于是 / 键没被拦截、对话框根本没开）。 */
  const openDialog = async () => {
    if (!(await page.evaluate(() => document.getElementById('search-dialog')?.open))) {
      await page.click('#search-open');
      await page.waitForTimeout(250);
    }
  };
  await openDialog();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);   // 关闭有过渡，等太短会误判（实测：250ms 时读到"仍打开"）
  check(await page.evaluate(() => !document.getElementById('search-dialog')?.open), 'Esc 关闭');
  await page.keyboard.press('/');
  await page.waitForTimeout(250);
  check(await page.evaluate(() => document.getElementById('search-dialog')?.open === true), '按 / 唤起搜索');
  await openDialog();
  await page.locator('#search-input').click();
  await page.keyboard.type('洪古尔');
  await page.waitForTimeout(200);
  const beforeArrow = await page.evaluate(() => document.querySelector('.search-item.active')?.querySelector('.search-item-title')?.textContent || '');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(120);
  const afterArrow = await page.evaluate(() => document.querySelector('.search-item.active')?.querySelector('.search-item-title')?.textContent || '');
  check(!!beforeArrow, '默认高亮第一条');
  console.log(`   （只有一条结果时 ↓ 会绕回同一项：「${beforeArrow}」→「${afterArrow}」）`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);

  head('⑤ 选中后真的到达目标');
  /* 注意断言的是"3D 展厅在视口内"，不是"页面滚下去了"：
   * 英雄结果的目标是 3D 展厅，而展厅位于 #home —— 页面**顶部**。
   * 所以选英雄后 scrollY 应当接近 0，写"已滚动"是错的（实测踩过这个假失败）。 */
  const landed = await page.evaluate(() => {
    const viewer = document.getElementById('model-viewer')?.getBoundingClientRect();
    return {
      dialogOpen: document.getElementById('search-dialog')?.open,
      modelName: document.getElementById('model-name')?.textContent || '',
      viewerVisible: !!viewer && viewer.bottom > 0 && viewer.top < window.innerHeight,
      scrollY: Math.round(window.scrollY),
    };
  });
  check(landed.dialogOpen === false, '跳转后搜索框自动关闭');
  check(landed.modelName === '洪古尔', `英雄结果直接进入 3D 展厅（当前模型：${landed.modelName}）`);
  check(landed.viewerVisible, `3D 展厅已在视口内（scrollY=${landed.scrollY} —— 展厅在页面顶部，滚到 0 是对的）`);

  head('⑥ 章节结果跳转到正确锚点');
  await page.click('#search-open');
  await page.waitForTimeout(200);
  const rows = await query('云纹');
  await page.evaluate(() => document.querySelector('.search-item')?.click());
  await page.waitForTimeout(1000);
  const anchor = await page.evaluate(() => {
    const target = document.querySelector('.search-target');
    return { hasHighlight: !!target, id: target?.id || '' };
  });
  check(anchor.hasHighlight, `跳转后目标区有短暂高亮（${anchor.id || '未标记'}）`);

  head('⑦ 阅读进度');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.6));
  await page.waitForTimeout(400);
  const progress = await page.evaluate(() => {
    const track = document.getElementById('reading-progress');
    return {
      visible: track?.classList.contains('is-visible'),
      width: parseFloat(document.getElementById('reading-progress-bar')?.style.width || '0'),
      valueNow: Number(track?.getAttribute('aria-valuenow') || -1),
    };
  });
  check(progress.visible, '滚动后进度条出现');
  check(progress.width > 30 && progress.width < 95, `进度与实际位置相符（${progress.width.toFixed(1)}%）`);
  check(progress.valueNow === Math.round(progress.width), `无障碍属性同步（aria-valuenow=${progress.valueNow}）`);

  head('⑧ 页面错误');
  check(errors.length === 0, errors.length ? `有 ${errors.length} 条错误：${errors[0]}` : '没有页面错误');

  await browser.close();
  console.log(`\n=== 汇总 ===\n${failures === 0 ? '✅ 站内搜索实测通过' : `❌ ${failures} 项未通过`}`);
  process.exit(failures === 0 ? 0 : 1);
})();
