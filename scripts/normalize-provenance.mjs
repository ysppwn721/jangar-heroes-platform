/**
 * 一次性数据校正：把"核对计划"与"已核对"严格分开。
 *
 * 背景：知识图谱数据集里 6 个节点带 reviewedBy = 道尔吉·尼玛（传承人），
 * 但其中 5 个 reviewStatus 仍是"待核对"——即核对**尚未发生**。
 * 参赛材料有硬性要求「如实区分已完成内容、测试内容和计划内容」，
 * 把一个人的名字写在 reviewedBy 字段里，外部读起来就是"已由该传承人核对"，
 * 属于把计划写成了成果。这个风险必须消除。
 *
 * 处理方式：
 *   - reviewedBy 一律置 null（表示"尚未核对"）
 *   - 计划信息迁到 reviewPlan 字段（明确命名，不会被误读为已完成）
 *   - provenance 层不丢失任何信息，只是把"计划"和"事实"分开
 *
 * 用法：node scripts/normalize-provenance.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(ROOT, 'src/data/jangar-graph.json');

const graph = JSON.parse(await fs.readFile(target, 'utf8'));
let migrated = 0;
const report = [];

for (const node of graph.nodes) {
  const prov = node.provenance;
  if (!prov) continue;

  if (prov.reviewedBy) {
    report.push({
      id: node.id,
      name: node.name,
      wasReviewedBy: prov.reviewedBy,
      reviewStatus: prov.reviewStatus,
    });
    // 计划 → 显式命名的计划字段；事实字段留空
    prov.reviewPlan = {
      plannedReviewer: prov.reviewedBy,
      status: '计划中，尚未实施',
      note: '本字段记录的是核对计划，不是已完成的核对结果。核对完成后应把结果写入 reviewedBy 与 reviewStatus。',
    };
    prov.reviewedBy = null;
    if (prov.reviewStatus === '已核对') {
      // 没有实际核对人就不能声称已核对
      prov.reviewStatus = '待核对';
      prov.reviewStatusNote = '原标「已核对」但无实际核对人记录，已按最保守口径改为「待核对」。';
    }
    migrated++;
  }
}

// 数据来源里那条"口头核对，待实施"的占位来源，同样要标清状态，避免被当成已发生
for (const source of graph.sources) {
  if (source.id === 'src-human-review-daorjhinima') {
    source.type = '访谈（计划中）';
    // reliability 必须留在校验脚本允许的取值域（高/中/低）内，否则 check-graph 会失败。
    // "尚未发生"这一事实用 note 表达，而不是塞进 reliability 枚举。
    source.reliability = '低';
    source.note = `【尚未发生，不得作为依据】${source.note || ''} 该来源为核对计划占位，数据集零引用。核对完成前不得作为依据。`;
  }
}

graph.meta.reviewPolicy = 'reviewedBy 仅在核对**实际完成**后填写；未完成时保持 null，计划写入 reviewPlan。'
  + 'reviewStatus 三态：已核对 / 待核对 / 存疑。凡无实际核对人者不得标「已核对」。';
graph.meta.provenanceNormalizedAt = new Date().toISOString();
graph.meta.provenanceNormalization = `将 ${migrated} 个节点的「核对计划」从 reviewedBy 迁至 reviewPlan，reviewedBy 置 null。`;

await fs.writeFile(target, JSON.stringify(graph, null, 2) + '\n', 'utf8');

console.log(`已校正：${migrated} 个节点的核对计划从 reviewedBy 迁至 reviewPlan`);
for (const row of report) {
  console.log(`  · ${row.name.padEnd(8)} (${row.id.padEnd(18)}) 原 reviewedBy=${row.wasReviewedBy.slice(0, 14)}… reviewStatus=${row.reviewStatus}`);
}
console.log('\n核对完成后应做的事：把实际结果写回 reviewedBy，并把 reviewStatus 改为「已核对」。');
console.log(`写入：src/data/jangar-graph.json`);
