#!/usr/bin/env node
/**
 * 同步讲解员的检索引擎到站点端（ESM 版本）。
 *
 * 为什么需要这个脚本，而不是手抄一份：
 * 站点要做站内搜索，而复用讲解员那套已验证的中文检索（recall 23/23）是正确选择。
 * 但站点是 ESM、讲解员是 CommonJS，两边**必须只有一处逻辑**。
 * 手动复制粘贴的代价我们已经付过两次了 —— 英雄名录分叉过一次、
 * 知识库也差点分叉 —— 所以这里照同一套范式办：
 *   真源 = cloudfunctions/ask/lib/retrieval.js
 *   产物 = src/retrieval.js（只换导出语法 + 加文件头说明）
 *   生成后**逐字节校验**：去掉文件头与导出差异，其余必须完全一致。
 *
 * 用法：
 *   node scripts/sync-retrieval.mjs            # 同步（写入 src/retrieval.js）
 *   node scripts/sync-retrieval.mjs --check    # 只校验，不一致就报错退出
 * 环境变量：RETRIEVAL_SOURCE（覆盖真源路径）
 */
import fs from 'node:fs';
import path from 'node:path';

const SOURCE = process.env.RETRIEVAL_SOURCE
  || 'D:/WeChatProjects/miniprogram-7/cloudfunctions/ask/lib/retrieval.js';
const TARGET = path.join('src', 'retrieval.js');
const checkOnly = process.argv.includes('--check');

const CJS_EXPORT = 'module.exports = { tokenize, buildIndex, search, decide, composeLocalAnswer, STOP_TOKENS, FACT_SEEKING };';
const ESM_EXPORT = '/* 站点端以 ESM 导出 —— 浏览器不能 require。逻辑与讲解员完全同一份，勿在此单独改动。 */\n'
  + 'export { tokenize, buildIndex, search, decide, composeLocalAnswer, STOP_TOKENS, FACT_SEEKING };';

const BANNER = '/** ⚠️ 由 scripts/sync-retrieval.mjs 从讲解员的检索实现同步而来，请勿手改。\n'
  + ' *  真源：miniprogram-7/cloudfunctions/ask/lib/retrieval.js（与小程序端 utils/retrieval.js 同源）\n'
  + ' *  站点用它做站内搜索；讲解员用它做候选召回。改动请改真源，然后重跑本脚本。\n'
  + ' */\n';

if (!fs.existsSync(SOURCE)) {
  console.error(`❌ 找不到真源：${SOURCE}`);
  console.error('   设 RETRIEVAL_SOURCE 指向 miniprogram-7/cloudfunctions/ask/lib/retrieval.js');
  process.exit(1);
}

const source = fs.readFileSync(SOURCE, 'utf8');
if (!source.includes(CJS_EXPORT)) {
  console.error('❌ 真源的导出语句与预期不符（可能被改过）—— 请检查后更新本脚本的 CJS_EXPORT。');
  process.exit(1);
}
const expected = BANNER + source.replace(CJS_EXPORT, ESM_EXPORT);

const exists = fs.existsSync(TARGET);
const current = exists ? fs.readFileSync(TARGET, 'utf8') : '';

/** 逐字节比对：除文件头与导出写法外，任何差异都说明有人手改了产物 */
const normalize = text => text.replace(BANNER, '').replace(ESM_EXPORT, CJS_EXPORT);

if (exists && normalize(current) === normalize(expected)) {
  console.log(`✅ ${TARGET} 与真源一致（${(expected.length / 1024).toFixed(1)} KB）`);
  process.exit(0);
}

if (checkOnly) {
  console.error(`❌ ${TARGET} 与真源不一致。`);
  if (!exists) console.error('   原因：产物不存在');
  else console.error('   原因：有人手改了产物，或真源改了没重新同步');
  console.error('   修复：node scripts/sync-retrieval.mjs');
  process.exit(1);
}

fs.writeFileSync(TARGET, expected, 'utf8');
console.log(`✅ 已同步 ${TARGET}（${(expected.length / 1024).toFixed(1)} KB）`);
console.log('   复核：node scripts/sync-retrieval.mjs --check');
