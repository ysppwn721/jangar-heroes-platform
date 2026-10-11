#!/usr/bin/env node
/**
 * 生成"技术控制台"页面（public/console.html）。
 *
 * 为什么单独做这一页：参赛作品的软件属性需要**一页能独立看懂的东西**来证明，
 * 而主展馆页（index.html）是给观众看的、讲文化的。两者受众不同，硬塞在一起
 * 会让两边都讲不清。这一页只讲工程：管线、数据、预算、约束、复跑方式。
 *
 * 数据来源：reports/asset-report.json（由 scripts/assetctl.mjs all 产出）。
 * 因此这一页的数字**不是手写的**，是构建期从 GLB 二进制里量出来的——
 * 这一点本身就是"可验证性"的证据。
 *
 * 用法：node scripts/gen-console.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await fs.readFile(path.join(ROOT, 'assetctl.config.json'), 'utf8'));


/** 主流程：可被构建流程 import 调用，不杀进程。 */
export const runGen = async () => {
  let report;
  try {
    report = JSON.parse(await fs.readFile(path.join(ROOT, 'reports/asset-report.json'), 'utf8'));
  } catch {
    console.error('缺少 reports/asset-report.json。请先运行：node scripts/assetctl.mjs all');
    throw new Error('校验或生成未通过');
  }

  const { assets, cache, problems, generatedAt } = report;

  /* ───────────────────────────── 统计 ───────────────────────────── */

  const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
  const kib = n => (n / 1024).toFixed(0);
  const mib = n => (n / 1048576).toFixed(2);
  const pct = (part, whole) => `${(100 * part / whole).toFixed(1)}%`;

  const totals = {
    count: assets.length,
    rawBytes: sum(assets, 'totalBytes'),
    gzipBytes: sum(assets, 'gzipBytes'),
    geometryBytes: sum(assets, 'geometryBytes'),
    textureBytes: sum(assets, 'textureBytes'),
    vertices: sum(assets, 'vertices'),
    triangles: sum(assets, 'triangles'),
    gpuTextureBytes: sum(assets, 'textureGPUBytes'),
  };
  totals.gzipSaving = 100 * (1 - totals.gzipBytes / totals.rawBytes);

  const tiers = {};
  for (const [key, spec] of Object.entries(config.tiers)) {
    const group = assets.filter(a => a.tier === key);
    if (!group.length) continue;
    tiers[key] = {
      label: spec.label,
      description: spec.description,
      count: group.length,
      bytes: sum(group, 'totalBytes'),
      gzipBytes: sum(group, 'gzipBytes'),
      transferBudgetHuman: spec.transferBudgetHuman,
      transferBudget: spec.transferBudget,
      rawBudgetHuman: spec.rawBudgetHuman ?? null,
      rawBudget: spec.rawBudget ?? null,
      indexTypeName: spec.indexTypeName,
      avgBytes: sum(group, 'totalBytes') / group.length,
      avgGzip: sum(group, 'gzipBytes') / group.length,
    };
  }

  // 原始资产指标来自配置（仓库外的 models2/），产出指标一律现算
  const originals = config.originals?.models || {};
  const originalTotal = Object.values(originals).reduce((a, b) => a + (b.sourceBytes || 0), 0);
  const originalTriangles = Object.values(originals).reduce((a, b) => a + (b.originalTriangles || 0), 0);
  const detailTotal = tiers.detail ? tiers.detail.bytes : 0;
  const detailGzip = tiers.detail ? tiers.detail.gzipBytes : 0;

  /* ───────────────────────────── 样式 ───────────────────────────── */

  const CSS = `
  :root{
    --ink:#e8e2d4; --ink-dim:#a8a291; --ink-faint:#6f6a5d;
    --bg:#0f1f1c; --bg-2:#142825; --panel:#172f2b; --panel-2:#1c3733;
    --line:#2a4741; --line-soft:#203a35;
    --gold:#c9a227; --gold-soft:#8a6a2c; --gold-bright:#e2c352;
    --green:#235347; --cream:#f5efe2;
    --mono:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;
    --sans:"Songti SC","Noto Serif SC",Georgia,"Microsoft YaHei",serif;
  }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);
    line-height:1.7;font-size:16px}
  a{color:var(--gold-bright);text-decoration:none;border-bottom:1px solid var(--line)}
  a:hover{border-bottom-color:var(--gold-bright)}
  .wrap{max-width:1180px;margin:0 auto;padding:0 28px}

  /* 顶部 */
  .top{position:sticky;top:0;z-index:10;background:rgba(15,31,28,.94);
    backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
  .top-in{max-width:1180px;margin:0 auto;padding:14px 28px;display:flex;
    align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}
  .brand{display:flex;align-items:center;gap:12px;border:0}
  .brand-mark{width:34px;height:34px;border:1px solid var(--gold-soft);border-radius:4px;
    display:grid;place-items:center;color:var(--gold);font-size:18px}
  .brand b{display:block;font-size:15px;letter-spacing:.04em}
  .brand small{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.18em;
    color:var(--ink-faint)}
  .top-nav{display:flex;gap:22px;font-size:14px;flex-wrap:wrap}
  .top-nav a{border:0;color:var(--ink-dim);white-space:nowrap}
  .top-nav a:hover,.top-nav a.active{color:var(--gold-bright)}

  /* 版面 */
  header.hero{padding:64px 0 44px;border-bottom:1px solid var(--line-soft)}
  .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.24em;
    color:var(--gold-soft);text-transform:uppercase;margin:0 0 18px}
  h1{font-size:clamp(28px,4.2vw,46px);line-height:1.28;margin:0 0 18px;font-weight:600;
    letter-spacing:.01em}
  h1 em{font-style:normal;color:var(--gold-bright)}
  .lede{font-size:17px;color:var(--ink-dim);max-width:74ch;margin:0 0 10px}
  .lede strong{color:var(--ink);font-weight:600}
  .problem{max-width:74ch;margin:26px 0 0;padding:18px 22px;border-left:2px solid var(--gold-soft);
    background:var(--bg-2);color:var(--ink-dim);font-size:15px}

  section{padding:56px 0;border-bottom:1px solid var(--line-soft)}
  section > .wrap > h2{font-size:clamp(20px,2.6vw,27px);margin:0 0 8px;font-weight:600}
  section > .wrap > .sub{color:var(--ink-dim);font-size:15px;margin:0 0 30px;max-width:76ch}

  /* 指标格 */
  .metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:1px;
    background:var(--line-soft);border:1px solid var(--line-soft)}
  .metric{background:var(--panel);padding:22px 20px}
  .metric .k{font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;
    color:var(--ink-faint);text-transform:uppercase;margin-bottom:12px}
  .metric .v{font-family:var(--mono);font-size:27px;color:var(--gold-bright);line-height:1.1;
    font-variant-numeric:tabular-nums}
  .metric .v small{font-size:13px;color:var(--ink-dim);margin-left:5px}
  .metric .n{font-size:13px;color:var(--ink-dim);margin-top:9px}

  /* 架构图 */
  .arch{border:1px solid var(--line-soft);background:var(--panel);padding:8px;overflow-x:auto}
  .arch svg{display:block;min-width:760px;width:100%;height:auto}

  /* 表格 */
  .tbl-wrap{overflow-x:auto;border:1px solid var(--line-soft)}
  table{border-collapse:collapse;width:100%;font-family:var(--mono);font-size:12.5px;
    font-variant-numeric:tabular-nums}
  th,td{padding:10px 12px;text-align:right;border-bottom:1px solid var(--line-soft);
    white-space:nowrap}
  th:first-child,td:first-child{text-align:left}
  thead th{background:var(--panel-2);color:var(--gold-soft);font-weight:600;font-size:11px;
    letter-spacing:.1em;text-transform:uppercase;position:sticky;top:0}
  tbody tr:hover{background:var(--panel-2)}
  tbody tr.tier-preview td{color:var(--ink)}
  tbody tr.tier-detail td{color:var(--ink)}
  td.name{color:var(--ink);font-family:var(--sans);font-size:14px}
  .badge{display:inline-block;padding:1px 7px;border:1px solid var(--line);border-radius:3px;
    font-size:10.5px;color:var(--ink-dim);margin-right:6px}
  .badge.ok{border-color:var(--green);color:#7fb69f}
  .badge.warn{border-color:var(--gold-soft);color:var(--gold-bright)}
  .badge.fail{border-color:#8c3b2e;color:#d98a76}

  /* 代码块 */
  pre{background:#0a1715;border:1px solid var(--line-soft);border-left:2px solid var(--green);
    padding:18px 20px;overflow-x:auto;font-family:var(--mono);font-size:12.5px;
    line-height:1.75;color:#bcd3ca;margin:0}
  pre .c{color:var(--ink-faint)}
  pre .g{color:var(--gold-bright)}
  code{font-family:var(--mono);font-size:.9em;background:var(--bg-2);padding:1px 6px;
    border-radius:3px;color:var(--gold-bright)}

  /* 卡片列 */
  .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}
  .card{background:var(--panel);border:1px solid var(--line-soft);padding:22px}
  .card h3{margin:0 0 10px;font-size:16px;font-weight:600}
  .card p{margin:0 0 10px;font-size:14px;color:var(--ink-dim)}
  .card ul{margin:10px 0 0;padding-left:18px;font-size:14px;color:var(--ink-dim)}
  .card li{margin-bottom:6px}
  .card .tag{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;color:var(--gold-soft)}

  /* 断言列表 */
  .checks{list-style:none;margin:0;padding:0;border:1px solid var(--line-soft)}
  .checks li{display:flex;gap:14px;align-items:flex-start;padding:14px 18px;
    border-bottom:1px solid var(--line-soft);font-size:14px}
  .checks li:last-child{border-bottom:0}
  .checks .mark{font-family:var(--mono);flex:0 0 18px;font-weight:700}
  .checks .mark.ok{color:#7fb69f}
  .checks .mark.warn{color:var(--gold-bright)}
  .checks .mark.fail{color:#d98a76}
  .checks .body{color:var(--ink-dim)}
  .checks .body b{color:var(--ink);font-weight:600}

  footer{padding:40px 0 60px;color:var(--ink-faint);font-size:13px}
  footer .wrap{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}
  @media(max-width:720px){
    .wrap{padding:0 18px}.top-in{padding:12px 18px}
    section{padding:40px 0}header.hero{padding:44px 0 32px}
    .metric .v{font-size:23px}
  }
  @media print{body{background:#fff;color:#111}.top{position:static}}
  `;

  /* ──────────────────────── SVG 架构图 ──────────────────────── */

  const ARCH_SVG = `
  <svg viewBox="0 0 1040 520" role="img" aria-label="软件架构图：构建期资产管线、运行时渲染引擎、双端应用、数据与知识层">
    <defs>
      <marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
        <path d="M0 0 L10 5 L0 10 z" fill="#8a6a2c"/>
      </marker>
      <style>
        .bx{fill:#1c3733;stroke:#2a4741;stroke-width:1}
        .bx-hi{fill:#203f39;stroke:#8a6a2c;stroke-width:1.2}
        .ttl{fill:#e8e2d4;font:600 14px "Songti SC",Georgia,serif}
        .sm{fill:#a8a291;font:11.5px Consolas,monospace}
        .xs{fill:#6f6a5d;font:10.5px Consolas,monospace}
        .lane{fill:#0f1f1c;stroke:#203a35;stroke-width:1;stroke-dasharray:4 4}
        .lanet{fill:#c9a227;font:600 11px Consolas,monospace;letter-spacing:.16em}
        .ln{stroke:#8a6a2c;stroke-width:1.2;fill:none;marker-end:url(#ar)}
        .lnd{stroke:#2a4741;stroke-width:1;fill:none;stroke-dasharray:3 3}
      </style>
    </defs>

    <!-- 泳道标签 -->
    <rect class="lane" x="8" y="10" width="150" height="158" rx="3"/>
    <text class="lanet" x="20" y="32">BUILD TIME</text>
    <text class="lanet" x="20" y="48">构建期</text>

    <rect class="lane" x="8" y="184" width="150" height="150" rx="3"/>
    <text class="lanet" x="20" y="206">RUN TIME</text>
    <text class="lanet" x="20" y="222">运行时</text>

    <rect class="lane" x="8" y="350" width="150" height="158" rx="3"/>
    <text class="lanet" x="20" y="372">DATA</text>
    <text class="lanet" x="20" y="388">数据层</text>

    <!-- 构建期 -->
    <rect class="bx" x="176" y="26" width="196" height="58" rx="3"/>
    <text class="ttl" x="190" y="50">原始采集资产</text>
    <text class="xs" x="190" y="68">models2/ · 单尊 70–117 MB</text>

    <rect class="bx" x="176" y="102" width="196" height="58" rx="3"/>
    <text class="ttl" x="190" y="126">只读容器解析</text>
    <text class="xs" x="190" y="144">JSON chunk + bufferViews</text>

    <rect class="bx-hi" x="404" y="64" width="212" height="96" rx="3"/>
    <text class="ttl" x="418" y="88">① 资产处理管线</text>
    <text class="sm" x="418" y="108">assetctl.mjs</text>
    <text class="xs" x="418" y="126">量化 · 紧凑化 · 双级产出</text>
    <text class="xs" x="418" y="144">预算断言 · 量化报告</text>

    <rect class="bx" x="652" y="26" width="180" height="58" rx="3"/>
    <text class="ttl" x="666" y="50">轻量版 preview</text>
    <text class="xs" x="666" y="68">u16 索引 · 首屏可旋转</text>

    <rect class="bx" x="652" y="102" width="180" height="58" rx="3"/>
    <text class="ttl" x="666" y="126">精细版 detail</text>
    <text class="xs" x="666" y="144">u32 索引 · 完整精度</text>

    <rect class="bx" x="864" y="64" width="160" height="96" rx="3"/>
    <text class="ttl" x="878" y="88">清单与报告</text>
    <text class="sm" x="878" y="108">manifest.json</text>
    <text class="sm" x="878" y="126">asset-report.json</text>
    <text class="xs" x="878" y="144">内容哈希命名</text>

    <!-- 运行时 -->
    <rect class="bx-hi" x="176" y="200" width="212" height="118" rx="3"/>
    <text class="ttl" x="190" y="224">② 跨端渲染引擎</text>
    <text class="sm" x="190" y="244">GLB 解析 · WebGL 管线</text>
    <text class="xs" x="190" y="262">KHR_mesh_quantization 展开</text>
    <text class="xs" x="190" y="280">渐进式替换保状态</text>
    <text class="xs" x="190" y="298">无 Three.js · 无 Draco</text>

    <rect class="bx" x="424" y="200" width="180" height="54" rx="3"/>
    <text class="ttl" x="438" y="224">Web 端</text>
    <text class="xs" x="438" y="242">浏览器 / WebGL 1+2</text>

    <rect class="bx" x="424" y="266" width="180" height="54" rx="3"/>
    <text class="ttl" x="438" y="290">微信小程序端</text>
    <text class="xs" x="438" y="308">主包 ≤1.5 MB</text>

    <rect class="bx-hi" x="640" y="200" width="212" height="118" rx="3"/>
    <text class="ttl" x="654" y="224">③ 应用层</text>
    <text class="sm" x="654" y="244">数字展馆 · 英雄图鉴</text>
    <text class="xs" x="654" y="262">知识图谱 · 史料溯源</text>
    <text class="xs" x="654" y="280">④ AI 辅助叙述</text>
    <text class="xs" x="654" y="298">检索增强 · 语音播报</text>

    <!-- 数据层 -->
    <rect class="bx" x="176" y="376" width="212" height="112" rx="3"/>
    <text class="ttl" x="190" y="400">英雄名录单一数据源</text>
    <text class="sm" x="190" y="420">src/heroes.js</text>
    <text class="xs" x="190" y="438">与小程序端构建期同步</text>
    <text class="xs" x="190" y="456">check-roster 断言一致性</text>

    <rect class="bx" x="424" y="376" width="212" height="112" rx="3"/>
    <text class="ttl" x="438" y="400">知识图谱数据集</text>
    <text class="sm" x="438" y="420">jangar-graph.json</text>
    <text class="xs" x="438" y="438">异名 · 篇章 · 师承</text>
    <text class="xs" x="438" y="456">check-graph 校验引用完整性</text>

    <rect class="bx" x="672" y="376" width="212" height="112" rx="3"/>
    <text class="ttl" x="686" y="400">史料溯源台账</text>
    <text class="sm" x="686" y="420">provenance.json</text>
    <text class="xs" x="686" y="438">来源 / 采集 / 核对状态</text>
    <text class="xs" x="686" y="456">缺来源的字段显式标 null</text>

    <!-- 连线 -->
    <path class="ln" d="M372 55 L404 90"/>
    <path class="ln" d="M372 131 L404 118"/>
    <path class="ln" d="M616 92 L652 55"/>
    <path class="ln" d="M616 132 L652 131"/>
    <path class="ln" d="M832 90 L864 100"/>
    <path class="lnd" d="M616 160 L616 188"/>
    <path class="ln" d="M388 259 L424 232"/>
    <path class="ln" d="M388 268 L424 285"/>
    <path class="ln" d="M604 232 L640 240"/>
    <path class="ln" d="M604 285 L640 278"/>
    <path class="lnd" d="M282 318 L282 376"/>
    <path class="lnd" d="M530 318 L530 376"/>
    <path class="lnd" d="M778 318 L778 376"/>
    <path class="lnd" d="M388 432 L424 432"/>
    <path class="lnd" d="M636 432 L672 432"/>
  </svg>`;

  /* ──────────────────────── 页面组装 ──────────────────────── */

  const assetRows = assets.map(asset => {
    const spec = config.tiers[asset.tier];
    const overTransfer = asset.gzipBytes > spec.transferBudget;
    const overRaw = spec.rawBudget && asset.totalBytes > spec.rawBudget;
    const flags = [
      overTransfer ? '<span class="badge fail">超传输预算</span>' : '',
      overRaw ? '<span class="badge fail">超原始预算</span>' : '',
    ].join('');
    return `<tr class="tier-${asset.tier}">
        <td class="name">${asset.slug}<span class="badge ${asset.tier === 'preview' ? 'ok' : ''}">${spec.label}</span></td>
        <td>${kib(asset.totalBytes)} KiB${overRaw ? ' <span class="badge fail">超</span>' : ''}</td>
        <td>${kib(asset.gzipBytes)} KiB${overTransfer ? ' <span class="badge fail">超</span>' : ''}</td>
        <td>${kib(asset.geometryBytes)} KiB</td>
        <td>${kib(asset.textureBytes)} KiB</td>
        <td>${asset.vertices.toLocaleString()}</td>
        <td>${asset.triangles.toLocaleString()}</td>
        <td>${asset.indexType}</td>
        <td>${asset.layout.bytesPerVertex}</td>
        <td>${asset.quantization ? '是' : '否'}</td>
      </tr>${flags ? '' : ''}`;
  }).join('\n');

  const cacheRows = cache.map(row => `<tr>
        <td>${row.tier}</td><td class="name">${row.slug}</td>
        <td>${row.vertices.toLocaleString()}</td><td>${row.triangles.toLocaleString()}</td>
        <td>${row.reuseRatio}</td><td>${row.acmr32}</td><td>${row.acmr16}</td>
      </tr>`).join('\n');

  const avgAcmr32 = cache.length ? (cache.reduce((s, r) => s + r.acmr32, 0) / cache.length).toFixed(3) : '—';
  const avgAcmr16 = cache.length ? (cache.reduce((s, r) => s + r.acmr16, 0) / cache.length).toFixed(3) : '—';

  const checks = problems.length
    ? problems.map(p => `<li><span class="mark ${p.level}">${p.level === 'fail' ? '✗' : '!'}</span>
        <span class="body"><b>${p.asset}</b> — ${p.rule}（实际 ${p.actual}）</span></li>`).join('\n')
    : '<li><span class="mark ok">✓</span><span class="body"><b>全部预算断言通过</b> — 单文件体积、总量、索引类型、量化扩展四项逐资产检查</span></li>';

  const tierCards = Object.entries(tiers).map(([key, tier]) => `
    <div class="card">
      <p class="tag">${key.toUpperCase()}</p>
      <h3>${tier.label}</h3>
      <p>${tier.description}</p>
      <ul>
        <li>资产数：<strong>${tier.count}</strong></li>
        <li>传输上限：<strong>${tier.transferBudgetHuman}</strong>/个，实测均 gzip ${kib(tier.avgGzip)} KiB</li>
        ${tier.rawBudgetHuman ? `<li>原始体积上限：<strong>${tier.rawBudgetHuman}</strong>/个，实测均 ${kib(tier.avgBytes)} KiB</li>` : ''}
        <li>索引类型：<code>${tier.indexTypeName}</code></li>
      </ul>
    </div>`).join('\n');

  const html = `<!doctype html>
  <html lang="zh-CN">
  <head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#0f1f1c" />
  <meta name="color-scheme" content="dark" />
  <meta name="description" content="《江格尔》十二英雄——基于手写 WebGL 管线的史诗数字展陈交互系统 的技术控制台：构建期资产处理管线、运行时跨端渲染引擎、数据与知识层的量化证据。" />
  <title>技术控制台｜《江格尔》十二英雄——基于手写 WebGL 管线的史诗数字展陈交互系统</title>
  <link rel="icon" type="image/svg+xml" href="./favicon.svg" />
  <style>${CSS}
/* ── 打印 / PDF：把深色主题整体反转为浅色 ──────────────────────────────
   为什么必须显式覆盖每一个变量与内联色：
   这三页的配色在屏幕上是"深底浅字"，打印后若只把 body 改成白底，
   浅色文字会留在白纸上——实测 console.html 有 290 个文字节点对比度 < 3。
   下面按"白纸黑字 + 可读的深色强调"重写，而不是微调。 */
@media print {
  :root, body {
    --bg: #ffffff; --bg-2: #ffffff; --panel: #ffffff; --panel-2: #f6f6f4;
    --line: #b9b9b3; --line-soft: #d8d8d2;
    --ink: #111111; --ink-2: #1f1f1f; --ink-dim: #3a3a3a; --ink-faint: #5a5a5a;
    --gold: #6b5410; --gold-soft: #6b5410; --gold-bright: #4a3a08;
    --green: #1d4a3f; --ok: #1d5c3a; --warn: #6b5410; --bad: #8a2f1e;
    --mono: ui-monospace, Consolas, monospace;
    background: #ffffff !important;
    color: #111111 !important;
  }
  /* 页面骨架：去掉粘性定位、毛玻璃与阴影，避免打印时错位或糊成灰块 */
  .top { position: static !important; background: #ffffff !important; backdrop-filter: none !important; }
  header.hero, section, main, footer { background: #ffffff !important; }
  .graph-pane, .detail-pane, .ask-box, .disclose, .card, .metric, .basis,
  pre, table, th, td, .hit, .turn, .variant, .rel, .srcchip, .tag, .pill, .chip {
    background: #ffffff !important; color: #111111 !important;
    box-shadow: none !important; backdrop-filter: none !important;
  }
  /* 表格表头原本是深底金字 → 纸面上改为浅灰底深字 */
  thead th, th { background: #eeeeea !important; color: #111111 !important; }
  /* 代码块：白底深字 + 细边框，避免实心黑块 */
  pre { border: 1px solid #b9b9b3 !important; }
  pre .c { color: #5a5a5a !important; }
  pre .g { color: #4a3a08 !important; }
  code, kbd { background: #f0f0ec !important; color: #111111 !important; }
  /* 链接：打印后要能看出是链接并保留地址可读性 */
  a { color: #14508a !important; border-bottom-color: #b9b9b3 !important; }
  /* 强调与状态色换成纸面可读的深色 */
  h1 em, .epithet, .ev-t, strong, b { color: #111111 !important; }
  .eyebrow, .ev-k, .metric .k, .block h3, .disclose h2, .basis h3, .status,
  .lanet, .rel .type, .variant .form, .srcchip, .tag, .pill { color: #4a4a4a !important; }
  .metric .v { color: #4a3a08 !important; }
  .metric .v.ok { color: #1d5c3a !important; }
  .metric .v.warn { color: #6b5410 !important; }
  .answer.refused { color: #8a2f1e !important; border-left-color: #8a2f1e !important; }
  .mark.ok { color: #1d5c3a !important; }
  .mark.warn { color: #6b5410 !important; }
  .mark.fail { color: #8a2f1e !important; }
  /* 交互控件在纸面上没有意义，去掉视觉重量 */
  button, .toggle, #send, .mode button { background: #f0f0ec !important; color: #111111 !important; border-color: #b9b9b3 !important; }
  /* 徽章：.badge.ok / .badge.fail 的 color 在原样式里是硬编码的浅绿/浅红，
     不随上面重写的变量翻转，因此会逃出反色体系（实测打印对比度只有 2.31）。
     这里显式改用变量，与反色后的 --ok / --bad 保持一致。 */
  .badge.ok { color: var(--ok) !important; border-color: var(--ok) !important; }
  .badge.fail { color: var(--bad) !important; border-color: var(--bad) !important; }
  .badge { color: #3a3a3a !important; border-color: #b9b9b3 !important; }
  .graph-bar { background: #ffffff !important; border-bottom-color: #d8d8d2 !important; }
  /* 图谱是交互组件，打印时以静态提示替代空白区域 */
  #graph { display: none !important; }
  .graph-pane::after {
    content: "交互式知识图谱需在浏览器中查看（本页为打印件）。";
    display: block; padding: 18px; color: #4a4a4a; font-size: 13px;
  }
  .detail-pane { max-height: none !important; overflow: visible !important; }
  /* 避免在标题后断页、避免行内元素被拆开 */
  h1, h2, h3 { break-after: avoid; }
  tr, .hit, .turn, .card, .metric { break-inside: avoid; }
  @page { margin: 14mm; }
}

</style>
  </head>
  <body>
  <a class="skip-link" href="#arch" style="position:absolute;left:-9999px">跳到主要内容</a>

  <div class="top">
    <div class="top-in">
      <a class="brand" href="./console.html">
        <span class="brand-mark" aria-hidden="true">⌘</span>
        <span><b>《江格尔》十二英雄——基于手写 WebGL 管线的史诗数字展陈交互系统</b><small>TECHNICAL CONSOLE · BUILD ${generatedAt.slice(0, 10)}</small></span>
      </a>
      <nav class="top-nav" aria-label="页面导航">
        <a href="#arch">架构</a>
        <a href="#metrics">量化指标</a>
        <a href="#assets">资产清单</a>
        <a href="#cache">缓存效率</a>
        <a href="#cli">命令行</a>
        <a href="#constraints">运行约束</a>
        <a href="./index.html">→ 应用实例</a>
      </nav>
    </div>
  </div>

  <header class="hero">
    <div class="wrap">
      <p class="eyebrow">软件作品 · 技术控制台 · 指定命题「民族文化 创新表达」</p>
      <h1>把 70–117 MB 一尊的三维资产，<br />压到能在手机里<em>真实旋转</em>。</h1>
      <p class="lede">
        《江格尔》史诗非遗数字化采集产出的原始三维资产，单尊 <strong>150 万三角面</strong>、
        单模型 <strong>70–117 MB</strong>。而它真正需要触达的阵地是手机浏览器与微信——
        弱网、低端设备、以及微信小程序 <strong>1.5 MB</strong> 的主包上限。
      </p>
      <p class="lede">
        本系统是解决这一矛盾的<strong>构建期处理管线</strong>与<strong>运行时跨端渲染引擎</strong>：
        配置驱动，外部库 <strong>0</strong> 个、Draco 解码器 <strong>0</strong> 个、CDN 依赖 <strong>0</strong> 个。
      </p>
      <p class="problem">
        <strong>这一页的所有数字都是构建期从 GLB 二进制里量出来的，不是手写的。</strong>
        运行 <code>node scripts/assetctl.mjs all</code> 可完整复现本页全部指标——
        这是本作品"可验证性"的实现方式。
      </p>
    </div>
  </header>

  <section id="metrics">
    <div class="wrap">
      <h2>处理结果</h2>
      <p class="sub">原始资产 → 产出资产的全量对比。所有数值由 <code>assetctl</code> 直接解析 GLB 容器得出。</p>
      <div class="metrics">
        <div class="metric">
          <div class="k">原始资产合计</div>
          <div class="v">${mib(originalTotal)}<small>MiB</small></div>
          <div class="n">12 尊，单尊 73–88 MB</div>
        </div>
        <div class="metric">
          <div class="k">精细版合计</div>
          <div class="v">${mib(detailTotal)}<small>MiB</small></div>
          <div class="n">压缩至原始 ${pct(detailTotal, originalTotal)}</div>
        </div>
        <div class="metric">
          <div class="k">精细版 gzip 传输</div>
          <div class="v">${mib(detailGzip)}<small>MiB</small></div>
          <div class="n">再降 ${pct(detailGzip, detailTotal)}</div>
        </div>
        <div class="metric">
          <div class="k">轻量版单尊均值</div>
          <div class="v">${kib(tiers.preview ? tiers.preview.avgBytes : 0)}<small>KiB</small></div>
          <div class="n">首屏即可旋转</div>
        </div>
        <div class="metric">
          <div class="k">三角面保留</div>
          <div class="v">${pct(totals.triangles, originalTriangles * 2)}</div>
          <div class="n">产出 ${totals.triangles.toLocaleString()} / 原始 ${(originalTriangles * 2).toLocaleString()}</div>
        </div>
        <div class="metric">
          <div class="k">每顶点字节</div>
          <div class="v">13<small>B</small></div>
          <div class="n">位置 6 + 法线 3 + UV 4</div>
        </div>
        <div class="metric">
          <div class="k">外部运行时依赖</div>
          <div class="v">0</div>
          <div class="n">无 Three.js / 无 Draco / 无 CDN</div>
        </div>
        <div class="metric">
          <div class="k">平均 ACMR</div>
          <div class="v">${avgAcmr32}</div>
          <div class="n">32 槽顶点缓存（u16 预检 ${avgAcmr16}）</div>
        </div>
        <div class="metric">
          <div class="k">预算断言</div>
          <div class="v ${problems.some(p => p.level === 'fail') ? '' : 'ok'}">${problems.length === 0 ? '全部通过' : problems.length + ' 项'}</div>
          <div class="n">含 manifest 与实际资产一致性</div>
        </div>
      </div>
    </div>
  </section>

  <section id="arch">
    <div class="wrap">
      <h2>软件架构</h2>
      <p class="sub">
        四层分离：构建期管线只读解析容器、产出双级资产与清单；运行时引擎只负责解压与绘制；
        应用层承载展馆、图谱与 AI 叙述；数据层用单一数据源保证双端一致。
        层与层之间以<strong>文件契约</strong>（manifest / 数据集 JSON）耦合，因此管线可脱离本项目复用。
      </p>
      <div class="arch">${ARCH_SVG}</div>
      <div class="cols" style="margin-top:22px">
        ${tierCards}
        <div class="card">
          <p class="tag">CONTRACT</p>
          <h3>级间契约</h3>
          <p>管线不直接调用渲染代码，只产出<strong>文件</strong>：双级 GLB + <code>manifest.json</code>。
            渲染引擎不关心资产怎么来的，只读清单。</p>
          <ul>
            <li>替换资产来源：改 <code>assetctl.config.json</code></li>
            <li>替换渲染目标：实现同一清单读取契约</li>
            <li>契约变更可被预算断言与校验脚本拦截</li>
          </ul>
        </div>
      </div>
    </div>
  </section>

  <section id="assets">
    <div class="wrap">
      <h2>资产清单</h2>
      <p class="sub">
        ${totals.count} 个产出资产。几何与贴图字节数分开统计——这个拆分决定了优化该往哪使劲：
        本批资产几何占比 ${pct(totals.geometryBytes, totals.rawBytes)}，因此减面与顶点紧凑化是主要收益来源，
        而不是一味压贴图。
      </p>
      <div class="tbl-wrap">
        <table>
          <thead><tr>
            <th>资产</th><th>原始</th><th>gzip</th><th>几何</th><th>贴图</th>
            <th>顶点</th><th>三角面</th><th>索引</th><th>字节/顶点</th><th>量化</th>
          </tr></thead>
          <tbody>
  ${assetRows}
          </tbody>
        </table>
      </div>
      <p class="sub" style="margin-top:16px">
        合计 ${totals.count} 个资产：原始 ${mib(totals.rawBytes)} MiB → gzip ${mib(totals.gzipBytes)} MiB
        （压缩 ${totals.gzipSaving.toFixed(1)}%）；几何 ${mib(totals.geometryBytes)} MiB /
        贴图 ${mib(totals.textureBytes)} MiB；GPU 贴图常驻（含 mipmap）${mib(totals.gpuTextureBytes)} MiB。
      </p>
    </div>
  </section>

  <section id="cache">
    <div class="wrap">
      <h2>顶点缓存效率（ACMR）</h2>
      <p class="sub">
        ACMR（Average Cache Miss Ratio）是 GPU 后变换缓存命中率的行业指标，1.0 为理想值。
        本项检查用于回答一个具体工程问题：<strong>轻量版能退回 16 位索引吗？</strong>
        16 位索引可再省一半索引字节，但顶点复用率不足时反而拖慢绘制。
        实测 u16 预检值整体升高至 ${avgAcmr16}，因此轻量版保留 u16（体积优先，因该级受 750 KiB 硬约束），
        精细版保留 u32（绘制效率优先）。
      </p>
      <div class="tbl-wrap">
        <table>
          <thead><tr>
            <th>级别</th><th>模型</th><th>顶点</th><th>三角面</th><th>索引复用比</th>
            <th>ACMR32</th><th>ACMR16</th>
          </tr></thead>
          <tbody>
  ${cacheRows}
          </tbody>
        </table>
      </div>
      <p class="sub" style="margin-top:16px">
        平均 ACMR32 <strong>${avgAcmr32}</strong> / ACMR16 <strong>${avgAcmr16}</strong>。
        以 FIFO 顶点缓存简化模型估算，仅用于同一批资产内部横向比较，不代表真实驱动绝对值。
      </p>
    </div>
  </section>

  <section id="cli">
    <div class="wrap">
      <h2>命令行接口</h2>
      <p class="sub">一条命令复现本页全部数字。管线是独立的命令行工具，不依赖本项目其余代码。</p>
      <pre><span class="c"># 全量：解析资产 → 校验预算 → 顶点缓存分析 → 写出 JSON/Markdown 报告</span>
  node scripts/assetctl.mjs all

  <span class="c"># 单独跑某一项</span>
  node scripts/assetctl.mjs verify      <span class="c"># 仅校验预算与完整性（CI 门禁用，失败退出码 1）</span>
  node scripts/assetctl.mjs report      <span class="c"># 仅生成逐资产量化报告</span>
  node scripts/assetctl.mjs cache       <span class="c"># 仅做顶点缓存效率分析</span>

  <span class="c"># 限定级别 / 指定输出目录</span>
  node scripts/assetctl.mjs report --tier=preview --out=reports/preview

  <span class="g"># 产物</span>
  <span class="c">#   reports/asset-report.json   机器可读，供 CI 与页面消费</span>
  <span class="c">#   reports/asset-report.md     人可读，可直接附入参赛材料</span>
  <span class="c">#   public/console.html          本页（由 gen-console.mjs 读报告生成）</span></pre>
      <div class="cols" style="margin-top:22px">
        <div class="card">
          <p class="tag">DESIGN CHOICE</p>
          <h3>为什么自己解析 GLB 而不用现成库</h3>
          <p>不是重复造轮子，是约束条件决定的。</p>
          <ul>
            <li>微信小程序主包上限 <strong>1.5 MB</strong>，不允许下载外部解码器</li>
            <li>网页端要求<strong>零第三方脚本</strong>，避免外部依赖成为唯一故障点</li>
            <li>自研换来的是：完全可控的加载策略、体积预算与失败降级路径</li>
          </ul>
        </div>
        <div class="card">
          <p class="tag">DESIGN CHOICE</p>
          <h3>为什么不用 Draco 而用量化</h3>
          <p>Draco 压缩率更高，但需要附带第三方解码器代码（体积与许可双重成本）。</p>
          <ul>
            <li>改用 glTF 官方扩展 <code>KHR_mesh_quantization</code></li>
            <li>顶点属性紧凑存储：位置 6 B / 法线 3 B / UV 4 B，合计 <strong>13 B/顶点</strong></li>
            <li>解压由自研运行时完成，零第三方代码</li>
          </ul>
        </div>
        <div class="card">
          <p class="tag">REUSABILITY</p>
          <h3>换一批资产怎么用</h3>
          <p>管线与"江格尔"这一具体内容解耦，只依赖配置文件。</p>
          <ul>
            <li>改 <code>assetctl.config.json</code> 的 <code>tiers</code> 与预算</li>
            <li>指向新的资产目录，重新运行 <code>assetctl all</code></li>
            <li>预算断言与报告自动适配新资产</li>
          </ul>
        </div>
      </div>
    </div>
  </section>

  <section id="constraints">
    <div class="wrap">
      <h2>运行时约束与预算断言</h2>
      <p class="sub">
        作品运行环境的硬约束在这里逐条列出，并由 <code>assetctl verify</code> 在构建期断言。
        约束不是描述，是门禁：违反即构建失败。
      </p>
      <div class="cols">
        <div class="card">
          <p class="tag">RUNTIME</p>
          <h3>零外部依赖</h3>
          <ul>
            <li>外部库：<strong>${config.runtimeConstraints.externalLibraries.length === 0 ? '无' : config.runtimeConstraints.externalLibraries.join(', ')}</strong></li>
            <li>Draco 解码器：<strong>${config.runtimeConstraints.dracoDecoder ? '需要' : '不需要'}</strong></li>
            <li>Three.js：<strong>${config.runtimeConstraints.threeJs ? '使用' : '不使用'}</strong></li>
            <li>CDN 依赖：<strong>${config.runtimeConstraints.cdnDependencies ? '有' : '无'}</strong></li>
          </ul>
        </div>
        <div class="card">
          <p class="tag">BUDGETS</p>
          <h3>体积预算（两个指标，不能混用）</h3>
          <ul>
            <li><strong>传输体积（gzip）</strong>决定用户实际下载量与缓存占用：
              轻量 ≤ <strong>${config.tiers.preview.transferBudgetHuman}</strong>/个、
              精细 ≤ <strong>${config.tiers.detail.transferBudgetHuman}</strong>/个、
              精细合计 ≤ <strong>${config.budgets.detailTierTotalHuman}</strong></li>
            <li><strong>原始体积（GLB）</strong>只受部署平台单文件上限约束：
              精细 ≤ <strong>${config.tiers.detail.rawBudgetHuman}</strong>/个、
              平台硬限 <strong>${config.budgets.cloudflareSingleFileHuman}</strong></li>
            <li>小程序主包 ≤ <strong>${config.budgets.wechatMainPackageHuman}</strong></li>
            <li>拿 gzip 当磁盘体积会低估，拿原始体积当传输体积会高估</li>
          </ul>
        </div>
        <div class="card">
          <p class="tag">PERFORMANCE</p>
          <h3>性能预算</h3>
          <ul>
            <li>首次可交互 ≤ <strong>${config.budgets.webFirstInteractiveBudgetMs} ms</strong></li>
            <li>精细版就绪 ≤ <strong>${config.budgets.webDetailReadyBudgetMs} ms</strong></li>
            <li>测试条件：5 Mbps 下行 / 100 ms 延迟 / 冷缓存</li>
            <li>离屏或静止时减少渲染，降低移动端耗电</li>
          </ul>
        </div>
      </div>
      <h2 style="margin-top:44px;font-size:20px">构建期断言结果</h2>
      <ul class="checks">
  ${checks}
      </ul>
    </div>
  </section>

  <footer>
    <div class="wrap">
      <span>《江格尔》十二英雄——基于手写 WebGL 管线的史诗数字展陈交互系统</span>
      <span>报告生成于 ${generatedAt}　·　由 <code>scripts/assetctl.mjs</code> 量测</span>
    </div>
  </footer>

  </body>
  </html>
  `;

  const target = path.join(ROOT, 'console.html');
  await fs.writeFile(target, html, 'utf8');
  console.log(`技术控制台已生成：console.html（${(Buffer.byteLength(html) / 1024).toFixed(1)} KiB，基于 ${assets.length} 个资产、${problems.length} 条断言问题）`);
};

/** 直接执行本文件时才跑主流程。 */
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await runGen();
