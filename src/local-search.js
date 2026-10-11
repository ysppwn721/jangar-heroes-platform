/**
 * 站内搜索（方案 A：内容定位）。
 *
 * 复用的是**讲解员那套已经验证过的中文检索**（bigram + BM25 简化版），
 * 不是新写一个搜索算法 —— 那套已经在讲解员上跑通了 recall 23/23，
 * 而且刻意做到零平台依赖（不 require fs/https/wx），浏览器可以直接用。
 *
 * ⚠️ 但必须清楚它的能力边界：**它是召回引擎，不是语义搜索**。
 *    观众输入"谁会射箭"这种换了说法的问法，纯词频匹配不到 —— 这正是
 *    讲解员要把候选交给大模型判定的原因。站内搜索没有大模型可依赖，
 *    所以这里用**别名（aliases）**补上这一课：把口语说法（来自讲解员语料的 tags）
 *    直接并进记录正文，让"射箭／弓箭／谁会射箭"都能命中同一位英雄。
 *
 * 三条设计决定：
 *   ① 索引**懒建**：首次搜索才建，不占首屏时间（建索引约几毫秒，但没必要提前付）。
 *   ② 排序**可预测**：检索分 + 明确加权（标题完全匹配 > 标题命中 > 别名命中），
 *      而不是让观众猜为什么这条排前面。
 *   ③ 结果**必可达**：每条记录都带 target（锚点或英雄 slug），构建时已校验存在。
 */
import { buildIndex, search } from './retrieval.js';
import { searchRecords } from './search-index.js';

let index = null;

/** 把记录转成检索引擎要的形状，并把别名并进正文（别名命中就等于正文命中） */
function corpus() {
  return searchRecords.map(record => ({
    id: record.id,
    title: record.title,
    // 别名以空格分隔并入正文：检索只做包含匹配，别名放这里最直接
    text: [record.text, (record.aliases || []).join(' ')].filter(Boolean).join(' '),
    section: record.kind,
    source: record.target?.hero ? '图鉴' : '展馆',
    target: record.target,
    aliases: record.aliases || [],
  }));
}

function ensureIndex() {
  if (!index) index = buildIndex(corpus());
  return index;
}

/** 结果分类的展示名 */
const KIND_LABEL = {
  hero: '英雄',
  section: '章节',
  chapter: '长卷',
  qa: '问答',
  motif: '纹样',
};

/**
 * 分类优先级。
 * 为什么需要它：英雄的简介里常顺带提到「宝木巴」（十二位英雄几乎都在宝木巴的故事里），
 * 于是搜「宝木巴」时一串英雄卡片会压过真正讲宝木巴的那一节。
 * 而"顺带提到"与"专门讲这个"对观众的价值完全不同 —— 词频分不出这个区别，
 * 所以在排序上显式给**内容型结果**（章节/长卷）更高的优先级。
 */
const KIND_PRIORITY = { section: 5, chapter: 4.5, motif: 4, qa: 3.5, hero: 3 };

/**
 * 检索。
 * @param {string} query 观众输入
 * @param {{limit?:number}} [options]
 * @returns {Array<{id,title,kind,kindLabel,snippet,target,score}>}
 */
