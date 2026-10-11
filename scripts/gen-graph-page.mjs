#!/usr/bin/env node
/**
 * 生成「知识图谱与史料溯源」页面（graph.html）。
 *
 * 这是软件系统应用层的第三个模块。它要解决的不是"画一张好看的图"，而是
 * 一个真实的方法论问题：十二英雄的名单、异名与谱系在不同文献里**并不一致**。
 * 图里每个断言都挂 sourceId，核不清的显式标"待核对"——
 * 让"我们不知道什么"和"我们知道什么"一样可见。
 *
 * 数据来源：src/data/jangar-graph.json（由 scripts/check-graph.mjs 校验引用完整性）
 *           src/data/provenance.json（站点知识点 → 外部来源的反查台账）
 *
 * 用法：node scripts/gen-graph-page.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const graph = JSON.parse(await fs.readFile(path.join(ROOT, 'src/data/jangar-graph.json'), 'utf8'));
const provenance = JSON.parse(await fs.readFile(path.join(ROOT, 'src/data/provenance.json'), 'utf8'));

const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** 转义 HTML，再把 **粗体** / *斜体* 转成标签。
 *
 * 为什么需要：数据集（jangar-graph.json / provenance.json）里大量使用 **…** 表示强调，
 * 而这些强调恰好落在最需要被读到的可信度声明上——
 * 「**不得**把本站当作史诗史料来源引用」「**该来源尚未发生**」「**存疑占位条目，不得引用。**」。
 * 生成器原先只做（或不完整地做）转义、不做 markdown 转换，
 * 于是这些星号**原样上屏**：读者看到的是星号而不是重点，
 * 页面显得未完成，而且恰好弱化了本就为"资料依据 / 文化理解"加分的那部分内容。
 *
 * 顺序很重要：**先转义、再转换**，否则数据里的原始 HTML 会被当标记注入。 */
function rich(text) {
  return String(text ?? '')
    .replace(/[&<>"']/g, ch => HTML_ESCAPE[ch])
    .replace(/\*\*([^*\n]{1,120})\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]{1,80})\*(?!\*)/g, '$1<em>$2</em>');
}

