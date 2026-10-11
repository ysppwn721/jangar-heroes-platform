/** ⚠️ 由 scripts/sync-retrieval.mjs 从讲解员的检索实现同步而来，请勿手改。
 *  真源：miniprogram-7/cloudfunctions/ask/lib/retrieval.js（与小程序端 utils/retrieval.js 同源）
 *  站点用它做站内搜索；讲解员用它做候选召回。改动请改真源，然后重跑本脚本。
 */
/**
 * 「江格尔齐」讲解员的本地检索。
 *
 * 为什么要有这一层（而不是把所有语料丢给大模型）：
 *   1. 命中即答 —— 常见问题不消耗 API 额度，断网也能讲解；
 *   2. 出处可验证 —— 命中了哪几段就标注哪几段，观众能跳回原文；
 *   3. 越界可控 —— 依据不足时直接回答"站内资料没有记载"，
 *      不把"没有依据的提问"交给模型去发挥。文化类项目最怕编造。
 *
 * 算法是 BM25 的简化版：中文按二元字组（bigram）切分，不需要分词库，
 * 一行依赖都没有，微信云函数与小程序端都能直接 require。
 *
 * 拒答由四层共同决定（缺任何一层都会出现"观众问马的品种、我们答草原风光"这种误答）：
 *   ① 得分够高；
 *   ② 实词覆盖率够高（排除"江格尔/史诗/英雄"这类无处不在的词）；
 *   ③ 最强命中段落必须"以问题核心词为主题"，而不是顺带提了一句；
 *   ④ 问题不能是在索要一个具体事实（姓名、年号、数目、坐骑）——
 *      这类细节站内未必记载，即使关键词命中也要交给人看原文。
 */

/** 中文二元切分：把 "洪古尔为什么叫雄狮英雄" 切成 ["洪古","古尔","尔为",...]。
 * 同时保留英文单词与数字，让 "GLB"、"3D"、"12 位" 这类提问也能命中。 */
