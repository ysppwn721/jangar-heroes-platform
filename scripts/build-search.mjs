#!/usr/bin/env node
/**
 * 生成站内搜索索引（方案 A：内容定位）。
 *
 * 设计取舍（每一条都是踩过坑之后的选择）：
 *
 * ① **索引在建站时生成，不在浏览器里现算**。
 *    html → 记录 → 内容哈希文件名，这条链已经跑通；搜索索引走同一条路，
 *    浏览器拿到的就是一个 static 模块，零解析开销、进离线预缓存。
 *
 * ② **索引源 = 页面真实内容**，而不是另写一份数据。
 *    否则"介绍改了、搜索还是旧的"必然发生（英雄名录就是这么分叉过一次）。
 *    正文从 index.html 抽，英雄从 src/heroes.js 抽 —— 都是已经存在的真源。
 *
 * ③ **别名（tags）来自讲解员语料**。
 *    讲解员那 32 段语料里带 tags，天生就是观众的口语说法
 *    （"多少人""怎么去""怎么玩"）。这正是搜索最缺的东西；
 *    直接复用，就不必再手写一套同义词。
 *
 * ④ **target 必须指向真实存在的锚点**。
 *    生成时逐个校验；锚点没了就报错，而不是让搜索结果点过去没反应。
 *
 * 用法：node scripts/build-search.mjs
 * 产物：src/search-index.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const HTML = 'index.html';
const OUT = path.join('src', 'search-index.js');
/* 讲解员语料（含 tags）：默认取本机小程序项目里的那一份，可用环境变量覆盖 */
const KNOWLEDGE = process.env.KNOWLEDGE_MODULE
  || 'D:/WeChatProjects/miniprogram-7/cloudfunctions/ask/data/knowledge.js';

const html = fs.readFileSync(HTML, 'utf8');

/** 去标签取纯文本（保留中文标点用于分句） */
const strip = text => text
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (all, code) => String.fromCharCode(Number(code)))
  .replace(/\s+/g, ' ')
  .trim();

/** 页面上真实存在、可跳转的锚点 */
const anchors = new Set([...html.matchAll(/id="([a-zA-Z0-9_-]+)"/g)].map(m => m[1]));

/** 抽出每个 <section id="…"> 的标题与正文 */
function extractSections() {
  const sections = [];
  const re = /<section id="([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/section>/g;
  for (const match of html.matchAll(re)) {
    const [, id, inner] = match;
    const heading = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(inner);
    const intro = /class="section-intro"[^>]*>([\s\S]*?)<\/p>/.exec(inner);
    const eyebrow = /class="eyebrow"[^>]*>([\s\S]*?)<\/p>/.exec(inner);
    const body = strip(inner).replace(/\s+/g, ' ');
    sections.push({
      id,
      // 保留原始 h2 但不当搜索标题用：它是**装饰性文案**（如"每一位英雄，都是一段传奇。"），
      // 拿它当标题会让搜索结果里出现一句不像标题的话（实测踩过）
      heading: heading ? strip(heading[1]) : '',
      eyebrow: eyebrow ? strip(eyebrow[1]) : '',
      text: [intro ? strip(intro[1]) : '', body].filter(Boolean).join(' ').slice(0, 900),
    });
  }
  return sections;
}

