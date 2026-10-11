/**
 * 离线预缓存清单 —— 决定"断网时还能看见什么"。
 *
 * 为什么要单独一个模块、并由构建脚本内联进 service worker：
 * 清单里的文件名带内容哈希（`main.a1b2c3.js`），一旦写完就**必然**与产物不同步。
 * 常见做法是构建后写一份 manifest JSON 再让 Service Worker 去 fetch —— 但那意味着
 * Service Worker 启动时还要发一次请求（离线时这一次请求本身就可能失败）。
 * 这里改成：构建时把清单**内联**进 Service Worker 源码，清单与产物同生共死。
 *
 * 预算原则（这是离线方案能不能用的关键）：
 *   · 只预缓存**外壳 + 首屏模型**，绝不预缓存 12 尊精细模型 ——
 *     精细档每尊 ≈4.8 MiB，12 尊近 58 MiB，超过浏览器为站点分配的存储配额，
 *     会直接导致 Cache.addAll 整体失败（一个都缓存不上，比不缓存更糟）。
 *   · 精细模型改为"用到才缓存"（用户看过哪尊就留哪尊，见 service-worker.js 的运行时缓存）。
 */

/** 首屏预缓存几尊预览模型。4 尊 ≈2.1 MiB，够支撑"断网也能进 3D 展厅"。 */
export const PREVIEW_PRECACHE_COUNT = 4;

/** 预缓存总预算（字节）。超了就说明清单失控，构建会直接失败而不是糊过去。 */
export const PRECACHE_BUDGET = 12 * 1024 * 1024;

/** 运行时缓存（看过的精细模型）的容量上限，超出后按 LRU 淘汰。 */
export const RUNTIME_MODEL_BUDGET = 40 * 1024 * 1024;

/**
 * 从构建产物里算出预缓存清单。
 *
 * 注意顺序陷阱：模型在构建中会被**改名成内容哈希**（`models/v/<slug>-preview.<散列>.glb.gz`），
 * 所以清单必须在改名之后、基于 `modelAssets` 的真实路径来算 ——
 * 早先按 `models/preview/` 目录去 readdir，结果模型早已被搬走，预缓存里"首屏 0 尊"，
 * 而且不会报错（静默少缓存，正是最难发现的那类问题）。
 *
 * @param {{readdir:Function,readFile:Function,stat:Function}} fs 传入 node:fs/promises
 * @param {string} destination dist 目录绝对路径
 * @param {{htmls?:string[], modelAssets?:object, previewCount?:number}} options
 */
export async function buildPrecacheList(fs, destination, options = {}) {
  const { htmls = ['index.html'], modelAssets = null, previewCount = PREVIEW_PRECACHE_COUNT } = options;
  const entries = new Set();

  /** 顶层固定入口：Service Worker 自己 + 文档根 */
  entries.add('./');
  entries.add('./index.html');
  entries.add('./service-worker.js');

  for (const name of htmls) {
    const html = await fs.readFile(`${destination}/${name}`, 'utf8');
    // 只收本站相对引用；外链（如非遗网）不缓存 —— 断网时由页面给出兜底文案
    for (const match of html.matchAll(/(?:src|href)="\.\/([^"#?]+)"/g)) entries.add(`./${match[1]}`);
    // 内联样式里的资源引用（背景图等）
    for (const match of html.matchAll(/url\((['"]?)\.\/([^)'"]+)\1\)/g)) entries.add(`./${match[2]}`);
  }

  // main.js 动态 import 的模块：从 dist 里实际存在的 js 收，而不是猜文件名。
  // 排除 sw-manifest：它是**构建期**模块（只被 scripts/build.mjs 导入），
  // 浏览器端从来不会请求它，收进来只是白白多一项清单。
  //
  // ⚠️ 构建会把 src/*.js 重命名成内容寻址名（sw-manifest.78cb2260eb03.js），
  // 所以这里必须按"去掉哈希后的基名"判断，不能只比 name === 'sw-manifest.js'。
  // 早先只比精确名，结果这个构建期模块被**哈希后照样混进预缓存**——
  // 恰好是这段注释本来要避免的事。
  const isBuildTimeOnly = name => name.replace(/\.[0-9a-f]{6,}\.js$/, '.js') === 'sw-manifest.js'
    || name === 'sw-manifest.js';
  for (const name of await fs.readdir(`${destination}/src`)) {
    if (name.endsWith('.js') && !isBuildTimeOnly(name)) entries.add(`./src/${name}`);
  }

  // 运行时 fetch 的数据集（src/data/*.json）。
  //
  // ⚠️ 这一步以前漏了。上面的 HTML 引用扫描只认 HTML 里的 src/href，
  // 抓不到 JS 里 fetch() 的路径 —— 于是 ask.html 的语料与 graph.html 的图谱数据
  // 都没进预缓存，**断网时这两个模块会失效**，而离线外壳本身看起来是好的。
  // 数据集体积小（三个 JSON 合计约 100 KiB），值得全量预缓存。
  try {
    for (const name of await fs.readdir(`${destination}/src/data`)) {
      if (name.endsWith('.json')) entries.add(`./src/data/${name}`);
    }
  } catch {
    // 没有数据集目录是合法情况（例如只发布展馆页的精简构建）
  }

  // 首屏角色的预览模型：取 gzip 编码（渲染器优先用 .glb.gz，体积约为原始档的 60%）
  const slugs = modelAssets ? Object.keys(modelAssets) : [];
  const previewSlugs = slugs.slice(0, Math.max(0, previewCount));
  for (const slug of previewSlugs) {
    const asset = modelAssets[slug]?.preview;
    const relative = (asset && (asset.gzip || asset.raw)) || null;
    if (relative) entries.add(`./${relative}`);
    else console.warn(`[sw-manifest] ${slug} 没有预览档资产，离线首屏会缺这一尊`);
  }

  return { list: [...entries].sort(), previewSlugs };
}

/** 计算清单总体积（构建时做预算校验用）。 */
export async function measurePrecache(fs, destination, list) {
  let bytes = 0;
  const missing = [];
  const sizes = [];
  for (const entry of list) {
    const relative = entry.replace(/^\.\//, '');
    if (!relative || relative.endsWith('/')) { sizes.push({ entry, bytes: 0 }); continue; }
    try {
      const stat = await fs.stat(`${destination}/${relative}`);
      bytes += stat.size;
      sizes.push({ entry, bytes: stat.size });
    } catch {
      missing.push(entry);
    }
  }
  return { bytes, missing, sizes };
}