function tokenize(text) {
  const tokens = [];
  const cleaned = String(text || '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, ' ')
    .replace(/[，。！？、；：“”‘’（）《》【】…—·,.!?;:"'()<>[\]{}|\\/+=*&^%$#@~`]/g, ' ');
  for (const piece of cleaned.split(' ')) {
    if (!piece) continue;
    const han = piece.match(/[\u4e00-\u9fa5]+/g) || [];
    for (const run of han) {
      if (run.length === 1) { tokens.push(run); continue; }
      for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2));
    }
    const latin = piece.match(/[a-z0-9]+/g) || [];
    for (const word of latin) tokens.push(word);
  }
  return tokens;
}

/** 语料里几乎无处不在的词（体裁名、展馆自身、疑问词），不能作为"命中依据"。
 *
 * ⚠️ 这里**不要**放英雄名之类的实体词。
 * 曾经把「江格」「格尔」写进这张表，结果观众问"介绍一下江格尔"时，
 * 实体被二元切分后又被当停用词删掉，主语凭空消失 → 被误判成"资料没有记载"。
 * 真正的普遍词改由 buildIndex 按文档频率自动识别（见 index.commonTokens），
 * 实体名则由 buildIndex 从标题中提取成词表（见 index.entities）。
 */
const STOP_TOKENS = new Set([
  '史诗', '蒙古', '古族', '文化', '本馆', '展馆', '本站', '文创',
  '什么', '怎么', '为什', '什幺', '哪些', '哪个', '如何', '可以', '是不', '不是', '告诉',
  '时候', '名字', '叫什', '多少', '几位', '为啥', '原因', '含义', '意思',
  '一下', '看看', '说一', '讲一', '关于', '以及', '还有', '就是', '的话', '介绍', '讲讲',
]);

/** 索要"具体事实"的问法。
 *
 * 站内语料以"文创演绎 + 简介"为主，这类细节通常没有记载；命中关键词也不等于有答案，
 * 所以要单独识别出来，交给下游（strict 模式拒答 / 模型判定）。
 *
 * ⚠️ 这张表必须覆盖真实问法。曾经漏了"在哪个省""父亲是谁""什么关系"，
 * 结果这三个站外问题一路通过，直接编答案（实测踩过）。
 * 但也不要收"为什么…"——那是**可解释**的问题，语料里的设计说明往往能回答
 * （如"洪古尔为什么叫雄狮英雄"对应红色战甲与雄狮披风的设计要点），
 * 误收会把能答的问题变成拒答。新增问法时务必同时补一条 test-retrieval.cjs 用例。
 */
const FACT_SEEKING = /(叫什么|叫啥|名字是|是谁|哪个省|哪个市|哪个县|哪个地区|在哪里|在哪|什么地方|哪一年|哪一年生|出生于|生于|几岁|多少岁|多少章|几章|多少回|多少位|有几位|几个儿子|几个妻子|妻子是谁|夫人是谁|配偶|儿子叫|父亲|母亲|兄弟|姐妹|亲属|家族|血缘|坐骑|骑的什么马|什么马|哪匹马|几年|多大|谁杀|谁死|怎么死|如何牺牲|牺牲的|结局|最后怎么样|最后怎样|下落|葬|墓|出生地|故乡|发明|创始于|哪一年代|哪个朝代|什么关系|有什么关系|关系是|是什么马|是什么人|是谁的儿子|是谁的女儿|的坐骑|的师傅|的老师|的徒弟|的武器|的兵器|的法宝)/;

/** 「问句里的填充词」——**不是**在索要某个属性，因此不能拿它们判定"资料里没有"。
 *
 * 为什么必须单独列：`questionWordsCovered` 会检查"问题里实体以外的实词，段落里有没有"。
 * 问题是「阿拉坦策吉是谁」——「是谁」是**定义式提问**，段落里当然不会写"是谁"两个字，
 * 于是这道闸门会把一个**完全能答**的问题判成"资料没有记载"（实测踩过：
 * top1 命中 hero-alatancheji、主题覆盖 0.71、分数 33，照样被拦）。
 * 对比「阿拉坦策吉的坐骑是什么」——"坐骑"才是真属性词，找不到就该拒答。
 * 两者的区别不在词频，在词性，所以只能靠这张表区分。
 */
const QUESTION_FILLERS = new Set([
  '是谁', '是啥', '是什么', '叫什么', '叫啥', '何为', '何人', '哪位', '哪一个',
  '他的', '她的', '它的', '这个', '那个', '有人', '又是',
  '介绍', '讲一下', '说说', '聊聊', '知道', '了解',
]);

/** 从标题里提取实体名：中文专名（2～6 字）与英文缩写。
 * 「洪古尔 · 雄狮英雄」→ 洪古尔；「《江格尔》是什么」→ 江格尔；「英 雄」→ 跳过。 */
function extractEntities(title) {
  const text = String(title || '');
  const found = [];
  for (const match of text.matchAll(/[\u4e00-\u9fa5]{2,6}/g)) {
    const candidate = match[0];
    // 标题里的分隔符会把长串切开，这里再按常见助词切一次
    for (const piece of candidate.split(/[的了是在和与及关于什么怎么]/)) {
      if (piece.length >= 2 && piece.length <= 6) found.push(piece);
    }
  }
  return found;
}

/** 取出"实词"：长度 ≥ 2、不在停用词表、也不是语料派生的普遍词。 */
function contentTokens(tokens, commonTokens) {
  return tokens.filter(token => token.length >= 2
    && !STOP_TOKENS.has(token)
    && !(commonTokens && commonTokens.has(token)));
}

/** 为一批语料建立索引：文档词频 + 逆文档频率 + 长度归一化 + 实体词表 + 普遍词表。 */
function buildIndex(chunks) {
  const documents = chunks.map(chunk => {
    const weighted = [
      // 标题与标签是最凝练的主题词，权重更高
      ...tokenize(chunk.title).flatMap(token => [token, token, token]),
      ...tokenize((chunk.tags || []).join(' ')).flatMap(token => [token, token]),
      ...tokenize(chunk.text),
    ];
    const termFrequency = new Map();
    for (const token of weighted) termFrequency.set(token, (termFrequency.get(token) || 0) + 1);
    // 主题词集合：来自标题与标签，用于判断「这段是否以此为主题」
    const topicTokens = new Set([...tokenize(chunk.title), ...tokenize((chunk.tags || []).join(' '))].filter(token => !STOP_TOKENS.has(token)));
    return { chunk, termFrequency, length: weighted.length, topicTokens };
  });

  const documentFrequency = new Map();
  for (const document of documents) {
    for (const token of document.termFrequency.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1);
    }
  }

  const total = documents.length || 1;
  const averageLength = documents.reduce((sum, document) => sum + document.length, 0) / total || 1;

  const idf = new Map();
  for (const [token, frequency] of documentFrequency) {
    idf.set(token, Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5)));
  }

  // 普遍词：出现在超过 45% 文档里的 token（如"江格""格尔"这种贯穿全语料的字组）。
  // 它们不能作为"命中依据"，因为几乎每段都有；这与"实体名"是两件事。
  const commonTokens = new Set();
  for (const [token, frequency] of documentFrequency) {
    if (frequency / total > 0.45) commonTokens.add(token);
  }

  // 实体词表：出现在标题里的专名。用于让"介绍一下江格尔"这类问题直接命中主体，
  // 而不是被二元切分切碎。
  const entities = new Map();
  for (const document of documents) {
    const title = document.chunk.title || '';
    for (const entity of extractEntities(title)) {
      if (!entities.has(entity)) entities.set(entity, new Set());
      entities.get(entity).add(document.chunk.id);
    }
    // 标签里明确写出的实体也收进来（例如标签「江格尔是谁」）
    for (const tag of document.chunk.tags || []) {
      for (const entity of extractEntities(tag)) {
        if (!entities.has(entity)) entities.set(entity, new Set());
        entities.get(entity).add(document.chunk.id);
      }
    }
  }
  // 只保留"确实指向某几段"的实体，避免把标题里的普通词当实体
  for (const [entity, ids] of [...entities]) {
    if (ids.size === 0 || entity.length < 2) entities.delete(entity);
  }

  return { documents, idf, averageLength, total, commonTokens, entities };
}

