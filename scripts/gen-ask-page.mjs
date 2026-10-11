#!/usr/bin/env node
/**
 * 生成「问史诗」AI 辅助叙述模块页面（ask.html）。
 *
 * 这是软件系统应用层的第四个模块，也是最需要**如实披露**的一个：
 * 竞赛规定使用 AI 工具本身不构成加分或扣分，但「未如实披露……按参赛纪律处理」。
 * 因此这一页把 AI 的使用方式做成**可见的界面元素**而不是藏在文档里：
 *   · 明写哪一步是本地检索（零依赖、可离线、结果确定）
 *   · 明写哪一步会调用大模型（可关闭；关闭后本页完全在浏览器内运行）
 *   · 每次回答都列出实际命中的语料段落与得分
 *   · 依据不足时**拒答**，而不是让模型自由发挥
 *
 * 检索实现：src/retrieval-core.js（与微信小程序 utils/retrieval.js 同源移植）
 * 语料：src/data/knowledge-corpus.json（由 scripts/sync-knowledge.mjs 从单一数据源同步）
 *
 * 用法：node scripts/gen-ask-page.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corpus = JSON.parse(await fs.readFile(path.join(ROOT, 'src/data/knowledge-corpus.json'), 'utf8'));


/** 主流程：可被构建流程 import 调用，不杀进程。 */
export const runGen = async () => {
  /* 服务端预跑一遍索引，把语料规模与可答范围写进页面（不手写） */
  const { buildIndex, decide, composeLocalAnswer } = await import(
    'file://' + path.join(ROOT, 'src/retrieval-core.js').replace(/\\/g, '/')
  );
  const index = buildIndex(corpus.chunks);

  /* 用一批真实问题探测"能答 / 拒答"的边界——把探测结果作为页面提示，而不是宣传语。
   * 用例集中在 src/ask-probes.js，由 scripts/check-ask.mjs 与构建流程共用，
   * 避免"页面显示的通过数"和"实际回归测试"两套口径分叉。 */
  const { runProbes } = await import(
    'file://' + path.join(ROOT, 'src/ask-probes.js').replace(/\\/g, '/')
  );
  const probeReport = runProbes(decide, index);
  const probeResults = probeReport.results;
  const probesPassed = probeReport.passed;
  const probes = probeReport.results;

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
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.7;font-size:16px}
  a{color:var(--gold-bright);text-decoration:none;border-bottom:1px solid var(--line)}
  .wrap{max-width:1120px;margin:0 auto;padding:0 26px}
  .top{position:sticky;top:0;z-index:20;background:rgba(15,31,28,.95);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
  .top-in{max-width:1120px;margin:0 auto;padding:13px 26px;display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap}
  .brand{display:flex;align-items:center;gap:12px;border:0}
  .brand-mark{width:34px;height:34px;border:1px solid var(--gold-soft);border-radius:4px;display:grid;place-items:center;color:var(--gold);font-size:17px}
  .brand b{display:block;font-size:15px}
  .brand small{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.16em;color:var(--ink-faint)}
  .top-nav{display:flex;gap:20px;font-size:14px;overflow-x:auto}
  .top-nav a{border:0;color:var(--ink-dim);white-space:nowrap}
  .top-nav a:hover{color:var(--gold-bright)}

  header.hero{padding:48px 0 30px;border-bottom:1px solid var(--line-soft)}
  .eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.24em;color:var(--gold-soft);text-transform:uppercase;margin:0 0 16px}
  h1{font-size:clamp(24px,3.4vw,38px);line-height:1.3;margin:0 0 16px;font-weight:600}
  h1 em{font-style:normal;color:var(--gold-bright)}
  .lede{font-size:16.5px;color:var(--ink-dim);max-width:82ch;margin:0 0 10px}
  .lede strong{color:var(--ink);font-weight:600}
  .disclose{margin:24px 0 0;border:1px solid var(--line);background:var(--bg-2)}
  .disclose h2{font-family:var(--mono);font-size:11px;letter-spacing:.18em;color:var(--gold-soft);margin:0;padding:13px 18px;border-bottom:1px solid var(--line-soft);text-transform:uppercase}
  .disclose .rows{padding:6px 18px 14px}
  .drow{display:flex;gap:14px;padding:9px 0;border-bottom:1px solid var(--line-soft);font-size:14px}
  .drow:last-child{border-bottom:0}
  .drow .dt{flex:0 0 128px;color:var(--ink-faint);font-family:var(--mono);font-size:11.5px;padding-top:3px}
  .drow .dd{flex:1;color:var(--ink-2)}
  .drow .dd b{color:var(--ink)}

  .metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:1px;background:var(--line-soft);border:1px solid var(--line-soft);margin-top:26px}
  .metric{background:var(--panel);padding:17px 15px}
  .metric .k{font-family:var(--mono);font-size:10px;letter-spacing:.14em;color:var(--ink-faint);text-transform:uppercase;margin-bottom:8px}
  .metric .v{font-family:var(--mono);font-size:23px;color:var(--gold-bright);line-height:1.1;font-variant-numeric:tabular-nums}
  .metric .v.ok{color:var(--ok)}
  .metric .n{font-size:12px;color:var(--ink-dim);margin-top:6px}

  main{padding:40px 0 20px}
  .ask-box{border:1px solid var(--line);background:var(--panel)}
  .ask-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 18px;border-bottom:1px solid var(--line-soft)}
  .ask-head .t{font-family:var(--mono);font-size:11px;letter-spacing:.16em;color:var(--gold-soft);text-transform:uppercase}
  .mode{margin-left:auto;display:flex;gap:6px}
  .mode button{font-family:var(--mono);font-size:11px;padding:5px 11px;border:1px solid var(--line);background:transparent;color:var(--ink-dim);border-radius:3px;cursor:pointer}
  .mode button[aria-pressed="true"]{border-color:var(--gold-soft);color:var(--gold-bright);background:var(--panel-2)}
  .ask-row{display:flex;gap:10px;padding:18px;border-bottom:1px solid var(--line-soft)}
  #q{flex:1;background:var(--bg-2);border:1px solid var(--line);color:var(--ink);font-family:var(--sans);font-size:16px;padding:13px 15px;border-radius:3px;outline:none}
  #q:focus{border-color:var(--gold-soft)}
  #q::placeholder{color:var(--ink-faint)}
  #send{background:var(--gold-soft);border:1px solid var(--gold-soft);color:#0f1f1c;font-family:var(--sans);font-size:15px;font-weight:600;padding:13px 24px;border-radius:3px;cursor:pointer;white-space:nowrap}
  #send:hover{background:var(--gold-bright);border-color:var(--gold-bright)}
  .suggest{padding:14px 18px;display:flex;gap:8px;flex-wrap:wrap}
  .chip{font-size:13px;padding:5px 12px;border:1px solid var(--line);border-radius:20px;color:var(--ink-dim);cursor:pointer;background:transparent}
  .chip:hover{border-color:var(--gold-soft);color:var(--gold-bright)}

  .thread{padding:0 18px 18px}
  .turn{border-top:1px solid var(--line-soft);padding:18px 0}
  .turn:first-child{border-top:0}
  .turn .who{font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;color:var(--ink-faint);text-transform:uppercase;margin-bottom:8px}
  .turn .qtext{font-size:17px;margin-bottom:14px}
  .answer{font-size:15.5px;color:var(--ink-2);white-space:pre-wrap}
  .answer.refused{color:var(--warn);border-left:2px solid var(--gold-soft);padding-left:14px}
  .basis{margin-top:14px;border:1px solid var(--line-soft);background:var(--bg-2)}
  .basis h3{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;color:var(--gold-soft);margin:0;padding:10px 14px;border-bottom:1px solid var(--line-soft);text-transform:uppercase}
  .hit{padding:11px 14px;border-bottom:1px solid var(--line-soft);font-size:13.5px}
  .hit:last-child{border-bottom:0}
  .hit .ht{color:var(--ink);font-weight:600;margin-bottom:3px}
  .hit .hs{font-family:var(--mono);font-size:10.5px;color:var(--ink-faint);margin-bottom:5px}
  .hit .hb{color:var(--ink-dim)}
  .verdict{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
  .tag{font-family:var(--mono);font-size:10.5px;padding:3px 9px;border:1px solid var(--line);border-radius:3px;color:var(--ink-dim)}
  .tag.ok{border-color:var(--green);color:var(--ok)}
  .tag.warn{border-color:var(--gold-soft);color:var(--warn)}

  section{padding:42px 0;border-top:1px solid var(--line-soft)}
  section h2{font-size:clamp(18px,2.3vw,24px);margin:0 0 8px;font-weight:600}
  section .sub{color:var(--ink-dim);font-size:14.5px;margin:0 0 24px;max-width:82ch}
  .tbl-wrap{overflow-x:auto;border:1px solid var(--line-soft)}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th,td{padding:9px 12px;text-align:left;border-bottom:1px solid var(--line-soft)}
  thead th{background:var(--panel-2);color:var(--gold-soft);font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;font-weight:600;white-space:nowrap}
  td.mono{font-family:var(--mono);font-size:11.5px;font-variant-numeric:tabular-nums}
  .pass{color:var(--ok)}.fail{color:var(--bad)}
  .two{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
  .card{border:1px solid var(--line-soft);background:var(--panel);padding:20px}
  .card h3{margin:0 0 10px;font-size:15.5px}
  .card p{margin:0 0 10px;font-size:14px;color:var(--ink-dim)}
  .card ul{margin:8px 0 0;padding-left:18px;font-size:14px;color:var(--ink-dim)}
  .card li{margin-bottom:5px}
  footer{padding:34px 0 52px;color:var(--ink-faint);font-size:12.5px}
  footer .wrap{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
  @media(max-width:640px){.wrap{padding:0 16px}.top-in{padding:11px 16px}.drow{flex-direction:column;gap:2px}.ask-row{flex-wrap:wrap}}
  `;

  const html = `<!doctype html>
  <html lang="zh-CN">
  <head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#0f1f1c" />
  <meta name="color-scheme" content="dark" />
  <meta name="description" content="《江格尔》软件系统的 AI 辅助叙述模块：本地 BM25 检索 + 可关闭的大模型环节，每次回答展示实际命中的语料与得分，依据不足时拒答。" />
  <title>问史诗 · AI 辅助叙述模块｜《江格尔》十二英雄——基于手写 WebGL 管线的史诗数字展陈交互系统</title>
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
      <a class="brand" href="./ask.html">
        <span class="brand-mark" aria-hidden="true">?</span>
        <span><b>问史诗 · AI 辅助叙述模块</b><small>ASSISTED NARRATION · MODULE 4</small></span>
      </a>
      <nav class="top-nav" aria-label="页面导航">
        <a href="./console.html">技术控制台</a>
        <a href="./graph.html">知识图谱</a>
        <a href="./ask.html" class="active">问史诗</a>
        <a href="#disclosure">AI 使用披露</a>
        <a href="#probe">边界测试</a>
        <a href="./index.html">→ 应用实例</a>
      </nav>
    </div>
  </div>

  <header class="hero">
    <div class="wrap">
      <p class="eyebrow">软件作品 · 应用层 · 模块 4</p>
      <h1>能答的答，<em>不能答的明说不能答</em>。</h1>
      <p class="lede">
        文化类项目最怕的不是答得少，而是<strong>编造</strong>。这个模块的检索层完全在本地运行
        （BM25 简化实现，中文二元字组切分，零依赖，与微信小程序端<strong>同源移植</strong>），
        只在命中站内已收录、且已标注来源的语料时才作答；依据不足时<strong>拒答</strong>，
        并把"为什么拒答"一并说明。
      </p>
      <p class="lede">
        大模型环节是<strong>可关闭</strong>的：关闭后本页在浏览器内独立运行，不发出任何网络请求。
      </p>

      <div class="disclose">
        <h2>本模块的 AI 使用披露（界面化，不藏在文档里）</h2>
        <div class="rows">
          <div class="drow"><span class="dt">本地检索</span><span class="dd">
            <b>不涉及 AI 生成。</b>BM25 打分与拒答判定是确定性算法，同一问题永远得到同一结果，可离线运行。
          </span></div>
          <div class="drow"><span class="dt">段落排序</span><span class="dd">
            <b>不涉及 AI 生成。</b>按词频、逆文档频率、长度归一化与实体加成计算；每次回答都公开实际命中的段落与得分。
          </span></div>
          <div class="drow"><span class="dt">答案组织</span><span class="dd">
            <b>默认不涉及 AI 生成。</b>由命中段落的原文拼接而成（<code>composeLocalAnswer</code>），
            不重写、不改写、不补全，因此不存在"模型自由发挥"的空间。
          </span></div>
          <div class="drow"><span class="dt">可选的大模型环节</span><span class="dd">
            如需把候选段落整理成更口语的讲解，可接入语言模型。该环节<b>默认关闭</b>，
            开启后会在回答下方明确标注，并附所用工具名称、使用环节与人工修改说明。
          </span></div>
          <div class="drow"><span class="dt">语料来源</span><span class="dd">
            ${corpus.chunks.length} 段语料，来自本项目展馆内容源（<code>src/heroes.js</code> 与页面文案），
            每段带 <code>source</code> 字段标注出处；语料由 <code>scripts/sync-knowledge.mjs</code>
            从单一数据源同步，与微信小程序端共用同一套语料与同一套检索实现。
          </span></div>
        </div>
      </div>

      <div class="metrics">
        <div class="metric"><div class="k">语料段落</div><div class="v">${corpus.chunks.length}</div><div class="n">全部带 source 出处</div></div>
        <div class="metric"><div class="k">索引词项</div><div class="v">${index.idf.size.toLocaleString()}</div><div class="n">二元字组 + 英文/数字</div></div>
        <div class="metric"><div class="k">实体词表</div><div class="v">${index.entities.size}</div><div class="n">从标题与标签提取</div></div>
        <div class="metric"><div class="k">边界测试</div><div class="v ${probesPassed === probes.length ? 'ok' : ''}">${probesPassed}/${probes.length}</div><div class="n">能答/拒答判定符合预期</div></div>
        <div class="metric"><div class="k">外部依赖</div><div class="v">0</div><div class="n">无分词库、无向量库、无 CDN</div></div>
        <div class="metric"><div class="k">网络请求</div><div class="v">0</div><div class="n">默认模式下完全本地</div></div>
      </div>
    </div>
  </header>

  <main>
    <div class="wrap">
      <div class="ask-box">
        <div class="ask-head">
          <span class="t">提问</span>
          <div class="mode" role="group" aria-label="作答模式">
            <button id="m-strict" aria-pressed="true">严格模式（本地）</button>
            <button id="m-online" aria-pressed="false">宽松模式（本地）</button>
          </div>
        </div>
        <div class="ask-row">
          <input id="q" type="text" placeholder="例如：洪古尔为什么叫雄狮英雄？" autocomplete="off" />
          <button id="send">问一问</button>
        </div>
        <div class="suggest" id="suggest"></div>
        <div class="thread" id="thread">
          <div class="turn">
            <div class="who">系统</div>
            <div class="answer" style="color:var(--ink-dim)">
              两种模式的区别只在<strong>拒答闸门的松紧</strong>：严格模式只在高分强命中时作答（宁可少答，不可误答）；
              宽松模式会把候选段落也交出来给人判断。两种模式的排序算法完全相同。
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>

  <section id="disclosure">
    <div class="wrap">
      <h2>为什么把 AI 使用做成界面</h2>
      <p class="sub">
        竞赛对 AI 的要求是「如实披露」：使用本身不构成加分或扣分，但未披露或伪造创作过程按纪律处理。
        把披露做成可交互的界面元素，比写在一份 PDF 里更难含糊。
      </p>
      <div class="two">
        <div class="card">
          <h3>哪些环节没有 AI</h3>
          <ul>
            <li>语料切分与索引构建（确定性）</li>
            <li>BM25 打分与段落排序（确定性）</li>
            <li>能答/拒答判定（确定性，四道闸门）</li>
            <li>答案组织（原文拼接，不重写）</li>
            <li>72 个蒙古纹样图标（脚本绘制，非生成式）</li>
            <li>三维模型处理管线（几何算法，非生成式）</li>
          </ul>
        </div>
        <div class="card">
          <h3>哪些环节可选使用 AI</h3>
          <ul>
            <li>把候选段落整理成更口语的讲解（本页默认关闭）</li>
            <li>微信小程序端的「江格尔齐」讲解员（该端接入语言模型，界面已标注）</li>
          </ul>
          <p style="margin-top:12px">
            该环节始终：① 只基于本地检索召回并已标注来源的段落；② 不得引入语料之外的事实；
            ③ 在回答处标注所用工具名称与使用环节。
          </p>
        </div>
        <div class="card">
          <h3>语料的来源与边界</h3>
          <p>
            语料以本项目展馆的原创文案为主，属于<strong>文创演绎与设计说明</strong>，
            不是史诗原文摘录。因此本模块只回答"展馆收录了什么"，
            不宣称能回答史诗学问题。
          </p>
          <p>
            涉及具体事实（人名、年代、数目、坐骑等）的提问会被<strong>主动拒绝</strong>——
            站内资料没有记载，系统不替它编一个答案。
          </p>
        </div>
      </div>
    </div>
  </section>

  <section id="probe">
    <div class="wrap">
      <h2>边界测试</h2>
      <p class="sub">
        下面这批问题在<strong>构建期</strong>用同一套代码跑过一遍，用来验证"该答的答、该拒的拒"。
        这是本模块的可验证性证据，不是宣传语。样本 ${probes.length} 条，通过 ${probesPassed} 条。
        用例集中在 <code>src/ask-probes.js</code>，由 <code>scripts/check-ask.mjs</code> 与构建流程共用——
        页面显示的通过数和回归测试是<strong>同一份</strong>，不会出现两套口径。
      </p>
      <p class="sub" style="margin-bottom:14px">
        分组通过情况：${Object.entries(probeReport.byGroup).map(([g, s]) => `<code>${g}</code> ${s.pass}/${s.total}`).join('　·　')}
      </p>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>组别</th><th>提问</th><th>预期</th><th>实际</th><th>判定</th><th>命中得分</th><th>实词覆盖</th><th>拒答原因</th></tr></thead>
          <tbody>
  ${probeResults.map(r => `          <tr>
              <td class="mono">${r.group}</td>
              <td>${r.q}</td>
              <td class="mono">${r.expect === 'answer' ? '应答' : '应拒'}</td>
              <td class="mono">${r.actual === 'answer' ? '作答' : '拒答'}</td>
              <td class="mono ${r.pass ? 'pass' : 'fail'}">${r.pass ? '✓ 符合' : '✗ 不符'}</td>
              <td class="mono">${r.score}</td>
              <td class="mono">${r.coverage}</td>
              <td class="mono">${r.reason || '—'}</td>
            </tr>`).join('\n')}
          </tbody>
        </table>
      </div>
      <p class="sub" style="margin-top:18px">
        <strong>已知局限：</strong>拒答判定基于词频与词覆盖，<strong>不是语义理解</strong>。
        实测发现站外问题「宝木巴在哪个省」的实词覆盖反而高于站内问题「云纹为什么画在袍摆上」——
        因为"语料里有没有这个事实"是语义问题。因此本模块的分工是：
        本地检索负责<strong>召回</strong>，是否足以作答在有模型时交给模型，无模型时用严格模式兜底。
        这一取舍写在代码注释里（<code>src/retrieval-core.js</code> 的 <code>decide()</code>）。
      </p>
    </div>
  </section>

  <footer>
    <div class="wrap">
      <span>《江格尔》十二英雄——基于手写 WebGL 管线的史诗数字展陈交互系统 · AI 辅助叙述模块</span>
      <span>检索实现：<code>src/retrieval-core.js</code>（与小程序端同源）　·　语料同步：<code>scripts/sync-knowledge.mjs</code></span>
    </div>
  </footer>

  <!-- 语料**构建期内联**，不做运行时 fetch。
       为什么必须内联：这个页面曾是本站唯一在运行时 fetch 数据的页面，
       而静态托管在路径不存在时普遍会回退返回 index.html（HTTP 200 + text/html）。
       于是 fetch 不会失败在状态码上，而是失败在 r.json() 解析上——
       AI 模块会**静默变空**，页面上却还写着"可离线运行"。
       内联之后没有网络请求，这类回退行为再也伤不到它，离线也不再依赖预缓存命中。 -->
  <script type="application/json" id="corpus-data">${JSON.stringify({ chunks: corpus.chunks }).replace(/</g, '\\u003c')}</script>

  <script type="module">
  import { buildIndex, decide, composeLocalAnswer, REFUSAL_TEXT } from './src/retrieval-core.js';

  /* 初始化全部包在 try/catch 里：任何一步失败都要在页面上**显式说明**，
     而不是留一个看起来正常、实际点不动的空界面。 */
  let index;
  let initError = null;
  try {
    const node = document.getElementById('corpus-data');
    if (!node) throw new Error('页面缺少内联语料节点');
    const corpus = JSON.parse(node.textContent);
    if (!corpus || !Array.isArray(corpus.chunks) || !corpus.chunks.length) {
      throw new Error('语料为空');
    }
    index = buildIndex(corpus.chunks);
  } catch (error) {
    initError = error;
    console.error('[问史诗] 语料初始化失败：', error);
  }

  if (initError) {
    const thread = document.getElementById('thread');
    thread.innerHTML = '<div class="turn"><div class="who">系统</div>'
      + '<div class="answer refused">检索模块未能初始化，本页暂时无法作答。<br>'
      + '原因：' + String(initError.message || initError).replace(/[<>&]/g, '')
      + '<br>这不是"没有资料"，而是页面资源异常；请刷新页面重试。</div></div>';
    const send = document.getElementById('send');
    if (send) { send.disabled = true; send.textContent = '暂不可用'; }
    const input = document.getElementById('q');
    if (input) { input.disabled = true; input.placeholder = '检索模块未就绪'; }
    throw initError;
  }

  const MODE_LABEL = { strict: '严格模式', online: '宽松模式' };
  let mode = 'strict';

  const SUGGESTIONS = [
    '介绍一下江格尔',
    '洪古尔为什么叫雄狮英雄',
    '云纹代表什么',
    '宝木巴是什么',
    '阿拉坦策吉是谁',
    '江格尔齐是什么',
    '宝木巴在哪个省',
    '洪古尔的父亲是谁',
  ];

  const qEl = document.getElementById('q');
  const thread = document.getElementById('thread');
  const suggest = document.getElementById('suggest');

  SUGGESTIONS.forEach(text => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', () => { qEl.value = text; ask(); });
    suggest.appendChild(b);
  });

  document.getElementById('m-strict').addEventListener('click', () => setMode('strict'));
  document.getElementById('m-online').addEventListener('click', () => setMode('online'));
  function setMode(next) {
    mode = next;
    document.getElementById('m-strict').setAttribute('aria-pressed', String(mode === 'strict'));
    document.getElementById('m-online').setAttribute('aria-pressed', String(mode === 'online'));
  }

  document.getElementById('send').addEventListener('click', ask);
  qEl.addEventListener('keydown', event => { if (event.key === 'Enter') ask(); });

  function esc(text) {
    return String(text).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  function ask() {
    const question = qEl.value.trim();
    if (!question) return;

    const verdict = decide(index, question, { mode });
    const turn = document.createElement('div');
    turn.className = 'turn';

    let body = '';
    let refused = false;
    if (verdict.confident) {
      body = composeLocalAnswer(verdict.hits);
    } else {
      refused = true;
      body = REFUSAL_TEXT[verdict.reason] || '站内资料依据不足，本系统不对此作答。';
    }

    let html = '';
    html += '<div class="who">提问</div>';
    html += '<div class="qtext">' + esc(question) + '</div>';
    html += '<div class="who">' + (mode === 'strict' ? '严格模式' : '宽松模式') + ' · 本地检索作答</div>';
    html += '<div class="answer' + (refused ? ' refused' : '') + '">' + esc(body) + '</div>';

    html += '<div class="verdict">';
    html += '<span class="tag ' + (verdict.confident ? 'ok' : 'warn') + '">' + (verdict.confident ? '依据充足' : '依据不足 → 拒答') + '</span>';
    html += '<span class="tag">最高得分 ' + verdict.topScore.toFixed(1) + '</span>';
    html += '<span class="tag">实词覆盖 ' + (verdict.coverage * 100).toFixed(0) + '%</span>';
    html += '<span class="tag">主题覆盖 ' + (verdict.topicCoverage * 100).toFixed(0) + '%</span>';
    if (verdict.factSeeking) html += '<span class="tag warn">识别为索要具体事实</span>';
    if (verdict.reason) html += '<span class="tag warn">' + esc(verdict.reason) + '</span>';
    html += '<span class="tag">AI 生成环节：未启用</span>';
    html += '</div>';

    if (verdict.hits.length) {
      html += '<div class="basis"><h3>实际命中的语料段落（' + verdict.hits.length + '）</h3>';
      verdict.hits.forEach((hit, i) => {
        html += '<div class="hit">'
          + '<div class="ht">' + (i + 1) + '. ' + esc(hit.chunk.title) + '</div>'
          + '<div class="hs">得分 ' + hit.score.toFixed(1) + '　·　出处：' + esc(hit.chunk.source || '未标注') + '</div>'
          + '<div class="hb">' + esc(hit.chunk.text) + '</div>'
          + '</div>';
      });
      html += '</div>';
    } else {
      html += '<div class="basis"><h3>命中的语料段落</h3><div class="hit"><div class="hb">'
        + '没有命中任何段落。这通常意味着问题涉及的词在站内语料中不存在。'
        + '</div></div></div>';
    }

    turn.innerHTML = html;
    thread.insertBefore(turn, thread.firstChild);
    qEl.value = '';
  }

  qEl.focus();
  </script>
  </body>
  </html>
  `;

  await fs.writeFile(path.join(ROOT, 'ask.html'), html, 'utf8');
  console.log(`AI 辅助叙述模块页已生成：ask.html（${(Buffer.byteLength(html) / 1024).toFixed(1)} KiB）`);
  console.log(`  语料 ${corpus.chunks.length} 段 · 索引词项 ${index.idf.size} · 实体词表 ${index.entities.size}`);
  console.log(`  边界测试 ${probesPassed}/${probes.length} 通过`);
  for (const r of probeResults) {
    const mark = r.expect === r.actual ? '✓' : '✗';
    console.log(`    ${mark} 「${r.q}」 预期 ${r.expect === 'answer' ? '应答' : '应拒'} → 实际 ${r.actual === 'answer' ? '作答' : '拒答'}${r.reason ? '（' + r.reason + '）' : ''}`);
  }
};

/** 直接执行本文件时才跑主流程。 */
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await runGen();
