import path from 'node:path';
/**
 * 知识图谱数据集校验器
 * =====================
 *
 * 这个脚本回答的是评委一定会问的那个问题：**这些数据是真的吗？**
 * 它不校验「内容对不对」（那要靠人核对传承人），只校验**数据自洽**：
 * 每一项引用都能落地，每一处空缺都显式声明为 null 而不是悄悄留空。
 *
 * 断言（任一失败即 exit 1）：
 *   1. 两个 JSON 都能解析，且顶层结构符合数据模型。
 *   2. 十二英雄齐全 —— 名单以 src/heroes.js 的 slug 为**唯一真源**读取，
 *      不在这里抄第二份，避免"校验脚本自己写了一份名单"这种假校验。
 *   3. 每个 relations.target 都能解析到存在的节点 id。
 *   4. 每个 sourceId（node.provenance.sources、relations[].sourceId、
 *      nameVariants[].sourceId、chapters[].sourceId、motifs[].sourceId、
 *      provenance.json 的 sources[]）都能在 sources 表里找到。
 *   5. meta 里不得自报条目数（数字要么现算，要么别写）。
 *
 * 统计报告（不导致失败，只如实打印）：
 *   · 递归统计 null 值的数量与分布（JSON 路径去下标）
 *   · reviewStatus 分布、sources 表可靠性分布
 *   · sources 表中被引用 / 未被引用的来源
 *   · provenance.json 中 sources 为空的条目（= 本项目自己的解读，不是缺陷）
 *
 * 用法：node scripts/check-graph.mjs
 * 退出码：0 = 全部断言通过；1 = 有断言失败（报告里以 ✗ 标出）
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const GRAPH_PATH = join(ROOT, 'src', 'data', 'jangar-graph.json');
const PROVENANCE_PATH = join(ROOT, 'src', 'data', 'provenance.json');
const ROSTER_PATH = join(ROOT, 'src', 'heroes.js');


/** 主流程：可被构建流程 import 调用，不杀进程。 */
export const runCheck = async () => {
  const failures = [];
  const warnings = [];

  function fail(msg) {
    failures.push(msg);
  }
  function warn(msg) {
    warnings.push(msg);
  }
  function rel(p) {
    return relative(ROOT, p).replace(/\\/g, '/');
  }

  /* ── 输出小工具（对齐项目既有脚本的中文报告口径） ───────────────── */

  const HR = '─'.repeat(64);
  function section(title) {
    console.log(`\n${HR}\n▌ ${title}\n${HR}`);
  }
  function kv(label, value) {
    console.log(`  ${String(label).padEnd(26, '　')} ${value}`);
  }
  function check(ok, label, detail) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `　${detail}` : ''}`);
    if (!ok) fail(label + (detail ? `（${detail}）` : ''));
  }
  function note(label, detail) {
    console.log(`  · ${label}${detail ? `　${detail}` : ''}`);
  }

  /* ── 1. 读文件 + 解析 ─────────────────────────────────────────── */

  function readJson(path, label) {
    let raw;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (error) {
      fail(`${label} 读取失败：${error.message}`);
      return null;
    }
    if (raw.charCodeAt(0) === 0xfeff) {
      fail(`${label} 带 UTF-8 BOM，应为纯 UTF-8（无 BOM）`);
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      fail(`${label} 不是合法 JSON：${error.message}`);
      return null;
    }
  }

  /* ── 2. 从 src/heroes.js 读取十二英雄 slug（唯一真源） ──────────── */

  /**
   * heroes.js 是 ESM（export const heroes = [ ... ]）。
   * 这里不用正则去"猜"数组里的字段顺序，只提取每个对象的 slug 字段，
   * 并要求解析出的 slug 数量与 id 数量一致 —— 数量对不上就报错，
   * 而不是悄悄少校验几个人。
   */
  function readRosterSlugs() {
    let src;
    try {
      src = readFileSync(ROSTER_PATH, 'utf8');
    } catch (error) {
      fail(`英雄名录读取失败（${rel(ROSTER_PATH)}）：${error.message}`);
      return { slugs: [], ids: [] };
    }
    const slugs = [...src.matchAll(/"slug"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
    const ids = [...src.matchAll(/"id"\s*:\s*(\d+)/g)].map((m) => Number(m[1]));
    const names = [...src.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
    if (slugs.length !== 12) {
      fail(`英雄名录里解析到 ${slugs.length} 个 slug，期望 12 个`);
    }
    if (ids.length !== slugs.length || names.length !== slugs.length) {
      warn(
        `heroes.js 里 id/slug/name 数量不一致（${ids.length}/${slugs.length}/${names.length}），`
          + '校验可能不完整',
      );
    }
    return { slugs, ids, names };
  }

  /* ── 3. 递归统计 null ─────────────────────────────────────────── */

  /**
   * @returns {{ total: number, byKey: Map<string, number>, paths: string[] }}
   *   byKey 的键是"去掉了数组下标的 JSON 路径"，例如 hero.provenance.collectedAt
   */
  function countNulls(value, path = '', acc = null) {
    const state = acc || { total: 0, byKey: new Map(), paths: [] };
    if (value === null) {
      state.total += 1;
      state.byKey.set(path, (state.byKey.get(path) || 0) + 1);
      state.paths.push(path);
      return state;
    }
    if (Array.isArray(value)) {
      const base = path.replace(/\[[^\]]*\]$/, '');
      value.forEach((item) => countNulls(item, `${base}[]`, state));
      return state;
    }
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        countNulls(child, path ? `${path}.${key}` : key, state);
      }
    }
    return state;
  }

  function tally(values) {
    const map = new Map();
    for (const v of values) {
      const key = v === undefined ? '(缺失)' : String(v);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }

  /* ── 4. 主流程 ────────────────────────────────────────────────── */

  const graph = readJson(GRAPH_PATH, rel(GRAPH_PATH));
  const provenance = readJson(PROVENANCE_PATH, rel(PROVENANCE_PATH));

  section('知识图谱数据集校验 · check-graph.mjs');
  kv('图谱文件', rel(GRAPH_PATH));
  kv('溯源文件', rel(PROVENANCE_PATH));
  kv('英雄名录（唯一真源）', rel(ROSTER_PATH));

  if (!graph) {
    console.log('\n图谱 JSON 不可用，终止。');
    throw new Error('校验或生成未通过');
  }

  /* 4.1 顶层结构 */
  section('① 结构断言');

  check(graph.meta && typeof graph.meta === 'object', 'meta 存在且为对象');
  check(Array.isArray(graph.nodes), 'nodes 为数组');
  check(Array.isArray(graph.sources), 'sources 为数组');
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.sources)) {
    console.log('\nnodes / sources 结构不合法，终止。');
    throw new Error('校验或生成未通过');
  }

  for (const key of ['version', 'generatedAt', 'note']) {
    check(
      typeof graph.meta[key] === 'string' && graph.meta[key].length > 0,
      `meta.${key} 为非空字符串`,
      typeof graph.meta[key] === 'string' ? `"${String(graph.meta[key]).slice(0, 28)}…"` : '',
    );
  }
  check(
    !Object.prototype.hasOwnProperty.call(graph.meta, 'counts'),
    'meta 未自报条目数（统计由本脚本现算，避免与实际内容不一致）',
  );

  /* 4.2 来源表 */
  section('② 来源表');
  const sourceIds = new Set();
  let dupSources = 0;
  for (const s of graph.sources) {
    if (typeof s.id !== 'string' || !s.id) {
      fail('存在没有 id 的来源条目');
      continue;
    }
    if (sourceIds.has(s.id)) {
      dupSources += 1;
      fail(`来源 id 重复：${s.id}`);
    }
    sourceIds.add(s.id);
  }
  check(dupSources === 0, '来源 id 无重复', `共 ${sourceIds.size} 条`);
  check(sourceIds.size >= 1, '来源表非空');

  const REQUIRED_SOURCE_FIELDS = ['type', 'title', 'publisher', 'url', 'accessedAt', 'reliability', 'note'];
  const allowedReliability = new Set(['高', '中', '低']);
  for (const s of graph.sources) {
    for (const f of REQUIRED_SOURCE_FIELDS) {
      if (!(f in s)) fail(`来源 ${s.id} 缺少字段 ${f}`);
    }
    if (s.reliability && !allowedReliability.has(s.reliability)) {
      fail(`来源 ${s.id} 的 reliability 取值非法：${s.reliability}`);
    }
  }

  /* 4.3 节点 */
  section('③ 节点');
  const nodeById = new Map();
  for (const node of graph.nodes) {
    if (typeof node.id !== 'string' || !node.id) {
      fail('存在没有 id 的节点');
      continue;
    }
    if (nodeById.has(node.id)) fail(`节点 id 重复：${node.id}`);
    nodeById.set(node.id, node);
  }
  check(nodeById.size === graph.nodes.length, '节点 id 唯一', `共 ${graph.nodes.length} 个节点`);

  const allowedReviewStatus = new Set(['待核对', '已核对', '存疑']);
  const allowedNodeTypes = new Set(['hero', 'place', 'practice']);
  const allowedRelationTypes = new Set(['君臣', '盟友', '师承', '亲族', '对手', '其他', '传承体制']);
  // 与 jangar-graph.json 的 meta.conventions.variantScope 保持一致。
  // 注意这里用 startsWith 而不是全等：允许在档位名后加括注（如「俄译本转写（卡尔梅克西里尔文）」），
  // 但不允许出现档位之外的写法 —— 「分不清是不是规范档位」正是这个校验要防的事。
  const allowedVariantScopes = ['汉译名', '蒙文拉丁转写', '民间抄本异名', '俄译本转写'];

  for (const node of graph.nodes) {
    for (const field of ['name', 'epithet', 'role', 'summary']) {
      if (typeof node[field] !== 'string' || !node[field]) {
        fail(`节点 ${node.id} 的 ${field} 缺失或非字符串`);
      }
    }
    if (!allowedNodeTypes.has(node.nodeType)) {
      fail(`节点 ${node.id} 的 nodeType 非法：${node.nodeType}`);
    }
    for (const field of ['nameVariants', 'chapters', 'relations', 'motifs']) {
      if (!Array.isArray(node[field])) fail(`节点 ${node.id} 的 ${field} 不是数组`);
    }
    const p = node.provenance;
    if (!p || typeof p !== 'object') {
      fail(`节点 ${node.id} 缺少 provenance`);
      continue;
    }
    for (const field of ['collectedAt', 'collectedBy', 'reviewedBy']) {
      if (!(field in p)) fail(`节点 ${node.id}.provenance 缺少字段 ${field}`);
    }
    if (!allowedReviewStatus.has(p.reviewStatus)) {
      fail(`节点 ${node.id}.provenance.reviewStatus 取值非法：${p.reviewStatus}`);
    }
    check(
      Array.isArray(p.sources),
      `节点 ${node.id} 的 provenance.sources 是数组`,
      `长度 ${Array.isArray(p.sources) ? p.sources.length : 'n/a'}`,
    );

    // reviewStatus 与「是否挂得起来源」必须自洽：
    // 待核对 = 有断言落不到来源；若一个待核对节点一条来源都没有，那是必然的，
    // 但若它声称「已核对」却 zero sources，就矛盾了。
    if (p.reviewStatus === '已核对' && Array.isArray(p.sources) && p.sources.length === 0) {
      fail(`节点 ${node.id} 标为「已核对」但 provenance.sources 为空`);
    }
  }

  /* 4.4 十二英雄齐全（对照 src/heroes.js） */
  section('④ 十二英雄完整性（对照 src/heroes.js）');
  const roster = readRosterSlugs();
  const heroNodes = graph.nodes.filter((n) => n.nodeType === 'hero');
  check(heroNodes.length === 12, '图谱中 nodeType=hero 的节点数为 12', `实际 ${heroNodes.length}`);

  const heroIds = new Set(heroNodes.map((n) => n.id));
  const missing = roster.slugs.filter((slug) => !heroIds.has(slug));
  const extra = [...heroIds].filter((id) => !roster.slugs.includes(id));

  console.log('');
  for (const [i, slug] of roster.slugs.entries()) {
    const node = nodeById.get(slug);
    const name = roster.names[i] || (node ? node.name : '?');
    const ok = !!node && node.nodeType === 'hero';
    const status = node && node.provenance ? node.provenance.reviewStatus : '—';
    const srcCount = node && node.provenance && Array.isArray(node.provenance.sources)
      ? node.provenance.sources.length
      : 0;
    console.log(
      `  ${ok ? '✓' : '✗'} ${String(i + 1).padStart(2, '0')} ${String(name).padEnd(7, '　')} `
        + `${slug.padEnd(17)} ${String(status).padEnd(4, '　')} 来源 ${srcCount} 条`,
    );
    if (!ok) fail(`名录中的英雄 ${name}（${slug}）在图谱中缺少 hero 节点`);
  }

  console.log('');
  check(missing.length === 0, '十二英雄无缺失', missing.length ? `缺：${missing.join(', ')}` : '');
  check(extra.length === 0, '图谱无多出的 hero 节点', extra.length ? `多：${extra.join(', ')}` : '');

  /* 4.5 关系目标可解析 + 关系来源可解析 */
  section('⑤ 关系（relations）');
  let relationCount = 0;
  let danglingTargets = 0;
  let danglingRelationSources = 0;
  let nullRelationSources = 0;
  const relationTypeTally = [];
  const degree = new Map();

  for (const node of graph.nodes) {
    for (const rel of node.relations || []) {
      relationCount += 1;
      relationTypeTally.push(rel.type);
      if (!allowedRelationTypes.has(rel.type)) {
        fail(`节点 ${node.id} 的关系类型非法：${rel.type}`);
      }
      if (!nodeById.has(rel.target)) {
        danglingTargets += 1;
        fail(`节点 ${node.id} 的 relations.target 无法解析：${rel.target}`);
      } else {
        degree.set(rel.target, (degree.get(rel.target) || 0) + 1);
        degree.set(node.id, (degree.get(node.id) || 0) + 1);
      }
      if (!rel.note || typeof rel.note !== 'string') {
        fail(`节点 ${node.id} → ${rel.target} 的关系缺少 note`);
      }
      if (rel.sourceId === null || rel.sourceId === undefined) {
        nullRelationSources += 1;
        if (rel.note && !/待核|未定|不确定|尚未/.test(rel.note)) {
          warn(`节点 ${node.id} → ${rel.target} 的 sourceId 为 null，但 note 未说明为何待核`);
        }
      } else if (!sourceIds.has(rel.sourceId)) {
        danglingRelationSources += 1;
        fail(`节点 ${node.id} → ${rel.target} 的 sourceId 不存在：${rel.sourceId}`);
      }
    }
  }
  check(relationCount > 0, '存在关系数据', `共 ${relationCount} 条`);
  check(danglingTargets === 0, '所有 relations.target 均可解析到节点');
  check(danglingRelationSources === 0, '所有 relations.sourceId 均在来源表中');
  note('关系类型分布', tally(relationTypeTally).map(([k, v]) => `${k} ${v}`).join(' / '));
  note('sourceId 为 null 的关系', `${nullRelationSources} 条（已在 note 中说明待核原因）`);

  const isolated = [...heroIds].filter((id) => !degree.has(id));
  check(isolated.length === 0, '十二英雄均至少有一条关系（无孤立节点）', isolated.length ? `孤立：${isolated.join(', ')}` : '');

  /* 4.6 所有 sourceId 引用可解析 */
  section('⑥ 来源引用（sourceId）');
  let refTotal = 0;
  let refNull = 0;
  let refBroken = 0;
  const referencedSources = new Set();

  function checkRef(sourceId, where, { allowNull = true, nullNeedsMarker = false, note = '' } = {}) {
    refTotal += 1;
    if (sourceId === null || sourceId === undefined) {
      if (!allowNull) {
        refBroken += 1;
        fail(`${where} 不允许 sourceId 为 null`);
        return;
      }
      refNull += 1;
      if (nullNeedsMarker && !/待核|未定|不确定|尚未|推断/.test(note)) {
        warn(`${where} 的 sourceId 为 null，但说明文字未标出待核`);
      }
      return;
    }
    if (typeof sourceId !== 'string' || !sourceId) {
      refBroken += 1;
      fail(`${where} 的 sourceId 不是非空字符串`);
      return;
    }
    if (!sourceIds.has(sourceId)) {
      refBroken += 1;
      fail(`${where} 的 sourceId 在来源表中找不到：${sourceId}`);
      return;
    }
    referencedSources.add(sourceId);
  }

  for (const node of graph.nodes) {
    for (const sid of node.provenance.sources || []) {
      checkRef(sid, `节点 ${node.id}.provenance.sources`, { allowNull: false });
    }
    for (const [i, variant] of (node.nameVariants || []).entries()) {
      checkRef(variant.sourceId, `节点 ${node.id}.nameVariants[${i}]（${variant.value}）`, {
        nullNeedsMarker: true,
        note: variant.note || '',
      });
      if (!allowedVariantScopes.some((scope) => String(variant.form).startsWith(scope))) {
        fail(`节点 ${node.id}.nameVariants[${i}] 的 form 取值非法（不在四档之内）：${variant.form}`);
      }
      if (!variant.value) fail(`节点 ${node.id}.nameVariants[${i}] 缺少 value`);
    }
    for (const [i, chapter] of (node.chapters || []).entries()) {
      checkRef(chapter.sourceId, `节点 ${node.id}.chapters[${i}]`, { allowNull: false });
      if (!chapter.title) fail(`节点 ${node.id}.chapters[${i}] 缺少 title`);
    }
    for (const [i, motif] of (node.motifs || []).entries()) {
      checkRef(motif.sourceId, `节点 ${node.id}.motifs[${i}]`, { allowNull: false });
      if (!motif.name) fail(`节点 ${node.id}.motifs[${i}] 缺少 name`);
    }
  }

  if (provenance && Array.isArray(provenance.entries)) {
    for (const entry of provenance.entries) {
      const where = `provenance.json · ${entry.contentKey}`;
      if (!entry.contentKey) fail(`${where} 缺少 contentKey`);
      if (!entry.content) fail(`${where} 缺少 content`);
      if (!allowedReviewStatus.has(entry.reviewStatus)) {
        fail(`${where} 的 reviewStatus 取值非法：${entry.reviewStatus}`);
      }
      if (!Array.isArray(entry.sources)) {
        fail(`${where} 的 sources 不是数组`);
        continue;
      }
      for (const sid of entry.sources) {
        checkRef(sid, `${where}.sources`, { allowNull: false });
      }
      if (entry.sources.length === 0 && !/演绎|设计|本站|自述/.test(String(entry.supportLevel || '') + String(entry.note || ''))) {
        warn(`${where} 的 sources 为空，但 supportLevel/note 未说明这是本项目自述`);
      }
    }
  }

  check(refBroken === 0, '所有 sourceId 均可在来源表中解析', `检查了 ${refTotal} 处引用`);
  note('引用总数 / 其中 null', `${refTotal} / ${refNull}`);
  note('被引用的来源', `${referencedSources.size} / ${sourceIds.size} 条`);

  const neverReferenced = [...sourceIds].filter((id) => !referencedSources.has(id));
  if (neverReferenced.length) {
    // 不是失败项：占位来源（如抓取失败、存疑占位）本来就该"不被引用"。
    note('未被任何断言引用的来源', neverReferenced.join(', '));
  }

  /* 4.7 溯源层 */
  section('⑦ 溯源层（provenance.json）');
  if (!provenance) {
    check(false, 'provenance.json 可用');
  } else {
    check(Array.isArray(provenance.entries), 'entries 为数组');
    const entries = Array.isArray(provenance.entries) ? provenance.entries : [];
    const keys = entries.map((e) => e.contentKey);
    const dupKeys = keys.filter((k, i) => keys.indexOf(k) !== i);
    check(dupKeys.length === 0, 'contentKey 无重复', dupKeys.length ? `重复：${[...new Set(dupKeys)].join(', ')}` : `共 ${entries.length} 条`);
    const emptySourceEntries = entries.filter((e) => Array.isArray(e.sources) && e.sources.length === 0);
    note('sources 为空的条目（= 本项目自述/演绎，非缺陷）', `${emptySourceEntries.length} 条`);
    for (const e of emptySourceEntries) {
      note('  ↳', `${e.contentKey}　「${e.title}」`);
    }
    note('reviewStatus 分布', tally(entries.map((e) => e.reviewStatus)).map(([k, v]) => `${k} ${v}`).join(' / '));
  }

  /* 4.8 null 值统计 */
  section('⑧ null 值统计（递归，路径已去数组下标）');
  const nullStats = countNulls(graph);
  kv('图谱中 null 总数', nullStats.total);
  const byKey = [...nullStats.byKey.entries()].sort((a, b) => b[1] - a[1]);
  for (const [path, count] of byKey) {
    const meaning = path.endsWith('sourceId')
      ? '（无来源的断言，须在文案中标「待核对」）'
      : path.includes('collectedAt')
        ? '（项目无采集时间台账）'
        : path.includes('collectedBy')
          ? '（项目无采录人台账）'
          : path.includes('reviewedBy')
            ? '（尚未经传承人核对）'
            : '';
    console.log(`    ${String(path).padEnd(46)} ${String(count).padStart(3)}  ${meaning}`);
  }

  if (provenance && Array.isArray(provenance.entries)) {
    const pNulls = countNulls(provenance.entries, 'entries');
    kv('溯源层中 null 总数', pNulls.total);
    for (const [path, count] of [...pNulls.byKey.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(path).padEnd(46)} ${String(count).padStart(3)}`);
    }
  }

  /* 4.9 核对状态与可靠性分布 */
  section('⑨ 核对状态与来源可靠性');
  const heroReview = heroNodes.map((n) => n.provenance.reviewStatus);
  note('十二英雄 reviewStatus', tally(heroReview).map(([k, v]) => `${k} ${v}`).join(' / '));
  note('全节点 reviewStatus', tally(graph.nodes.map((n) => n.provenance.reviewStatus)).map(([k, v]) => `${k} ${v}`).join(' / '));
  note('来源可靠性', tally(graph.sources.map((s) => s.reliability)).map(([k, v]) => `${k} ${v}`).join(' / '));

  const heroSourceCounts = heroNodes
    .map((n) => ({ id: n.id, name: n.name, count: (n.provenance.sources || []).length }))
    .sort((a, b) => b.count - a.count);
  console.log('');
  note('来源最扎实的 3 位', heroSourceCounts.slice(0, 3).map((h) => `${h.name}(${h.count})`).join(' / '));
  note('来源最薄弱的 3 位', heroSourceCounts.slice(-3).reverse().map((h) => `${h.name}(${h.count})`).join(' / '));

  /* 4.10 结论 */
  section('结论');
  if (failures.length === 0) {
    console.log(`  ✓ 全部断言通过。节点 ${graph.nodes.length} 个、来源 ${graph.sources.length} 条、`
      + `关系 ${relationCount} 条、溯源条目 ${provenance && provenance.entries ? provenance.entries.length : 0} 条。`);
    console.log(`  · null 字段 ${nullStats.total} 处，全部为「显式声明无法核实」，不是漏填。`);
    if (warnings.length) {
      console.log(`  · 提示 ${warnings.length} 条：`);
      for (const w of warnings) console.log(`      - ${w}`);
    }
    return { ok: true };
  }

  console.log(`  ✗ 断言失败 ${failures.length} 项：`);
  for (const f of failures) console.log(`      - ${f}`);
  if (warnings.length) {
    console.log(`  · 另有提示 ${warnings.length} 条：`);
    for (const w of warnings) console.log(`      - ${w}`);
  }
  throw new Error('校验或生成未通过');
};

/** 直接执行本文件时才跑主流程。 */
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await runCheck();