const K1 = 1.4;
const B = 0.7;

/**
 * 检索最相关的若干段。
 * @returns {{hits:Array<{chunk:object, score:number}>, coverage:number, topicCoverage:number, tokens:string[]}}
 */
function search(index, question, options = {}) {
  const limit = options.limit || 3;
  const commonTokens = index.commonTokens;
  const entities = index.entities || new Map();
  const questionText = String(question || '');

  // 先识别问题里出现的实体名：实体命中比二元字组可靠得多。
  // 「介绍一下江格尔」里"江格尔"会被二元切分切成"江格"+"格尔"，
  // 而这两个字组在语料里到处都是、区分度接近零；实体检测直接把主体找出来。
  const matchedEntities = [...entities.keys()].filter(entity => questionText.includes(entity));

  const tokens = tokenize(question);
  const unique = [...new Set(tokens)];
  const meaningful = contentTokens(unique, commonTokens);
  if (!unique.length && !matchedEntities.length) {
    return { hits: [], coverage: 0, topicCoverage: 0, tokens: [], entities: [] };
  }

  const scored = [];
  for (const document of index.documents) {
    let score = 0;
    for (const token of unique) {
      const frequency = document.termFrequency.get(token);
      if (!frequency) continue;
      const inverse = index.idf.get(token) || 0;
      const normalized = frequency * (K1 + 1) / (frequency + K1 * (1 - B + B * document.length / index.averageLength));
      score += inverse * normalized;
    }
    // 实体加成：实体出现在标题/标签里时给予高权重，让它压过字组的噪声
    const entityHits = matchedEntities.filter(entity => entities.get(entity).has(document.chunk.id));
    if (entityHits.length) score += entityHits.length * 14;
    if (score > 0) {
      const singleCharHits = unique.filter(token => token.length === 1 && document.termFrequency.has(token)).length;
      score *= 1 / (1 + singleCharHits * 0.06);
      scored.push({ chunk: document.chunk, score, document });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);
  const best = top[0] ? top[0].score : 0;
  // 只保留与最高分差距不大的，避免把弱相关段落也当依据
  const hits = top.filter(hit => best > 0 && hit.score >= best * 0.35);

  // 覆盖率只在"真正存在于语料中"的词上统计：
  // 像"下江""尔这""个角"这种跨词边界的垃圾字组在语料里根本不存在，
  // 把它们算进分母会让明显能答的问题永远达不到门槛（实测踩过）。
  const inCorpus = meaningful.filter(token => index.idf.has(token));
  const covered = inCorpus.length + matchedEntities.length;
  const denominator = meaningful.length + matchedEntities.length;
  const coverage = denominator ? covered / denominator : 0;

  // 主题覆盖：最强命中段落是否"以问题的核心词为主题"，而不是顺带提了一句
  const topDocument = scored[0] ? scored[0].document : null;
  const topicCovered = inCorpus.filter(token => topDocument && topDocument.topicTokens.has(token)).length
    + matchedEntities.filter(entity => topDocument && entities.get(entity).has(topDocument.chunk.id)).length;
  const topicCoverage = denominator ? topicCovered / denominator : 0;

  return { hits, coverage, topicCoverage, tokens: [...inCorpus, ...matchedEntities], entities: matchedEntities, unmatched: meaningful.filter(token => !index.idf.has(token)) };
}

/**
 * 断网兜底时的额外闸门：**问题问的那些词，段落里一个都没有 → 拒答**。
 *
 * 为什么需要它：实体加成让"宝木巴在哪个省""洪古尔的父亲是谁"这类问题也能命中正确段落，
 * 分数冲过门槛。但段落里根本没有"省""父亲"这些词——回答它们必然是编造。
 * 这里要求：只要问句里出现了实体以外的实词，段落的标题或正文至少要有一个对得上。
 * 「介绍一下江格尔」这类问题没有额外实词，因此不受影响。
 */
function questionWordsCovered(index, question, entityList, hits) {
  if (!hits.length) return false;
  const text = hits.map(hit => `${hit.chunk.title} ${hit.chunk.text}`).join(' ');
  let words = [...new Set(tokenize(question))]
    .filter(token => token.length >= 2)
    .filter(token => !STOP_TOKENS.has(token))
    .filter(token => !QUESTION_FILLERS.has(token))
    .filter(token => !entityList.some(entity => entity.includes(token) || token.includes(entity)));
  // 去掉"是另一个词的碎片"的候选：二元切分会产生「的坐」「是什」这类片段，
  // 它们能在段落里找到「的坐在」「是什么」，让闸门形同虚设（实测踩过）。
  words = words.filter(word => !words.some(other => other !== word && other.includes(word)));
  if (!words.length) return true;   // 问题里只有实体或只有碎片，没有额外条件
  // 命中必须发生在"语料里真实存在的词"上，避免噪声字组误判
  return words.some(word => index.idf.has(word) && text.includes(word));
}

/**
 * 判断这次检索是否足以作答。
 *
 * ⚠️ 实测结论（见 tune-thresholds.cjs）：**单靠词频无法区分"该答"与"该拒"**。
 * 站外问题「宝木巴在哪个省」的实词覆盖 60%、主题覆盖 40%，
 * 反而高于站内问题「云纹为什么画在袍摆上」的 29% / 29%。
 * 因为"语料里有没有这个事实"是语义问题，不是词频问题。
 *
 * 所以分工是：
 *   · 本地检索只负责**召回候选段落**；
 *   · 「证据是否真的回答了问题」由大模型判定（见 cloudfunctions/ask）；
 *   · 断网兜底用 strict 模式：宁可少答，不可误答。
 *
 * @param {'strict'|'online'} [options.mode]
 *        strict = 断网兜底，只回答高分强命中；
 *        online = 会把候选交给模型，本地只拦掉明显无关的问题。
 */
function decide(index, question, options = {}) {
  const mode = options.mode === 'strict' ? 'strict' : 'online';
  const result = search(index, question, options);
  const topScore = result.hits.length ? result.hits[0].score : 0;
  const minScore = options.minScore === undefined ? (mode === 'strict' ? 12 : 2.6) : options.minScore;
  const minCoverage = options.minCoverage === undefined ? (mode === 'strict' ? 0.4 : 0.12) : options.minCoverage;

  const factSeeking = FACT_SEEKING.test(String(question || ''));

  let refusal = null;
  if (!result.hits.length || topScore < minScore) refusal = 'low_score';
  else if (result.coverage < minCoverage) refusal = 'low_coverage';
  // 事实类问题的两道闸门**只用于断网兜底**。
  // online 模式下"问题里的词在段落里找不到"恰恰说明这是词频判不了的语义问题
  // （正是模型存在的理由），本地拦掉它等于把该模型干的活干了、还干错了。
  else if (mode === 'strict' && factSeeking && result.topicCoverage < 0.5) {
    refusal = 'fact_seeking';
  } else if (mode === 'strict' && factSeeking && !questionWordsCovered(index, question, result.entities || [], result.hits)) {
    refusal = 'question_terms_missing';
  }

  return {
    hits: result.hits,
    coverage: result.coverage,
    topicCoverage: result.topicCoverage,
    topScore,
    factSeeking,
    mode,
    confident: refusal === null,
    reason: refusal,
  };
}

/** 供云函数与小程序的兜底话术复用：把命中段落拼成一段「本站讲解」。 */
function composeLocalAnswer(hits) {
  if (!hits.length) return '';
  const primary = hits[0].chunk;
  const body = [primary.text];
  const extra = hits.slice(1).filter(hit => hit.chunk.section === primary.section);
  for (const hit of extra) {
    if (body.join('').length >= 260) break;
    const sentence = hit.chunk.text.split(/(?<=。)/).find(part => part.trim() && !primary.text.includes(part.trim()));
    if (sentence) body.push(sentence.trim());
  }
  return body.join('');
}

/* 站点端以 ESM 导出 —— 浏览器不能 require。逻辑与讲解员完全同一份，勿在此单独改动。 */
export { tokenize, buildIndex, search, decide, composeLocalAnswer, STOP_TOKENS, FACT_SEEKING };
