#!/usr/bin/env node
/**
 * AI 辅助叙述模块的边界测试（独立可跑，也可被构建流程调用）。
 *
 * 断言"该答的答、该拒的拒"。这是模块④的可验证性证据，
 * 也是本项目在这个闸门上连错四次之后的回归防线——详见 src/ask-probes.js 的注释。
 *
 * 用法：node scripts/check-ask.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, decide } from '../src/retrieval-core.js';
import { runProbes } from '../src/ask-probes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function runCheck() {
  const corpus = JSON.parse(await fs.readFile(path.join(ROOT, 'src/data/knowledge-corpus.json'), 'utf8'));
  const index = buildIndex(corpus.chunks);
  const report = runProbes(decide, index);

  const lines = [];
  lines.push('─'.repeat(72));
  lines.push('▌ AI 辅助叙述模块 · 边界测试');
  lines.push('─'.repeat(72));
  lines.push(`  语料 ${corpus.chunks.length} 段 · 索引词项 ${index.idf.size} · 实体词表 ${index.entities.size}`);
  lines.push('');
  for (const [group, stat] of Object.entries(report.byGroup)) {
    lines.push(`  ${group.padEnd(14)} ${String(stat.pass).padStart(3)} / ${String(stat.total).padEnd(3)} ${stat.pass === stat.total ? '✓' : '✗'}`);
  }
  lines.push('');
  lines.push(`  合计 ${report.passed} / ${report.total}`);
  const failures = report.results.filter(r => !r.pass);
  if (failures.length) {
    lines.push('');
    lines.push('  未通过用例：');
    for (const f of failures) {
      lines.push(`    ✗ 「${f.q}」 预期 ${f.expect} → 实际 ${f.actual}${f.reason ? '（' + f.reason + '）' : ''}`);
    }
  } else {
    lines.push('  ✓ 全部用例通过');
  }
  console.log(lines.join('\n'));

  if (failures.length) {
    throw new Error(`AI 边界测试未通过：${failures.length} / ${report.total} 用例失败`);
  }
  return report;
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await runCheck();
