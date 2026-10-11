#!/usr/bin/env node
/**
 * 把语料从"单一数据源"同步到网页端，并断言两端一致。
 *
 * 背景：小程序端 `utils/retrieval.js` 与本项目 `src/retrieval-core.js` 是同源实现，
 * 但语料（知识段落）此前只以生成产物形式存在于小程序里。这里把语料提到
 * **本仓库的单一数据源**（src/data/knowledge-corpus.json），并校验：
 *   ① 语料结构完整（id / title / text 齐全，id 不重复）
 *   ② 与小程序端已有的生成产物逐条一致（若路径可用）
 * 一致 → 说明两端确实共用同一套语料，跨端复用的主张可核验；
 * 不一致 → 报错，而不是让两端悄悄分叉。
 *
 * 用法：
 *   node scripts/sync-knowledge.mjs            校验并同步
 *   node scripts/sync-knowledge.mjs --check    只校验，不写文件
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

const LOCAL = path.join(ROOT, 'src/data/knowledge-corpus.json');
const MINIPROGRAM = process.env.MINIPROGRAM_ROOT || 'D:/WeChatProjects/miniprogram-7';
const MINI_KNOWLEDGE = path.join(MINIPROGRAM, 'miniprogram/data/knowledge.js');


/** 主流程：可被构建流程 import 调用，不杀进程。 */
export const runSync = async () => {
  const problems = [];
  const notes = [];

  /** 从小程序端的生成产物里取语料：它是 `const KNOWLEDGE = {...};` 形式，不是纯 JSON。 */
  async function readMiniCorpus() {
    const source = await fs.readFile(MINI_KNOWLEDGE, 'utf8');
    // 定位对象字面量的真实起点与终点：文件末尾可能还有导出语句或注释，
    // 直接取第一个 { 和最后一个 } 会把注释内容一起吞掉（实际踩过）。
    const anchor = source.indexOf('const KNOWLEDGE');
    const start = source.indexOf('{', anchor < 0 ? 0 : anchor);
    if (start < 0) throw new Error('小程序端 knowledge.js 找不到对象字面量起点');
    // 括号配对扫描，找到与 start 匹配的收尾括号
    let depth = 0;
    let end = -1;
    let inString = false;
    let escaped = false;
    for (let i = start; i < source.length; i++) {
      const ch = source[i];
      if (inString) {
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) throw new Error('小程序端 knowledge.js 对象字面量未闭合');
    return JSON.parse(source.slice(start, end + 1));
  }

  function validate(corpus, label) {
    if (!corpus || !Array.isArray(corpus.chunks)) {
      problems.push(`${label}：缺少 chunks 数组`);
      return;
    }
    const seen = new Set();
    corpus.chunks.forEach((chunk, index) => {
      if (!chunk.id) problems.push(`${label}：第 ${index + 1} 段缺 id`);
      else if (seen.has(chunk.id)) problems.push(`${label}：id 重复 ${chunk.id}`);
      else seen.add(chunk.id);
      if (!chunk.title) problems.push(`${label}：${chunk.id || index} 缺 title`);
      if (!chunk.text) problems.push(`${label}：${chunk.id || index} 缺 text`);
      if (!Array.isArray(chunk.tags)) problems.push(`${label}：${chunk.id || index} 缺 tags 数组`);
    });
    return seen;
  }

  let local;
  try {
    local = JSON.parse(await fs.readFile(LOCAL, 'utf8'));
  } catch {
    local = null;
    notes.push('本仓库尚无 src/data/knowledge-corpus.json，将从小程序端同步一份。');
  }

  let mini = null;
  try {
    mini = await readMiniCorpus();
  } catch (error) {
    notes.push(`未读到小程序端语料（${path.relative(ROOT, MINI_KNOWLEDGE)}）：${error.code || error.message}`);
  }

  const source = local || mini;
  if (!source) {
    console.error('两端都没有可用语料，无法同步。');
    throw new Error('校验或生成未通过');
  }

  validate(source, local ? '本仓库语料' : '小程序端语料');
  const localIds = local ? validate(local, '本仓库语料') : null;
  const miniIds = mini ? validate(mini, '小程序端语料') : null;

  /* 两端一致性断言：这是"跨端复用同一套语料"的可核验证据 */
  let comparison = '未比对（缺少一端）';
  if (local && mini) {
    const localById = new Map(local.chunks.map(c => [c.id, c]));
    const miniById = new Map(mini.chunks.map(c => [c.id, c]));
    const onlyLocal = [...localById.keys()].filter(id => !miniById.has(id));
    const onlyMini = [...miniById.keys()].filter(id => !localById.has(id));
    if (onlyLocal.length) problems.push(`仅存在于本仓库的语料段：${onlyLocal.join(', ')}`);
    if (onlyMini.length) problems.push(`仅存在于小程序端的语料段：${onlyMini.join(', ')}`);
    let differing = 0;
    for (const [id, chunk] of localById) {
      const other = miniById.get(id);
      if (!other) continue;
      if (chunk.text !== other.text) { differing++; problems.push(`语料正文不一致：${id}`); }
    }
    comparison = `两端各 ${local.chunks.length} 段，逐条比对：仅本仓库 ${onlyLocal.length} 段、仅小程序端 ${onlyMini.length} 段、正文差异 ${differing} 段`;
  }

  /* 输出一份网页端可直接 import 的语料 */
  const payload = {
    version: source.version || 1,
    generatedAt: new Date().toISOString(),
    origin: mini ? 'miniprogram:miniprogram/data/knowledge.js' : 'local',
    generator: 'scripts/sync-knowledge.mjs',
    note: '由单一数据源同步。两端共用同一套语料与同一套检索实现（src/retrieval-core.js ↔ 小程序 utils/retrieval.js）。',
    chunkCount: source.chunks.length,
    chunks: source.chunks,
  };

  console.log('语料同步检查');
  console.log('='.repeat(70));
  console.log(`本仓库：${local ? local.chunks.length + ' 段' : '（无）'}`);
  console.log(`小程序端：${mini ? mini.chunks.length + ' 段' : '（不可读）'}`);
  console.log(`比对结果：${comparison}`);
  for (const note of notes) console.log(`备注：${note}`);

  if (problems.length) {
    console.error('\n✗ 校验失败：');
    for (const problem of problems) console.error(`   - ${problem}`);
    throw new Error('校验或生成未通过');
  }
  if (local && mini) {
    console.log('\n✓ 校验通过：语料结构完整，两端逐条一致。');
  } else {
    console.log('\n✓ 校验通过：语料结构完整。');
    console.log('  ⚠ 本次只比对了单端——另一端不可读，因此「跨端一致」这一主张本次未被验证。');
  }

  if (!checkOnly) {
    await fs.mkdir(path.dirname(LOCAL), { recursive: true });
    await fs.writeFile(LOCAL, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    console.log(`已写出：${path.relative(ROOT, LOCAL)}（${(Buffer.byteLength(JSON.stringify(payload)) / 1024).toFixed(1)} KiB）`);
  }
};

/** 直接执行本文件时才跑主流程。 */
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await runSync();
