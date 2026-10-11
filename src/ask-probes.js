/**
 * AI 辅助叙述模块的边界测试用例（供 gen-ask-page.mjs 与 scripts/check-ask.mjs 共用）。
 *
 * 为什么单独成文件：这套用例是"该答的答、该拒的拒"的**回归防线**。
 * 本项目在这个闸门上连错四次，两个方向都错过：
 *   · 漏判（把"答不了"当"能答"）→ 编造型误答，最危险；
 *   · 误拒（把"能答"当"答不了"）→ 用户问什么都被告知"资料没有"。
 * 所以用例必须随实现一起跑，且要覆盖全部十二位英雄而不是抽两个。
 *
 * 用例分四组：
 *   ① 定义式提问（每位英雄都该能答）
 *   ② 具备属性的提问（段落里确实写了，该答）
 *   ③ 索要站内未记载的具体事实（该拒）
 *   ④ 完全站外的问题（该拒）
 */

export const HEROES = ['江格尔', '哈日尼敦', '阿拉坦策吉', '洪古尔', '萨布尔', '明彦',
  '萨纳拉', '古赞贡布', '哈日吉拉根', '贺吉拉根', '纳钦尚胡尔', '赛力汗塔巴格'];

export const PROBES = [
  // ① 定义式：十二位英雄全覆盖。任何一位被拒答都是回归。
  ...HEROES.map(name => ({ q: `${name}是谁`, expect: 'answer', group: '定义式' })),

  // ② 段落里确实写了的属性（文创设计要点），该答
  { q: '介绍一下江格尔', expect: 'answer', group: '定义式' },
  { q: '洪古尔为什么叫雄狮英雄', expect: 'answer', group: '可解释' },
  { q: '云纹代表什么', expect: 'answer', group: '可解释' },
  { q: '宝木巴是什么', expect: 'answer', group: '定义式' },
  { q: '江格尔齐是什么', expect: 'answer', group: '定义式' },
  { q: '雄狮英雄是谁', expect: 'answer', group: '定义式' },
  { q: '蒙古族史诗是什么', expect: 'answer', group: '定义式' },
  { q: '英雄们为什么守护宝木巴', expect: 'answer', group: '可解释' },
  { q: '十二英雄是怎么选的', expect: 'answer', group: '可解释' },
  { q: '云纹为什么画在袍摆上', expect: 'answer', group: '可解释' },
  { q: '萨布尔的机械义臂是什么', expect: 'answer', group: '属性已记载' },
  { q: '明彦的马头琴是什么', expect: 'answer', group: '属性已记载' },
  { q: '古赞贡布的酒壶是什么', expect: 'answer', group: '属性已记载' },
  { q: '洪古尔的武器是什么', expect: 'answer', group: '属性已记载' },

  // ③ 索要站内未记载的具体事实 —— 这一组是防"编造型误答"的主力
  ...HEROES.map(name => ({ q: `${name}的坐骑是什么`, expect: 'refuse', group: '未记载事实' })),
  { q: '洪古尔的父亲是谁', expect: 'refuse', group: '未记载事实' },
  { q: '江格尔的妻子是谁', expect: 'refuse', group: '未记载事实' },
  { q: '洪古尔的儿子叫什么', expect: 'refuse', group: '未记载事实' },
  { q: '洪古尔是谁的儿子', expect: 'refuse', group: '未记载事实' },
  { q: '江格尔的出生地在哪里', expect: 'refuse', group: '未记载事实' },
  { q: '宝木巴在哪个省', expect: 'refuse', group: '未记载事实' },
  { q: '江格尔一共有多少章', expect: 'refuse', group: '未记载事实' },

  // ④ 完全站外
  { q: '今天天气怎么样', expect: 'refuse', group: '站外' },
  { q: '怎么学习编程', expect: 'refuse', group: '站外' },
];

/**
 * 跑一遍全部用例。
 * @param {(index:object, question:string, options:object)=>object} decide
 * @param {object} index
 */
export function runProbes(decide, index) {
  const results = PROBES.map(probe => {
    const verdict = decide(index, probe.q, { mode: 'strict' });
    const actual = verdict.confident ? 'answer' : 'refuse';
    return {
      ...probe,
      actual,
      pass: actual === probe.expect,
      reason: verdict.reason || null,
      score: Number(verdict.topScore.toFixed(1)),
      coverage: Number(verdict.coverage.toFixed(2)),
      topicCoverage: Number(verdict.topicCoverage.toFixed(2)),
    };
  });
  const byGroup = {};
  for (const r of results) {
    byGroup[r.group] = byGroup[r.group] || { total: 0, pass: 0 };
    byGroup[r.group].total++;
    if (r.pass) byGroup[r.group].pass++;
  }
  return {
    results,
    byGroup,
    passed: results.filter(r => r.pass).length,
    total: results.length,
  };
}
