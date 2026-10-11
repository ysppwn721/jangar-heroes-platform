/**
 * 「江格尔齐」讲解员的检索核心（网页端）。
 *
 * ⚠️ 本文件是微信小程序 `utils/retrieval.js` 的**同源移植**，不是重写。
 * 两端的算法、停用词表、拒答闸门、BM25 参数（K1=1.4, B=0.7）完全一致：
 * 同一份语料、同一套判定逻辑、两个运行时。这正是"单套资产/逻辑跨端复用"的证据——
 * 小程序端受限不能引入分词库，网页端也不必引入，两端共享同一套零依赖实现。
 *
 * 为什么本地检索必须存在（而不是把所有语料丢给大模型）：
 *   1. 命中即答 —— 常见问题不消耗 API 额度，断网也能讲解；
 *   2. 出处可验证 —— 命中了哪几段就标注哪几段，观众能跳回原文；
 *   3. 越界可控 —— 依据不足时直接回答"站内资料没有记载"，
 *      不把"没有依据的提问"交给模型去发挥。文化类项目最怕编造。
 *
 * 算法是 BM25 的简化版：中文按二元字组（bigram）切分，不需要分词库。
 */

/** 中文二元切分：把 "洪古尔为什么叫雄狮英雄" 切成 ["洪古","古尔","尔为",...]。
 * 同时保留英文单词与数字，让 "GLB"、"3D"、"12 位" 这类提问也能命中。 */