/** 叙事长卷的四个页签（它们不是 <section>，单独收） */
function extractChapters() {
  const chapters = [];
  for (const match of html.matchAll(/<button id="chapter-tab-(\d+)"[^>]*aria-controls="(chapter-panel-\d+)"[^>]*>([\s\S]*?)<\/button>/g)) {
    const [, index, panelId, label] = match;
    const panel = new RegExp(`<article id="${panelId}"[\\s\\S]*?</article>`).exec(html);
    chapters.push({
      id: panelId,
      index: Number(index),
      // 页签文字里带装饰箭号与英文副题，去掉后才像"标题"（否则搜索结果显示成「壹 理想之地 ↗」）
      title: strip(label)
        .replace(/THE (HOMELAND|GUARDIAN|FELLOWSHIP|RETURN)/gi, '')
        .replace(/[↗→]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
      text: panel ? strip(panel[0]).slice(0, 600) : '',
    });
  }
  return chapters;
}

/** 问答小节（问句本身就是最好的搜索关键词） */
function extractQuiz() {
  const quiz = [];
  /* 问答小节的 section-intro 当作正文：问句本身没有正文，
   * 但搜索结果需要一句可读的摘要，否则会出现"标题有、正文空"的记录 */
  const quizIntro = /<div class="section-heading">[\s\S]*?id="discover"[\s\S]*?class="section-intro">([\s\S]*?)<\/p>/.exec(html);
  const fallback = quizIntro ? strip(quizIntro[1]) : '回望刚刚走过的展馆，答错也没关系。';
  for (const match of html.matchAll(/<h3 id="quiz-question">([\s\S]*?)<\/h3>/g)) {
    quiz.push({ id: 'quiz', title: strip(match[1]), text: fallback });
  }
  // 参观说明里的 <details> 标题（这些问句就是观众真会问的）
  for (const match of html.matchAll(/<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)) {
    quiz.push({ id: 'discover', title: strip(match[1]), text: strip(match[2]).slice(0, 300) });
  }
  return quiz;
}

/** 别名：讲解员语料的 tags 天生就是"观众会怎么问"。
 *  直接用 require 加载那个 CommonJS 模块 —— 不要截字符串再 JSON.parse：
 *  语料文件里有注释与尾随分号，截取法会解析失败（实测踩过）。 */
function loadAliases() {
  if (!fs.existsSync(KNOWLEDGE)) {
    console.warn(`⚠️  读不到讲解员语料（${KNOWLEDGE}），别名将为空 —— 换个说法可能搜不到。`);
    return { byId: new Map(), all: [] };
  }
  const { KNOWLEDGE: corpus } = createRequire(import.meta.url)(path.resolve(KNOWLEDGE));
  const chunks = corpus.chunks || [];
  const byId = new Map(chunks.map(chunk => [chunk.id, chunk]));
  const all = [...new Set(chunks.flatMap(chunk => chunk.tags || []))];
  return { byId, all };
}

const sections = extractSections();
const chapters = extractChapters();
const quiz = extractQuiz();
const { byId } = loadAliases();

// 英雄从既有真源来（不另写一份）
const { heroes } = await import('../src/heroes.js');

const records = [];
const problems = [];

/* ---------- 一、英雄 ---------- */
/* 别名只收"观众可能用来找他的词"。
 * ⚠️ 不要把**头衔类**说法当别名收进来（如「宝木巴的圣主」「宝木巴的守护者」）：
 * 它们出现在别名里，会让搜「宝木巴」时英雄卡片拿到和"专门讲宝木巴的那一节"同样的加权，
 * 而英雄正文短、词频密度天然更高 —— 结果专题章节被挤到后面（实测踩过）。
 * 头衔留在正文里（照样能被搜到），但不参与"主题词"加权。 */
const EPITHET_PREFIX = /^(宝木巴|草原|史诗)(的|之)/;
for (const hero of heroes) {
  const known = byId.get(`hero-${hero.slug}`);
  const aliases = [...new Set([hero.name, hero.roster?.role || '', hero.title.split('/')[1] || '', ...(known?.tags || [])].filter(Boolean))]
    .filter(alias => !EPITHET_PREFIX.test(alias));
  records.push({
    id: `hero-${hero.slug}`,
    kind: 'hero',
    title: `${hero.name} · ${hero.title}`,
    text: `${hero.description} 设计要点：${(hero.features || []).join('、')}。${hero.roster?.role || ''}`,
    target: { hero: hero.slug },
    aliases,
  });
}

/* ---------- 二、讲述型章节（有正文的 section） ---------- */
/* 这张表把"页面上那块内容"翻译成"观众会用什么词找它"。
 * 左侧标题用于结果展示（要像标题），右侧别名用于检索（要像人话）。
 * ⚠️ 新增 section 时必须在这里补一行，否则它会**根本不进索引** ——
 * 实测踩过：「探索问答」漏登记，于是"多少个英雄"搜不到那一节，只召回一堆英雄卡片。 */
const NARRATIVE = {
  home: ['数字展馆', '进馆、总览、开始参观、怎么看模型、旋转、缩放'],
  heroes: ['十二英雄图鉴', '英雄卡片、收藏、特别典藏、英雄群像、有哪些英雄、全部英雄'],
  epic: ['走进江格尔', '史诗是什么、江格尔是谁、宝木巴是什么、宝木巴在哪里、理想家园、讲的是什么'],
  versions: ['同一部史诗不止一种说法', '版本差异、名字为什么不同、传承、座次、几种名字'],
  stories: ['史诗长卷', '关于家园、勇气、伙伴、和平'],
  'living-epic': ['口传心授', '江格尔齐、演唱、口头传承、怎么唱、谁在唱'],
  motifs: ['纹样解读', '云纹、边饰、色彩、袍摆、纹样是什么意思'],
  craft: ['非遗新生', '文创、设计、周边、产品'],
  discover: ['探索问答与参观说明', '答题、小问答、参观说明、怎么玩、多少个英雄、多少位英雄、几个人、怎么去、怎么去展馆、参观、参观说明、在哪、收藏在哪、网络不好'],
};
for (const section of sections) {
  const mapped = NARRATIVE[section.id];
  const title = mapped ? mapped[0] : (section.heading || section.id);
  const aliases = mapped ? mapped[1].split('、') : [];
  records.push({
    id: section.id,
    kind: 'section',
    title,
    text: [section.eyebrow, section.heading, section.text].filter(Boolean).join(' ').slice(0, 800),
    target: { anchor: section.id },
    aliases,
  });
}

/* ---------- 三、四章叙事长卷 ---------- */
for (const chapter of chapters) {
  const known = byId.get(chapter.id);
  records.push({
    id: chapter.id,
    kind: 'chapter',
    title: `史诗长卷 · ${chapter.title}`,
    text: chapter.text.slice(0, 500),
    target: { anchor: 'stories', chapter: chapter.index },
    aliases: [...new Set([...chapter.title.split('·').map(s => s.trim()), ...(known?.tags || [])].filter(Boolean))],
  });
}

/* ---------- 四、问答与参观说明 ---------- */
for (const item of quiz) {
  records.push({
    id: `qa-${records.length}`,
    kind: 'qa',
    title: item.title,
    text: item.text.slice(0, 400),
    target: { anchor: 'discover' },
    aliases: [],
  });
}

/* ---------- 五、纹样（有 hero 关联的卡片） ---------- */
for (const match of html.matchAll(/<p class="eyebrow">(\d+) \/ ([^<]+)<\/p><h3>([\s\S]*?)<\/h3>/g)) {
  const [, index, name, title] = match;
  const known = (byId.get('motif-cloud')?.tags || []);
  records.push({
    id: `motif-${index}`,
    kind: 'motif',
    title: `纹样 · ${strip(name)}`,
    text: strip(title),
    target: { anchor: 'motifs' },
    aliases: index === '01' ? known : [],
  });
}

/* 兜底：任何 section 都必须在 NARRATIVE 里登记。
 * 漏登记的后果不是"标题不好看"，而是**它根本不进索引、观众搜不到**（实测踩过）。 */
const unregistered = sections.filter(section => !NARRATIVE[section.id]).map(section => section.id);
if (unregistered.length) problems.push(`以下 section 未在 NARRATIVE 登记，将不会进索引：${unregistered.join(', ')}`);

/* ---------- 校验 ---------- */
for (const record of records) {
  if (record.target.anchor && !anchors.has(record.target.anchor)) {
    problems.push(`${record.id} 指向不存在的锚点 #${record.target.anchor}`);
  }
  if (record.target.hero && !heroes.some(hero => hero.slug === record.target.hero)) {
    problems.push(`${record.id} 指向不存在的英雄 ${record.target.hero}`);
  }
  if (!record.title || !record.text) problems.push(`${record.id} 标题或正文为空`);
}
const emptyText = records.filter(record => record.text.length < 10);
if (emptyText.length) problems.push(`${emptyText.length} 条记录正文过短：${emptyText.map(r => r.id).join(', ')}`);

if (problems.length) {
  console.error(`❌ 搜索索引有 ${problems.length} 处问题：`);
  for (const problem of problems) console.error(`   · ${problem}`);
  process.exit(1);
}

/* ---------- 输出 ---------- */
const byKind = records.reduce((accumulator, record) => {
  accumulator[record.kind] = (accumulator[record.kind] || 0) + 1;
  return accumulator;
}, {});
const output = `/**
 * 站内搜索索引 —— ⚠️ **本文件由脚本生成，请勿手改**
 *
 * 生成命令：node scripts/build-search.mjs
 * 真源：index.html（章节正文/纹样/参观说明）+ src/heroes.js（英雄）+ 讲解员语料（口语化别名）
 * 记录数：${records.length}（${Object.entries(byKind).map(([kind, count]) => `${kind} ${count}`).join(' / ')}）
 *
 * \`target\` 指向页面真实存在的锚点或英雄 slug，构建时逐个校验过。
 * \`aliases\` 是"观众换个说法也能搜到"的部分，来自讲解员语料的 tags。
 */
export const searchRecords = ${JSON.stringify(records, null, 2)};
`;
fs.writeFileSync(OUT, output, 'utf8');

console.log(`✅ 已生成 ${OUT}：${records.length} 条记录（${(output.length / 1024).toFixed(1)} KB）`);
console.log(`   分类：${Object.entries(byKind).map(([kind, count]) => `${kind} ${count}`).join(' / ')}`);
const aliasCount = records.reduce((sum, record) => sum + record.aliases.length, 0);
console.log(`   别名：${aliasCount} 条（来自讲解员语料 tags 与英雄称号）`);
console.log(`   锚点校验：全部指向真实存在的锚点 ✅`);
