/**
 * 浏览器检查脚本的共用入口：把"用哪个 playwright、启动哪个浏览器"统一在一处。
 *
 * 为什么需要它（都是实际踩过的坑）：
 *   ① 原来每个脚本各写一行 `require(process.env.PLAYWRIGHT_MODULE || 'playwright')`，
 *      而本机可能只装了 `playwright-core`（不含自带浏览器，体积小得多），
 *      于是四个浏览器检查全部报 `Cannot find module 'playwright'` —— 看起来像"网站坏了"，
 *      实际是环境缺包。这里按 playwright → playwright-core 顺序回退，装上哪个都能跑。
 *   ② 浏览器也做了回退：playwright-core 不带浏览器，但 Windows 上一定有 Edge（Chromium 内核），
 *      直接用它就不必下载几百 MB。真装了 playwright 的浏览器时也能用（BROWSER_CHANNEL='' 强制）。
 *
 * 用法：
 *   const { chromium, launch } = require('./browser.cjs');
 *   const browser = await launch();            // 自动挑浏览器
 *   const browser = await launch({ channel: '' }); // 强制用 playwright 自带的 chromium
 * 环境变量：PLAYWRIGHT_MODULE（指定包名/路径）、BROWSER_CHANNEL（chrome / msedge / ''）
 */
function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_MODULE, 'playwright', 'playwright-core'].filter(Boolean);
  const errors = [];
  for (const spec of candidates) {
    try { return { spec, module: require(spec) }; } catch (error) { errors.push(`${spec}: ${error.code || error.message}`); }
  }
  throw new Error(`没有可用的 playwright（试过 ${candidates.join(', ')}）\n  ${errors.join('\n  ')}\n  解决：npm i -D playwright-core（再设 BROWSER_CHANNEL=msedge）或 npm i -D playwright && npx playwright install chromium`);
}

const { spec, module: playwright } = loadPlaywright();

/** 决定启动参数：显式 channel 优先；否则 Windows 上优先用系统 Edge；都没有就让 playwright 找自带浏览器。 */
function launchOptions(overrides = {}) {
  const options = { headless: true };
  const explicit = overrides.channel !== undefined ? overrides.channel : process.env.BROWSER_CHANNEL;
  if (explicit) options.channel = explicit;
  else if (process.platform === 'win32') options.channel = 'msedge';
  return { ...options, ...overrides, ...(overrides.channel === '' ? { channel: undefined } : {}) };
}

/** 启动浏览器；失败时给出可操作的提示，而不是一句 "browserType.launch: Executable doesn't exist"。 */
async function launch(overrides = {}) {
  try {
    return await playwright.chromium.launch(launchOptions(overrides));
  } catch (error) {
    const hint = [
      `启动浏览器失败（来自 ${spec}）：${String(error.message).split('\n')[0]}`,
      '  可选：设 BROWSER_CHANNEL=chrome 或 msedge 用系统浏览器；',
      '  或跑 npx playwright install chromium 下载自带的 Chromium。',
    ].join('\n');
    throw new Error(hint);
  }
}

module.exports = { chromium: playwright.chromium, playwright, launch, launchOptions, source: spec };