export function tokenize(text) {
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
 * 实体名则由 buildIndex 从标题中提取成词表（见 index.entities）。 */
export const STOP_TOKENS = new Set([
  '史诗', '蒙古', '古族', '文化', '本馆', '展馆', '本站', '文创',
  '什么', '怎么', '为什', '什幺', '哪些', '哪个', '如何', '可以', '是不', '不是', '告诉',
  '时候', '名字', '叫什', '多少', '几位', '为啥', '原因', '含义', '意思',
  '一下', '看看', '说一', '讲一', '关于', '以及', '还有', '就是', '的话', '介绍', '讲讲',
]);

/** 索要"具体事实"的问法。
 *
 * 站内语料以"文创演绎 + 简介"为主，这类细节通常没有记载；命中关键词也不等于有答案。
 * ⚠️ 这张表必须覆盖真实问法。曾经漏了"在哪个省""父亲是谁""什么关系"，
 * 结果这三个站外问题一路通过，直接编答案（实测踩过）。
 * 但也不要收"为什么…"——那是**可解释**的问题，语料里的设计说明往往能回答。 */
export const FACT_SEEKING = /(叫什么|叫啥|名字是|是谁|哪个省|哪个市|哪个县|哪个地区|在哪里|在哪|什么地方|哪一年|哪一年生|出生于|生于|几岁|多少岁|多少章|几章|多少回|多少位|有几位|几个儿子|几个妻子|妻子是谁|夫人是谁|配偶|儿子叫|父亲|母亲|兄弟|姐妹|亲属|家族|血缘|坐骑|骑的什么马|什么马|哪匹马|几年|多大|谁杀|谁死|怎么死|如何牺牲|牺牲的|结局|最后怎么样|最后怎样|下落|葬|墓|出生地|故乡|发明|创始于|哪一年代|哪个朝代|什么关系|有什么关系|关系是|是什么马|是什么人|是谁的儿子|是谁的女儿|的坐骑|的师傅|的老师|的徒弟|的武器|的兵器|的法宝)/;

/** 「问句里的填充词」——**不是**在索要某个属性，因此不能拿它们判定"资料里没有"。
 *
 * 为什么必须单独列：questionWordsCovered 会检查"问题里实体以外的实词，段落里有没有"。
 * 问题是「阿拉坦策吉是谁」——「是谁」是**定义式提问**，段落里当然不会写"是谁"两个字，
 * 于是这道闸门会把一个**完全能答**的问题判成"资料没有记载"（实测踩过）。 */
export const QUESTION_FILLERS = new Set([
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
export function buildIndex(chunks) {
  const documents = chunks.map(chunk => {
    const weighted = [
      // 标题与标签是最凝练的主题词，权重更高
      ...tokenize(chunk.title).flatMap(token => [token, token, token]),
      ...tokenize((chunk.tags || []).join(' ')).flatMap(token => [token, token]),
      ...tokenize(chunk.text),
    ];
    const termFrequency = new Map();
    for (const token of weighted) termFrequency.set(token, (termFrequency.get(token) || 0) + 1);
    const topicTokens = new Set([...tokenize(chunk.title), ...tokenize((chunk.tags || []).join(' '))]
      .filter(token => !STOP_TOKENS.has(token)));
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

  // 普遍词：出现在超过 45% 文档里的 token。它们不能作为"命中依据"。
  const commonTokens = new Set();
  for (const [token, frequency] of documentFrequency) {
    if (frequency / total > 0.45) commonTokens.add(token);
  }

  // 实体词表：出现在标题里的专名。让"介绍一下江格尔"直接命中主体。
  const entities = new Map();
  for (const document of documents) {
    const title = document.chunk.title || '';
    for (const entity of extractEntities(title)) {
      if (!entities.has(entity)) entities.set(entity, new Set());
      entities.get(entity).add(document.chunk.id);
    }
    for (const tag of document.chunk.tags || []) {
      for (const entity of extractEntities(tag)) {
        if (!entities.has(entity)) entities.set(entity, new Set());
        entities.get(entity).add(document.chunk.id);
      }
    }
  }
  for (const [entity, ids] of [...entities]) {
    if (ids.size === 0 || entity.length < 2) entities.delete(entity);
  }

  return { documents, idf, averageLength, total, commonTokens, entities };
}

const K1 = 1.4;
const B = 0.7;

/** 检索最相关的若干段。 */
export function search(index, question, options = {}) {
  const limit = options.limit || 3;
  const commonTokens = index.commonTokens;
  const entities = index.entities || new Map();
  const questionText = String(question || '');

  // 实体命中比二元字组可靠得多：「介绍一下江格尔」里"江格尔"会被切成"江格"+"格尔"，
  // 而这两个字组在语料里到处都是、区分度接近零。
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
      const normalized = frequency * (K1 + 1)
        / (frequency + K1 * (1 - B + B * document.length / index.averageLength));
      score += inverse * normalized;
    }
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
  const hits = top.filter(hit => best > 0 && hit.score >= best * 0.35);

  // 覆盖率只在"真正存在于语料中"的词上统计。
  //
  // ⚠️ 分母也必须只在语料内统计，这一点原实现是错的（本项目边界测试发现并修正）：
  // 「介绍一下江格尔」会被二元切分成 介绍/绍一/一下/下江/江格/格尔，其中「绍一」「下江」
  // 是跨词边界的垃圾字组，语料里根本不存在；而「江格」「格尔」又因过于普遍被列入 commonTokens。
  // 结果 meaningful 只剩两个垃圾字组，分子 0、分母 2 → 覆盖率 0，一个**明显能答**的问题被判成
  // "资料没有记载"。修法：分子分母都限定在"语料中真实存在的词 + 命中的实体"上。
  const inCorpus = meaningful.filter(token => index.idf.has(token));
  const covered = inCorpus.length + matchedEntities.length;
  const denominator = inCorpus.length + matchedEntities.length;
  const coverage = denominator ? covered / denominator : 0;

  const topDocument = scored[0] ? scored[0].document : null;
  const topicCovered = inCorpus.filter(token => topDocument && topDocument.topicTokens.has(token)).length
    + matchedEntities.filter(entity => topDocument && entities.get(entity).has(topDocument.chunk.id)).length;
  const topicCoverage = denominator ? topicCovered / denominator : 0;

  return {
    hits, coverage, topicCoverage,
    tokens: [...inCorpus, ...matchedEntities],
    entities: matchedEntities,
    unmatched: meaningful.filter(token => !index.idf.has(token)),
  };
}

/** 疑问填充片段：把问句里的"提问语"全部去掉后，剩下的才是**问题额外要求的条件**。
 *
 * 为什么必须用一张**完整**的表，而不是把"语料里没有的词"丢掉：
 *   本站语料以原创展馆文案为主，"父亲""坐骑""省"这类属性词天然不在语料里。
 *   若按"语料里有没有"过滤，它们会被当成噪声丢掉，于是「洪古尔的父亲是谁」
 *   只剩跨边界碎片「是谁」（语料里确实有），条件被视为满足 → **编造型作答**。
 *   反过来若不做词法清洗，跨边界碎片（「吉是」「尔是」）会被当成条件 →
 *   能答的问题被拒答。
 * 两种误判都真实发生过。正确做法只有一条：**用穷举的提问语表做词法清洗**，
 * 剩下的字组再要求出现在本次命中的段落里。表必须覆盖真实问法，
 * 新增问法时要同步补一条 scripts/gen-ask-page.mjs 的边界测试用例。 */
const QUESTION_FILLER_NGRAMS = new Set([
  // 定义式
  '是谁', '是啥', '是什', '什么', '么人', '么东', '叫什', '叫啥', '啥名', '名字', '哪位', '哪一',
  '一个', '何为', '何人', '他的', '她的', '它的', '有人', '又是', '是怎', '怎么', '如何',
  // 请求式
  '介绍', '绍一', '一下', '讲一', '说说', '说一', '聊聊', '看看', '关于', '知道', '了解', '哪些', '哪个',
  // 处所式
  '在哪', '哪里', '哪儿', '哪个', '地方', '什么', '哪个地',
  // 时间式
  '哪一', '一年', '年代', '什么时', '么时候', '时候',
  // 数量式
  '多少', '几个', '几位', '几章', '几回', '几岁', '多大',
  // 从属式（用于把「是谁的儿子」这类整段问法切干净）
  '谁的', '谁的儿', '的儿子', '的女儿', '是谁的',
]);

/** 提问语的**首字集合**。用于按规则推导"跨词边界碎片"，而不是手工穷举。
 *
 * 为什么需要推导：二元切分必然把「实体名末字 + 提问语首字」黏成一个 2 字组
 * （如「洪古尔是谁」→「尔是」）。它只长 2 字，躲过了"是更长字组子串"的判定，
 * 于是被当成条件词，把**完全能答**的问题判成拒答。
 * 早先用手工清单兜这个洞，但清单依赖英雄名录——名录一变就漏，
 * 所以改为按规则生成：任何「实体末字 + 提问语首字」的组合都算碎片。 */
const QUESTION_LEAD_CHARS = new Set([...QUESTION_FILLER_NGRAMS].map(ngram => ngram[0]));

/** 判断某个字组是不是"实体名末字 + 提问语首字"黏成的跨边界碎片。 */
function isEntityBoundaryFragment(token, entityList) {
  if (token.length !== 2) return false;
  return entityList.some(entity => entity.length >= 2
    && token[0] === entity[entity.length - 1]
    && QUESTION_LEAD_CHARS.has(token[1]));
}

/** 断网兜底时的额外闸门：**问题里要求的条件，命中段落里一个都没有 → 拒答**。
 *
 * 实体加成让"洪古尔的父亲是谁"这类问题也能命中正确段落、分数冲过门槛，
 * 但段落里根本没有"父亲"这个词——回答它必然是编造。
 *
 * 判定分三步（每一步都由真实误判案例驱动）：
 *   ① 去掉命中实体的相邻片段——它们横跨实体与后续词的边界，不是条件；
 *   ② 去掉纯填充词片段——「是谁」这类定义式提问语，段落里当然不会写；
 *   ③ 剩下的才是条件词（如「父亲」「坐骑」）。只要有一个出现在命中段落里就放行；
 *      一个都没有则拒答。
 * 若问题里没有任何条件词（纯"某实体是谁/是什么"），直接放行。 */
export function questionWordsCovered(index, question, entityList, hits) {
  if (!hits.length) return false;
  const text = hits.map(hit => `${hit.chunk.title} ${hit.chunk.text}`).join(' ');

  // 全部候选先放在一起：判断"某个字组是不是碎片"必须看**整句**切出来的所有字组，
  // 而不是只看被过滤后剩下的那些。早先顺序写反过：先过滤再判断碎片，
  // 于是「是谁」被填充词表清掉、「吉是」就找不到"比它长的词"了，被误当成条件词，
  // 结果「阿拉坦策吉是谁」这种**完全能答**的问题被拒答。
  const rawTokens = [...new Set(tokenize(question))];

  // ① 先剥掉提问语、停用词、以及与实体重叠的片段。
  //    顺序很关键：必须先剥掉填充词「是谁」，才能识别出「尔是」「吉是」这类
  //    跨词边界的碎片——它们正是「是谁」的子串，只因长度 ≥ 2 而幸存。
  //    早先在这里写反过（先判碎片再剥填充词），碎片的"父串"已被剥掉，
  //    碎片就被当成了条件词，能答的问题被拒答。
  const stripped = rawTokens
    .filter(token => token.length >= 2)
    .filter(token => !STOP_TOKENS.has(token))
    .filter(token => !QUESTION_FILLERS.has(token))
    .filter(token => !QUESTION_FILLER_NGRAMS.has(token))
    .filter(token => !isEntityBoundaryFragment(token, entityList))
    .filter(token => !entityList.some(entity => entity.includes(token) || token.includes(entity)));

  // ② 再从剩下的里面剔掉"是另一个字组子串"的碎片，比较范围限定在 stripped 内部。
  const cleaned = stripped.filter(token => !stripped.some(other => other !== token && other.includes(token)));

  if (!cleaned.length) return true;   // 纯定义式提问，没有额外条件 → 放行

  // ③ 条件词必须真的**出现在这一次命中的段落里**才算数。
  //
  // ⚠️ 这一步在本项目里反复判错过，两个方向都踩过，记录在此以免再犯：
  //   · 加"语料里有没有这个词"这道过滤 → 对「洪古尔的父亲是谁」判**放行**。
  //     因为跨边界碎片「是谁」在语料里确实存在、通过了过滤，于是条件被视为满足，
  //     系统在段落根本没写其父的情况下照答——**编造型误答，最危险的方向**。
  //   · 把跨边界碎片当条件词 → 对「洪古尔是谁」判**拒答**。
  // 正确判据是"该词是否出现在**本次命中的段落**里"：
  //     洪古尔的父亲是谁   → 父亲 ✗ 的父 ✗ 亲是 ✗      → 拒答 ✓
  //     宝木巴在哪个省     → 在哪个地 ✗ 省 ✗            → 拒答 ✓
  //     洪古尔的武器是什么 → 武器 ✓（段落里确实有）      → 作答 ✓
  //     洪古尔是谁         → 无剩余条件词                → 作答 ✓
  return cleaned.some(word => text.includes(word));
}

/**
 * 判断这次检索是否足以作答。
 *
 * ⚠️ 实测结论（见小程序端 tools/narrator/tune-thresholds.cjs）：
 * **单靠词频无法区分"该答"与"该拒"**。站外问题「宝木巴在哪个省」的实词覆盖 60%、
 * 主题覆盖 40%，反而高于站内问题「云纹为什么画在袍摆上」的 29% / 29%。
 * 因为"语料里有没有这个事实"是语义问题，不是词频问题。
 *
 * 所以分工是：
 *   · 本地检索只负责**召回候选段落**；
 *   · 「证据是否真的回答了问题」在有模型可用时交给模型判定；
 *   · 无模型时用 strict 模式兜底：宁可少答，不可误答。
 *
 * @param {'strict'|'online'} [options.mode]
 */
export function decide(index, question, options = {}) {
  const mode = options.mode === 'strict' ? 'strict' : 'online';
  const result = search(index, question, options);
  const topScore = result.hits.length ? result.hits[0].score : 0;
  const minScore = options.minScore === undefined ? (mode === 'strict' ? 12 : 2.6) : options.minScore;
  const minCoverage = options.minCoverage === undefined ? (mode === 'strict' ? 0.4 : 0.12) : options.minCoverage;

  const factSeeking = FACT_SEEKING.test(String(question || ''));

  let refusal = null;
  if (!result.hits.length || topScore < minScore) refusal = 'low_score';
  else if (result.coverage < minCoverage) refusal = 'low_coverage';
  // 事实类问题的闸门**只用于无模型兜底**。
  // 有模型时"问题里的词在段落里找不到"恰恰说明这是词频判不了的语义问题
  // （正是模型存在的理由），本地拦掉它等于把该模型干的活干了、还干错了。
  //
  // ⚠️ 这里**不再**用 topicCoverage 作为前置条件（原实现要求 topicCoverage < 0.5 才检查）。
  // 那个条件会造成真实漏判：问「洪古尔的父亲是谁」，命中段落的主题覆盖高达 0.75
  //（因为洪古尔本身是主题词），于是跳过检查直接作答——可段落里根本没写他父亲是谁。
  // 漏判方向是"编造型作答"，比拒答危险得多，所以改为只要识别为索要具体事实就检查。
  else if (mode === 'strict' && factSeeking && !questionWordsCovered(index, question, result.entities || [], result.hits)) {
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

/** 兜底话术：把命中段落拼成一段「本站讲解」。 */
export function composeLocalAnswer(hits) {
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

/** 拒答话术：明确说"没有依据"，且给出可继续的路径。 */
export const REFUSAL_TEXT = {
  low_score: '站内资料里没有找到与这个问题相关的内容。可以换个说法，或从「十二英雄」「纹样解读」里选一位英雄看看。',
  low_coverage: '这个问题里有站内资料未收录的说法。建议直接查看对应的英雄页或纹样说明，那里标注了内容来源。',
  fact_seeking: '这类具体事实（人名、年代、数目、坐骑等）站内资料没有记载，本系统不会替它编一个答案。如需准确信息，请查阅汉译本或非遗名录原文。',
  question_terms_missing: '问题里提到的内容在站内资料中查不到。可能是站外信息，本系统只能回答已收录并标注来源的内容。',
};