/** 属性值转义（用于 title / href 等属性位）。 */
const attr = text => String(text ?? '').replace(/[&<>"]/g, ch => HTML_ESCAPE[ch]);


/** 主流程：可被构建流程 import 调用，不杀进程。 */
export const runGen = async () => {
  const nodes = graph.nodes;
  const sources = graph.sources;
  const sourceById = new Map(sources.map(s => [s.id, s]));

  /* 只把图谱数据喂给页面；渲染与交互在浏览器里做 */
  const payload = {
    // 时间戳取自数据集自身，不取墙上时间——否则每次构建都产生"只有时间变"的
    // diff，仓库长期 dirty，而"工作区干净"是每轮验收的可信前提。
    generatedAt: graph.meta?.generatedAt || graph.meta?.provenanceNormalizedAt || '2026-10-11T00:00:00.000Z',
    nodes: nodes.map(n => ({
      id: n.id,
      name: n.name,
      nodeType: n.nodeType || 'hero',
      epithet: n.epithet || '',
      role: n.role || '',
      summary: n.summary || '',
      nameVariants: n.nameVariants || [],
      chapters: n.chapters || [],
      motifs: n.motifs || [],
      relations: n.relations || [],
      provenance: n.provenance || {},
    })),
    sources: sources.map(s => ({
      id: s.id, type: s.type, title: s.title, publisher: s.publisher || '',
      url: s.url || '', accessedAt: s.accessedAt || '', reliability: s.reliability, note: s.note || '',
    })),
    provenance: Array.isArray(provenance) ? provenance : (provenance.entries || []),
  };

  /* 统计（页面顶部指标条用，全部现算，不手写） */
  const heroCount = nodes.filter(n => sourceById.size && n.id !== 'bomba' && n.id !== 'jangarchi-tradition').length;
  const relationCount = nodes.reduce((sum, n) => sum + (n.relations || []).length, 0);
  const variantCount = nodes.reduce((sum, n) => sum + (n.nameVariants || []).length, 0);
  const reviewed = nodes.filter(n => n.provenance?.reviewStatus === '已核对').length;
  const pending = nodes.filter(n => n.provenance?.reviewStatus === '待核对').length;
  const sourcedRelations = nodes.reduce((sum, n) => sum + (n.relations || []).filter(r => r.sourceId).length, 0);
  const provenanceEntries = payload.provenance.length;

  const CSS = `
  :root{
    --bg:#0f1f1c;--bg-2:#142825;--panel:#172f2b;--panel-2:#1c3733;
    --line:#2a4741;--line-soft:#203a35;
    --ink:#e8e2d4;--ink-2:#c8c2b2;--ink-dim:#a8a291;--ink-faint:#6f6a5d;
    --gold:#c9a227;--gold-soft:#8a6a2c;--gold-bright:#e2c352;
    --green:#235347;--ok:#7fb69f;--warn:#e2c352;--bad:#d98a76;
    --mono:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;
    --sans:"Songti SC","Noto Serif SC",Georgia,"Microsoft YaHei",serif;
  }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.7;font-size:16px}
  a{color:var(--gold-bright);text-decoration:none;border-bottom:1px solid var(--line)}
  a:hover{border-bottom-color:var(--gold-bright)}
  .wrap{max-width:1400px;margin:0 auto;padding:0 26px}

  .top{position:sticky;top:0;z-index:20;background:rgba(15,31,28,.95);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
  .top-in{max-width:1400px;margin:0 auto;padding:13px 26px;display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap}
  .brand{display:flex;align-items:center;gap:12px;border:0}
  .brand-mark{width:34px;height:34px;border:1px solid var(--gold-soft);border-radius:4px;display:grid;place-items:center;color:var(--gold);font-size:17px}
  .brand b{display:block;font-size:15px}
  .brand small{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.16em;color:var(--ink-faint)}
  .top-nav{display:flex;gap:20px;font-size:14px;overflow-x:auto;max-width:100%}
  .top-nav a{border:0;color:var(--ink-dim);white-space:nowrap}
  .top-nav a:hover{color:var(--gold-bright)}

  header.hero{padding:52px 0 34px;border-bottom:1px solid var(--line-soft)}
  .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.24em;color:var(--gold-soft);text-transform:uppercase;margin:0 0 16px}
  h1{font-size:clamp(25px,3.6vw,40px);line-height:1.3;margin:0 0 16px;font-weight:600}
  h1 em{font-style:normal;color:var(--gold-bright)}
  .lede{font-size:16.5px;color:var(--ink-dim);max-width:80ch;margin:0 0 10px}
  .lede strong{color:var(--ink);font-weight:600}
  .method{margin:24px 0 0;padding:16px 20px;border-left:2px solid var(--gold-soft);background:var(--bg-2);color:var(--ink-dim);font-size:14.5px;max-width:88ch}

  .metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;background:var(--line-soft);border:1px solid var(--line-soft);margin-top:30px}
  .metric{background:var(--panel);padding:18px 16px}
  .metric .k{font-family:var(--mono);font-size:10px;letter-spacing:.14em;color:var(--ink-faint);text-transform:uppercase;margin-bottom:9px}
  .metric .v{font-family:var(--mono);font-size:24px;color:var(--gold-bright);line-height:1.1;font-variant-numeric:tabular-nums}
  .metric .v.ok{color:var(--ok)}.metric .v.warn{color:var(--warn)}
  .metric .n{font-size:12.5px;color:var(--ink-dim);margin-top:7px}

  .stage{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(340px,1fr);gap:1px;background:var(--line-soft);border:1px solid var(--line-soft);border-top:0}
  @media(max-width:1080px){.stage{grid-template-columns:1fr}}

  .graph-pane{background:var(--bg-2);position:relative;min-height:620px;display:flex;flex-direction:column}
  .graph-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 14px;border-bottom:1px solid var(--line-soft);background:var(--panel)}
  .toggle{font-family:var(--mono);font-size:11px;letter-spacing:.06em;padding:5px 11px;border:1px solid var(--line);background:transparent;color:var(--ink-dim);border-radius:3px;cursor:pointer}
  .toggle[aria-pressed="true"]{border-color:var(--gold-soft);color:var(--gold-bright);background:var(--panel-2)}
  .toggle:hover{color:var(--ink)}
  #graph{flex:1;display:block;width:100%;touch-action:none;cursor:grab}
  #graph.dragging{cursor:grabbing}

  .detail-pane{background:var(--panel);padding:22px;overflow-y:auto;max-height:min(78vh,900px)}
  @media(max-width:1080px){.detail-pane{max-height:none}}
  .detail-empty{color:var(--ink-faint);font-size:14.5px;padding:40px 6px;text-align:center;line-height:2}
  .detail-head{border-bottom:1px solid var(--line-soft);padding-bottom:14px;margin-bottom:16px}
  .detail-head .idx{font-family:var(--mono);font-size:11px;letter-spacing:.18em;color:var(--gold-soft)}
  .detail-head h2{margin:8px 0 4px;font-size:25px;font-weight:600}
  .detail-head .epithet{color:var(--gold-bright);font-size:14px}
  .detail-head .role{color:var(--ink-dim);font-size:13.5px;margin-top:6px}
  .status{display:inline-block;font-family:var(--mono);font-size:10.5px;padding:2px 9px;border:1px solid;border-radius:3px;margin-top:10px}
  .status.reviewed{border-color:var(--green);color:var(--ok)}
  .status.pending{border-color:var(--gold-soft);color:var(--warn)}

  .block{margin-bottom:20px}
  .block h3{font-size:13px;font-family:var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--gold-soft);margin:0 0 10px;font-weight:600}
  .block p.summary{margin:0;font-size:14.5px;color:var(--ink-2)}
  .variant{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--line-soft);font-size:13.5px}
  .variant:last-child{border-bottom:0}
  .variant .form{flex:0 0 92px;color:var(--ink-faint);font-family:var(--mono);font-size:11.5px;padding-top:2px}
  .variant .val{flex:1;color:var(--ink)}
  .srcchip{display:inline-block;font-family:var(--mono);font-size:10px;padding:1px 6px;border:1px solid var(--line);border-radius:3px;color:var(--ink-dim);cursor:pointer;margin-top:4px}
  .srcchip:hover{border-color:var(--gold-soft);color:var(--gold-bright)}
  .srcchip.none{border-style:dashed;color:var(--ink-faint);cursor:default}
  .rel{display:flex;gap:9px;align-items:baseline;padding:7px 0;border-bottom:1px solid var(--line-soft);font-size:13.5px;cursor:pointer}
  .rel:last-child{border-bottom:0}
  .rel:hover{color:var(--gold-bright)}
  .rel .type{flex:0 0 62px;font-family:var(--mono);font-size:11px;color:var(--gold-soft)}
  .rel .who{color:var(--ink-2)}
  .rel .flag{font-family:var(--mono);font-size:10px;color:var(--warn);border:1px dashed var(--gold-soft);padding:0 4px;border-radius:2px}
  .note{font-size:12.5px;color:var(--ink-dim);margin:8px 0 0;padding-left:10px;border-left:1px solid var(--line-soft)}

  section{padding:46px 0;border-top:1px solid var(--line-soft)}
  section > .wrap > h2{font-size:clamp(19px,2.4vw,25px);margin:0 0 8px;font-weight:600}
  section > .wrap > .sub{color:var(--ink-dim);font-size:14.5px;margin:0 0 26px;max-width:82ch}
  .tbl-wrap{overflow-x:auto;border:1px solid var(--line-soft)}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line-soft);vertical-align:top}
  thead th{background:var(--panel-2);color:var(--gold-soft);font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;font-weight:600;white-space:nowrap}
  tbody tr:hover{background:var(--panel-2)}
  td.mono,th.mono{font-family:var(--mono);font-size:11.5px;font-variant-numeric:tabular-nums}
  .rel-hi{color:var(--ok)}.rel-mid{color:var(--warn)}.rel-lo{color:var(--bad)}
  .pill{display:inline-block;font-family:var(--mono);font-size:10px;padding:1px 7px;border:1px solid var(--line);border-radius:3px;color:var(--ink-dim)}
  footer{padding:34px 0 52px;color:var(--ink-faint);font-size:12.5px}
  footer .wrap{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
  @media(max-width:640px){.wrap{padding:0 16px}.top-in{padding:11px 16px}.detail-pane{padding:16px}}
  `;

  const html = `<!doctype html>
  <html lang="zh-CN">
  <head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#0f1f1c" />
  <meta name="color-scheme" content="dark" />
  <meta name="description" content="《江格尔》十二英雄知识图谱与史料溯源：异名对照、谱系关系、逐条来源标注，以及显式标注的未核实项。" />
  <title>知识图谱与史料溯源｜《江格尔》十二英雄——基于手写 WebGL 管线的史诗数字展陈交互系统</title>
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

  <div class="top">
    <div class="top-in">
      <a class="brand" href="./graph.html">
        <span class="brand-mark" aria-hidden="true">◇</span>
        <span><b>知识图谱与史料溯源</b><small>KNOWLEDGE GRAPH · DATA ${payload.generatedAt.slice(0, 10)}</small></span>
      </a>
      <nav class="top-nav" aria-label="页面导航">
        <a href="./console.html">技术控制台</a>
        <a href="./graph.html" class="active">知识图谱</a>
        <a href="#sources">来源台账</a>
        <a href="#provenance">内容溯源</a>
        <a href="#gaps">已知缺口</a>
        <a href="./index.html">→ 应用实例</a>
      </nav>
    </div>
  </div>

  <header class="hero">
    <div class="wrap">
      <p class="eyebrow">软件作品 · 数据与知识层 · 模块 3</p>
      <h1>十二英雄的名字，<br />在不同文献里<em>并不一致</em>。</h1>
      <p class="lede">
        《江格尔》是口传史诗，历经多语种转写与汉译。同一个英雄可能有汉译名、蒙文拉丁转写、
        民间抄本异名与俄译本（卡尔梅克西里尔文）写法；十二英雄的名单与座次在不同资料里也不完全吻合。
      </p>
      <p class="lede">
        这份图谱把<strong>异名、谱系、篇章出处</strong>结构化成可查询的数据，
        并给<strong>每一条断言挂上来源</strong>。核不清的，显式标为"待核对"——
        这份数据集的可用性，取决于它是否让人一眼看出<strong>哪部分可信、哪部分还不知道</strong>。
      </p>
      <p class="method">
        <strong>数据方法：</strong>凡未能落到可打开核实的来源，其 <code>sourceId</code> 一律为
        <code>null</code> 且 <code>reviewStatus</code> 标「待核对」，不臆造来源、不用二手转述充当依据。
        当前 <strong>${pending}</strong> 个节点待核对、<strong>${reviewed}</strong> 个已核对；
        来源台账共 <strong>${sources.length}</strong> 条，其中 <strong>${sources.filter(s => s.reliability === '高').length}</strong> 条为高可靠性。
      </p>

      <div class="metrics">
        <div class="metric"><div class="k">图谱节点</div><div class="v">${nodes.length}</div><div class="n">12 位英雄 + 2 个概念节点</div></div>
        <div class="metric"><div class="k">关系边</div><div class="v">${relationCount}</div><div class="n">已挂来源 ${sourcedRelations} 条</div></div>
        <div class="metric"><div class="k">异名记录</div><div class="v">${variantCount}</div><div class="n">跨 4 种转写体系</div></div>
        <div class="metric"><div class="k">来源台账</div><div class="v">${sources.length}</div><div class="n">非遗名录 / 方志 / 学术 / 访谈</div></div>
        <div class="metric"><div class="k">已核对</div><div class="v ok">${reviewed}</div><div class="n">对应关系无歧义</div></div>
        <div class="metric"><div class="k">待核对</div><div class="v warn">${pending}</div><div class="n">已在页面显式标注</div></div>
        <div class="metric"><div class="k">内容溯源条目</div><div class="v">${provenanceEntries}</div><div class="n">站点知识点 → 外部来源反查</div></div>
      </div>
    </div>
  </header>

  <div class="stage">
    <div class="graph-pane">
      <div class="graph-bar" role="group" aria-label="图谱显示选项">
        <button class="toggle" id="t-labels" aria-pressed="true">显示名称</button>
        <button class="toggle" id="t-pending" aria-pressed="false">仅看待核对</button>
        <button class="toggle" id="t-types" aria-pressed="true">按关系类型着色</button>
        <button class="toggle" id="t-concepts" aria-pressed="true">含概念节点</button>
        <span style="flex:1"></span>
        <span class="pill" id="hint">点击节点查看详情 · 可拖动</span>
      </div>
      <svg id="graph" viewBox="0 0 900 640" role="application"
           aria-label="十二英雄知识图谱，可交互。点击节点查看异名、谱系与来源。">
        <defs>
          <filter id="glow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        <g id="links"></g>
        <g id="nodes"></g>
      </svg>
    </div>

    <aside class="detail-pane" id="detail" aria-live="polite">
      <div class="detail-empty">
        点击左侧任意节点<br />查看异名对照、谱系关系与逐条来源
      </div>
    </aside>
  </div>

  <section id="sources">
    <div class="wrap">
      <h2>来源台账</h2>
      <p class="sub">
        图谱里每个 <code>sourceId</code> 都能在本表找到对应条目。可靠性分级由来源性质决定，
        不由"看起来权威"决定：非遗名录与政府方志为「高」，跨语种学术二手整理为「中」，
        抓取失败或未落实的为「低」且注明原因。
      </p>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>编号</th><th>类型</th><th>标题</th><th>出版方</th><th>可靠性</th><th>备注</th></tr></thead>
          <tbody>
  ${sources.map(s => {
    const cls = s.reliability === '高' ? 'rel-hi' : s.reliability === '中' ? 'rel-mid' : 'rel-lo';
    const label = rich(s.title || s.url);
    const title = s.url ? `<a href="${attr(s.url)}" target="_blank" rel="noopener">${label}</a>` : (label || '—');
    return `          <tr>
              <td class="mono">${s.id}</td>
              <td class="mono">${s.type || '—'}</td>
              <td>${title}</td>
              <td>${rich(s.publisher) || '—'}</td>
              <td class="mono ${cls}">${s.reliability || '—'}</td>
              <td style="color:var(--ink-dim);font-size:12.5px">${rich(s.note)}</td>
            </tr>`;
  }).join('\n')}
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section id="provenance">
    <div class="wrap">
      <h2>内容溯源</h2>
      <p class="sub">
        站内的文化知识点（纹样解读、史诗阅读、版本对照等）逐条反查外部依据。
        <code>sources</code> 为空表示该条目属<strong>本项目自身的设计说明</strong>
        （如配色规范、纹样应用方式），不是从文献转述——这类条目不挂外部来源是正确状态，不是遗漏。
      </p>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>内容键</th><th>内容</th><th>外部依据</th><th>核对状态</th></tr></thead>
          <tbody>
  ${payload.provenance.map(entry => {
    const key = entry.contentKey || entry.key || '—';
    const text = entry.content || entry.text || '';
    const srcs = entry.sources || [];
    const chips = srcs.length
      ? srcs.map(id => `<a class="srcchip" href="#sources" title="${attr(sourceById.get(id)?.title || id)}">${id.replace(/^src-/, '')}</a>`).join(' ')
      : '<span class="srcchip none">本项目设计说明</span>';
    const status = entry.reviewStatus || '—';
    const cls = status === '已核对' ? 'rel-hi' : status === '待核对' ? 'rel-mid' : '';
    return `          <tr>
              <td class="mono">${key}</td>
              <td style="max-width:520px">${rich(text.length > 220 ? text.slice(0, 220) + '…' : text)}</td>
              <td>${chips}</td>
              <td class="mono ${cls}">${status}</td>
            </tr>`;
  }).join('\n')}
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section id="gaps">
    <div class="wrap">
      <h2>已知缺口</h2>
      <p class="sub">
        这一节列出数据集<strong>做不到的事</strong>。参赛材料要求「如实区分已完成内容、测试内容和计划内容」，
        因此把缺口写在页面上，而不是留给评委去发现。
      </p>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>缺口</th><th>表现</th><th>影响</th><th>解决路径</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>三位英雄身份待定</strong></td>
              <td>哈日尼敦、纳钦尚胡尔、赛力汗塔巴格各有两条来源线索指向不一致的对象；其中纳钦尚胡尔在卡尔梅克资料中被明确列为"下一代守护者"而非十二勇士</td>
              <td>这三位的人物设定不能作为史实表述，站内文案须按"本项目文创演绎"口径处理</td>
              <td>一本汉译本的目录或人物表（色道尔吉译本 / 黑勒·丁师浩译本）即可定案；本项目无该书访问权限</td>
            </tr>
            <tr>
              <td><strong>采集时间与采录人未落台账</strong></td>
              <td><code>collectedAt</code> / <code>collectedBy</code> 在 ${provenanceEntries} 条溯源记录中大面积为空</td>
              <td>无法证明某条内容"何时、由谁"采集，削弱过程可核验性</td>
              <td>建立采集台账制度；下一批采集时同步记录时间、采录人与设备</td>
            </tr>
            <tr>
              <td><strong>传承人核对尚未实施</strong></td>
              <td>6 个节点记录了核对<strong>计划</strong>（<code>reviewPlan</code>），实际核对未发生；<code>reviewedBy</code> 保持为空</td>
              <td>人物谱系与汉译名的最终确认缺少权威意见</td>
              <td>与自治区级传承人沟通一次集中核对，结果写回 <code>reviewedBy</code> 与 <code>reviewStatus</code></td>
            </tr>
            <tr>
              <td><strong>条目数未覆盖史诗全貌</strong></td>
              <td>史诗人物总数远不止十二位（另有数十位虎将与数千勇士的说法）；本图谱只覆盖项目选定的十二位及宝木巴、江格尔奇传承两个概念节点</td>
              <td>图谱不构成对史诗人物体系的完整整理</td>
              <td>扩充节点需先补汉译本，属后续版本计划</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <footer>
    <div class="wrap">
      <span>《江格尔》十二英雄——基于手写 WebGL 管线的史诗数字展陈交互系统 · 知识图谱与史料溯源</span>
      <span>数据校验：<code>node scripts/check-graph.mjs</code>　·　页面生成：<code>scripts/gen-graph-page.mjs</code></span>
    </div>
  </footer>

  <script type="application/json" id="graph-data">${JSON.stringify(payload).replace(/</g, '\\u003c')}</script>
  <script>
  (function(){
  'use strict';
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  /* 与构建期 rich() 等价：先转义、再转换 **粗体** / *斜体*。
     为什么必须转义：这一段走 innerHTML 拼接，数据直接插入即为注入面；
     为什么必须转换：数据集里大量 **…** 用于强调可信度声明，不转换就原样显示星号。 */
  function richClient(text){
    return String(text == null ? '' : text)
      .replace(/[&<>"']/g, function(c){ return ESC[c]; })
      .replace(/\*\*([^*\n]{1,120})\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]{1,80})\*(?!\*)/g, '$1<em>$2</em>');
  }
  /* chip() 的 title 属性位也要转义 */
  function attrClient(text){
    return String(text == null ? '' : text).replace(/[&<>"]/g, function(c){ return ESC[c]; });
  }
  var DATA = JSON.parse(document.getElementById('graph-data').textContent);
  var SVGNS = 'http://www.w3.org/2000/svg';
  var W = 900, H = 640;
  var svg = document.getElementById('graph');
  var gLinks = document.getElementById('links');
  var gNodes = document.getElementById('nodes');
  var detail = document.getElementById('detail');

  /* ── 确定性布局：不使用随机数，保证每次渲染完全一致（便于截图比对与复现） ──
   * 结构：宝木巴为圆心；十二英雄按环形分布；江格尔奇传承置于外环。
   * 关系类型不同则弧线弯曲方向不同，避免重叠。 */
  var TYPE_DIR = { '君臣': 1, '亲族': -1, '盟友': 0.6, '传承体制': -0.6, '其他': 0.3 };
  var TYPE_COLOR = { '君臣': '#c9a227', '亲族': '#7fb69f', '盟友': '#8fb8d8', '传承体制': '#b58fd8', '其他': '#8a8a7a' };

  var center = { x: W / 2, y: H / 2 };
  var heroes = DATA.nodes.filter(function(n){ return n.nodeType !== 'place' && n.nodeType !== 'tradition'; });
  var concepts = DATA.nodes.filter(function(n){ return n.nodeType === 'place' || n.nodeType === 'tradition'; });

  var pos = {};
  DATA.nodes.forEach(function(n){
    if (n.nodeType === 'place') { pos[n.id] = { x: center.x, y: center.y }; }
  });
  var R1 = 205, R2 = 288;
  heroes.forEach(function(n, i){
    var ang = (i / heroes.length) * Math.PI * 2 - Math.PI / 2;
    pos[n.id] = { x: center.x + Math.cos(ang) * R1, y: center.y + Math.sin(ang) * R1 };
  });
  concepts.filter(function(n){ return n.nodeType === 'tradition'; }).forEach(function(n, i){
    var ang = Math.PI * 0.5 + i * 0.7;
    pos[n.id] = { x: center.x + Math.cos(ang) * R2, y: center.y + Math.sin(ang) * R2 };
  });
  /* 宝木巴作为圆心节点，与各英雄的连线即"共同守卫"关系，视觉上自然聚合 */

  var relSourceCount = {};
  DATA.nodes.forEach(function(n){
    (n.relations || []).forEach(function(r){ relSourceCount[n.id] = (relSourceCount[n.id] || 0) + 1; });
    (DATA.nodes).forEach(function(other){
      (other.relations || []).forEach(function(r){ if (r.target === n.id) relSourceCount[n.id] = (relSourceCount[n.id] || 0) + 1; });
    });
  });

  function el(tag, attrs){
    var node = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) node.setAttribute(k, attrs[k]);
    return node;
  }

  /* 去重：A→B 与 B→A 只画一条，避免视觉上双线重叠 */
  var seen = {};
  var links = [];
  DATA.nodes.forEach(function(n){
    (n.relations || []).forEach(function(r){
      if (!pos[r.target] || !pos[n.id]) return;
      var key = [n.id, r.target].sort().join('|') + '|' + r.type;
      if (seen[key]) return;
      seen[key] = true;
      links.push({ source: n.id, target: r.target, type: r.type, sourceId: r.sourceId, note: r.note, from: n.id, to: r.target });
    });
  });

  var showLabels = true, onlyPending = false, colorByType = true, showConcepts = true;

  function render(){
    gLinks.textContent = ''; gNodes.textContent = '';

    links.forEach(function(l){
      if (!showConcepts && (concepts.some(function(c){ return c.id === l.source || c.id === l.target; }))) return;
      var a = pos[l.source], b = pos[l.target];
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      var dx = b.x - a.x, dy = b.y - a.y;
      var dir = TYPE_DIR[l.type] !== undefined ? TYPE_DIR[l.type] : 0.3;
      var cx = mx - dy * 0.16 * dir, cy = my + dx * 0.16 * dir;
      var color = colorByType ? (TYPE_COLOR[l.type] || '#8a8a7a') : '#3a5a53';
      var unsourced = !l.sourceId;
      var path = el('path', {
        d: 'M' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) + ' Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' + b.x.toFixed(1) + ' ' + b.y.toFixed(1),
        fill: 'none',
        stroke: unsourced ? '#8a6a2c' : color,
        'stroke-width': l.type === '君臣' ? 1.5 : 1,
        'stroke-opacity': unsourced ? 0.75 : 0.5,
        'stroke-dasharray': unsourced ? '5 4' : null,
      });
      var title = el('title');
      title.textContent = l.from + ' → ' + l.to + '（' + l.type + '）' + (unsourced ? '　⚠ 未挂来源，待核对' : '　来源：' + l.sourceId);
      path.appendChild(title);
      gLinks.appendChild(path);
    });

    DATA.nodes.forEach(function(n){
      if (!showConcepts && (n.nodeType === 'place' || n.nodeType === 'tradition')) return;
      var p = pos[n.id];
      var isConcept = n.nodeType === 'place' || n.nodeType === 'tradition';
      var pending = (n.provenance || {}).reviewStatus === '待核对';
      if (onlyPending && !pending) return;

      var g = el('g', { style: 'cursor:pointer' });
      var r = n.nodeType === 'place' ? 30 : (isConcept ? 17 : 12 + Math.min(8, (relSourceCount[n.id] || 0)));
      var fill = n.nodeType === 'place' ? '#235347' : (pending ? '#3a2f18' : '#1c3733');
      var stroke = n.nodeType === 'place' ? '#c9a227' : (pending ? '#c9a227' : '#4a7a6e');

      if (n.nodeType === 'place') {
        g.appendChild(el('circle', { cx: p.x, cy: p.y, r: r + 12, fill: 'none', stroke: '#8a6a2c', 'stroke-width': 1, 'stroke-dasharray': '3 5', opacity: .5 }));
      }
      g.appendChild(el('circle', {
        cx: p.x, cy: p.y, r: r, fill: fill, stroke: stroke,
        'stroke-width': n.nodeType === 'place' ? 2 : 1.4,
        'stroke-dasharray': pending ? '3 3' : null,
      }));

      if (showLabels) {
        var t = el('text', {
          x: p.x, y: p.y + r + 15, 'text-anchor': 'middle',
          fill: pending ? '#e2c352' : '#e8e2d4',
          style: 'font:600 ' + (n.nodeType === 'place' ? 15 : 13) + 'px "Songti SC",Georgia,serif;pointer-events:none',
        });
        t.textContent = n.name;
        g.appendChild(t);
      }

      var tip = el('title');
      tip.textContent = n.name + (n.epithet ? '（' + n.epithet + '）' : '') + (pending ? '　⚠ 待核对' : '');
      g.appendChild(tip);

      g.addEventListener('click', function(){ select(n.id); });
      gNodes.appendChild(g);
    });
  }

  function chip(id){
    var s = DATA.sources.filter(function(x){ return x.id === id; })[0];
    if (!s) return '<span class="srcchip none">' + id + '（台账缺条目）</span>';
    var label = richClient(id.replace(/^src-/, ''));
    var url = s.url ? '<a class="srcchip" href="' + s.url + '" target="_blank" rel="noopener" title="' + (s.title || '').replace(/"/g, '&quot;') + '">' + label + ' ↗</a>'
                    : '<span class="srcchip" title="' + (s.title || '').replace(/"/g, '&quot;') + '">' + label + '</span>';
    return url;
  }

  function select(id){
    var n = DATA.nodes.filter(function(x){ return x.id === id; })[0];
    if (!n) return;
    var p = n.provenance || {};
    var pending = p.reviewStatus === '待核对';
    var rels = (n.relations || []);
    var backlinks = [];
    DATA.nodes.forEach(function(o){
      (o.relations || []).forEach(function(r){ if (r.target === id) backlinks.push({ from: o.name, fromId: o.id, type: r.type, note: r.note, sourceId: r.sourceId }); });
    });

    var h = '';
    h += '<div class="detail-head">';
    h += '<p class="idx">NODE / ' + id + '</p>';
    h += '<h2>' + n.name + '</h2>';
    if (n.epithet) h += '<div class="epithet">' + n.epithet + '</div>';
    if (n.role) h += '<div class="role">' + n.role + '</div>';
    h += '<span class="status ' + (pending ? 'pending' : 'reviewed') + '">核对状态：' + richClient(p.reviewStatus || '未标注') + '</span>';
    h += '</div>';

    if (n.summary) h += '<div class="block"><h3>概述</h3><p class="summary">' + richClient(n.summary) + '</p></div>';

    if (n.nameVariants && n.nameVariants.length) {
      h += '<div class="block"><h3>异名对照（' + n.nameVariants.length + '）</h3>';
      n.nameVariants.forEach(function(v){
        h += '<div class="variant"><span class="form">' + richClient(v.form || '—') + '</span><span class="val">' + richClient(v.value) +
             (v.sourceId ? '<br>' + chip(v.sourceId) : '<br><span class="srcchip none">未挂来源</span>') + '</span></div>';
      });
      h += '</div>';
    }

    if (n.chapters && n.chapters.length) {
      h += '<div class="block"><h3>篇章出处（' + n.chapters.length + '）</h3>';
      n.chapters.forEach(function(c){
        h += '<div class="variant"><span class="form">' + richClient(c.title ? c.title.slice(0, 12) : '—') + '</span><span class="val">' + richClient(c.title || '') +
             (c.sourceId ? '<br>' + chip(c.sourceId) : '') + '</span></div>';
      });
      h += '</div>';
    }

    if (rels.length) {
      h += '<div class="block"><h3>关系（' + rels.length + '）</h3>';
      rels.forEach(function(r){
        var target = DATA.nodes.filter(function(x){ return x.id === r.target; })[0];
        var flag = r.sourceId ? '' : ' <span class="flag">未挂来源</span>';
        h += '<div class="rel" data-goto="' + r.target + '"><span class="type">' + r.type + '</span><span class="who">' +
             (target ? target.name : r.target) + flag + '</span></div>';
        if (r.note) h += '<p class="note">' + richClient(r.note) + (r.sourceId ? ' ' + chip(r.sourceId) : '') + '</p>';
      });
      h += '</div>';
    }

    if (backlinks.length) {
      h += '<div class="block"><h3>被指向（' + backlinks.length + '）</h3>';
      backlinks.forEach(function(r){
        var flag = r.sourceId ? '' : ' <span class="flag">未挂来源</span>';
        h += '<div class="rel" data-goto="' + r.fromId + '"><span class="type">' + r.type + '</span><span class="who">' + r.from + flag + '</span></div>';
      });
      h += '</div>';
    }

    h += '<div class="block"><h3>溯源</h3>';
    var ps = p.sources || [];
    h += '<div class="variant"><span class="form">外部依据</span><span class="val">' +
         (ps.length ? ps.map(chip).join(' ') : '<span class="srcchip none">无</span>') + '</span></div>';
    h += '<div class="variant"><span class="form">采集时间</span><span class="val">' + (p.collectedAt || '<span style="color:var(--ink-faint)">未记录</span>') + '</span></div>';
    h += '<div class="variant"><span class="form">采录人</span><span class="val">' + (p.collectedBy || '<span style="color:var(--ink-faint)">未记录</span>') + '</span></div>';
    h += '<div class="variant"><span class="form">核对人</span><span class="val">' +
         (p.reviewedBy || '<span style="color:var(--ink-faint)">无（尚未核对）</span>') + '</span></div>';
    if (p.reviewPlan) {
      h += '<div class="variant"><span class="form">核对计划</span><span class="val">' + richClient(p.reviewPlan.plannedReviewer || '') +
           '　<span class="pill">' + (p.reviewPlan.status || '计划中') + '</span></span></div>';
    }
    if (p.reviewStatusNote) h += '<p class="note">' + richClient(p.reviewStatusNote) + '</p>';
    h += '</div>';

    h += '<div class="block"><h3>三维模型</h3><p class="summary" style="font-size:13.5px">' +
         '该英雄的 3D 模型可在应用实例中查看：<a href="./index.html#heroes">打开数字展馆 →</a></p></div>';

    detail.innerHTML = h;
    detail.querySelectorAll('[data-goto]').forEach(function(row){
      row.addEventListener('click', function(){ select(row.getAttribute('data-goto')); });
    });
    detail.scrollTop = 0;
  }

  document.getElementById('t-labels').addEventListener('click', function(){ showLabels = !showLabels; this.setAttribute('aria-pressed', String(showLabels)); render(); });
  document.getElementById('t-pending').addEventListener('click', function(){ onlyPending = !onlyPending; this.setAttribute('aria-pressed', String(onlyPending)); render(); });
  document.getElementById('t-types').addEventListener('click', function(){ colorByType = !colorByType; this.setAttribute('aria-pressed', String(colorByType)); render(); });
  document.getElementById('t-concepts').addEventListener('click', function(){ showConcepts = !showConcepts; this.setAttribute('aria-pressed', String(showConcepts)); render(); });

  render();
  })();
  </script>
  </body>
  </html>
  `;

  await fs.writeFile(path.join(ROOT, 'graph.html'), html, 'utf8');
  console.log(`知识图谱页已生成：graph.html（${(Buffer.byteLength(html) / 1024).toFixed(1)} KiB）`);
  console.log(`  节点 ${nodes.length} · 关系 ${relationCount} · 异名 ${variantCount} · 来源 ${sources.length} · 溯源条目 ${provenanceEntries}`);
  console.log(`  核对状态：已核对 ${reviewed} / 待核对 ${pending}`);
};

/** 直接执行本文件时才跑主流程。 */
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await runGen();