export function searchSite(query, options = {}) {
  const limit = options.limit || 8;
  const text = String(query || '').trim();
  if (!text) return [];
  const result = search(ensureIndex(), text, { limit: limit * 4 });
  if (!result.hits.length) return [];

  const lowered = text.toLowerCase();
  const scored = result.hits.map(hit => {
    const record = searchRecords.find(item => item.id === hit.chunk.id) || {};
    const title = String(record.title || '');
    const loweredTitle = title.toLowerCase();
    let bonus = 0;
    const reasons = [];
    // 观众最可能想找的，是"标题就是自己输入的内容"或"标题里含这句话"
    if (loweredTitle === lowered) { bonus += 40; reasons.push('title-exact'); }
    else if (loweredTitle.includes(lowered)) { bonus += 18; reasons.push('title-part'); }
    /* 别名精确命中 = 最强的信号。
     * 为什么给这么大的权重：「宝木巴」被登记为「走进江格尔」那一节的检索词，
     * 说明那一节**专门讲**宝木巴；而英雄简介里顺带提到宝木巴只是"提到"。
     * 词频分不出这个区别（长正文反而更容易蹭到词），但**别名是人手工登记的主题**，
     * 所以它应当压过词频。实测：不加这一条时，搜「宝木巴」第一名是一张英雄卡片。 */
    /* 别名命中的权重分三档，依据是"这条别名有多像主题词"：
     *   · 完全相同（「宝木巴」）：这一条就是讲它的 → +60
     *   · 含在**短别名**里（「宝木巴在哪里」）：仍是主题词 → +45
     *   · 含在**长别名**里（「宝木巴的圣主」「宝木巴的守护者」）：这是**头衔**，
     *     它说明这位英雄与宝木巴有关，但不代表这条内容"就是讲宝木巴的" → +25
     * 实测：不区分这三档时，搜「宝木巴」的第一名是萨纳拉（别名"宝木巴的守护者"）
     * 而不是专门讲宝木巴的那一节 —— 因为英雄正文短、词频密度天然更高。 */
    const aliasHit = (record.aliases || []).map(alias => String(alias).toLowerCase()).filter(alias => alias.includes(lowered));
    if (aliasHit.some(alias => alias === lowered)) { bonus += 60; reasons.push('别名全等+60'); }
    else if (aliasHit.some(alias => alias.length <= 12)) { bonus += 45; reasons.push('短别名含+45'); }
    else if (aliasHit.length) { bonus += 25; reasons.push('长别名含+25'); }
    // 长度归一：长正文天然更容易蹭到词（英雄描述里常顺带提到"宝木巴"），
    // 而真正讲宝木巴的章节正文短、命中密度高。不归一的话结果会被长文本挤满。
    const density = hit.score / Math.log2(24 + String(record.text || '').length);
    const kind = record.kind || 'section';
    return {
      id: hit.chunk.id,
      title,
      kind,
      kindLabel: KIND_LABEL[kind] || '展馆',
      snippet: snippetOf(record.text, hit.chunk.text, lowered),
      target: record.target || { anchor: hit.chunk.id },
      // 密度分（可比较的注意力）+ 明确加权（别名/标题命中是权威信号）
      relevance: density * 10 + bonus,
      // 英雄名一般 2~4 字；命中英雄数很多时，短名字更可能是"点名要找的那位"
      tiebreak: record.kind === 'hero' ? title.length : 0,
      reasons,
    };
  });

  /* 门槛：过滤掉"只蹭到一个泛词"的弱命中。
   * 实测踩过：搜「多少个英雄」时，一串英雄卡片因为标题里都有"英雄"而挤满结果，
   * 真正回答问题的「探索问答与参观说明」反倒排到后面。
   * 所以先设一个门槛（只丢弃低于门槛的条目，且仅当还有别的结果时才丢），
   * 再按相关度排序 —— 宁可给 1 条准的，也不给 8 条蹭词条。 */
  const MIN_RELEVANCE = 8;
  const strong = scored.filter(item => item.relevance >= MIN_RELEVANCE);
  const pool = strong.length ? strong : scored;
  pool.sort((a, b) => b.relevance - a.relevance || a.tiebreak - b.tiebreak || a.title.localeCompare(b.title));
  return pool.slice(0, limit).map(({ relevance, tiebreak, reasons, ...rest }) => ({ ...rest, score: Number(relevance.toFixed(1)) }));
}

/** 摘要：尽量截在命中词附近，而不是永远从开头截（否则观众看不到命中在哪） */
function snippetOf(recordText, indexedText, needle) {
  const source = String(recordText || indexedText || '').replace(/\s+/g, ' ').trim();
  if (source.length <= 78) return source;
  const at = needle ? source.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return `${source.slice(0, 78)}…`;
  const start = Math.max(0, at - 26);
  return `${start > 0 ? '…' : ''}${source.slice(start, start + 78)}…`;
}

/** 供测试与调试：索引规模、可检索的记录数 */
export function searchStats() {
  return { records: searchRecords.length, indexed: ensureIndex().documents.length };
}
