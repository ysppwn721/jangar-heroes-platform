/** 构建「江格尔齐」讲解员的知识库。
 *
 * 语料来源是展馆网页的内容源（src/heroes.js 与 index.html 的正文），
 * 由脚本抽取而不是手抄，避免网页端与小程序端的文案不一致。
 *
 * 输出（两处，保持同源）：
 *   <cloud-root>/data/knowledge.js         —— 微信云函数直接 require（CommonJS）
 *   <miniprogram-root>/data/knowledge.js   —— 小程序本地检索用（CommonJS）
 *
 * 用法（两个路径都必须显式给出，避免相对路径解析到意外位置）：
 *   node scripts/build-knowledge.mjs \
 *     --cloud-root D:\WeChatProjects\miniprogram-7\cloudfunctions\ask \
 *     --miniprogram-root D:\WeChatProjects\miniprogram-7\miniprogram
 *
 * ⚠️ 写新段落时，tags 字段直接决定召回率（实测：「偏门问法」答对率仅 35%）：
 *   - tags 参与打分（权重 ×2），也参与"这段是否以问题为主题"的判断；
 *   - 除了正式名称，必须把**观众可能用的口语说法**写进来。本地检索只认字面匹配，
 *     「那个智囊人物」「军师」这类说法不写进 tags 就永远召不回阿拉坦策吉；
 *   - title 权重最高（×3），应当是最规范、最凝练的说法。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { heroes } from '../src/heroes.js';

const argOf = name => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
};

const cloudRoot = argOf('cloud-root');
const miniprogramRoot = argOf('miniprogram-root');
if (!cloudRoot || !miniprogramRoot) {
  console.error('缺少参数。用法：node scripts/build-knowledge.mjs --cloud-root <云函数目录> --miniprogram-root <小程序 miniprogram 目录>');
  process.exit(1);
}

/** 把 HTML 片段还原成纯文本：去标签、解实体、压空白。 */
function textOf(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** 精确匹配 id 属性。
 * 注意不能用 html.indexOf(`id="${id}"`)：子串匹配会让 id="epic" 命中 id="living-epic"，
 * 结果把后一个 section 的原始标签一起抽进语料（实测踩过）。 */
function findId(html, id) {
  const pattern = new RegExp(`id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g');
  const match = pattern.exec(html);
  return match ? match.index : -1;
}

/** 从 index.html 中按 id 取出某个 section 的正文文本。 */
function sectionText(html, id) {
  const start = findId(html, id);
  if (start === -1) return '';
  const next = html.indexOf('<section', start + 1);
  const chunk = html.slice(start, next === -1 ? html.length : next);
  return textOf(chunk);
}

/** 从 index.html 中按 id 取出某个 panel/article 的正文文本（用于阅读章节）。 */
function panelText(html, id) {
  const start = findId(html, id);
  if (start === -1) return '';
  // 从标签结束处开始，避免把 <article id="..." class="..."> 本身当成正文
  const tagEnd = html.indexOf('>', start);
  const end = html.indexOf('</article>', tagEnd);
  return textOf(html.slice(tagEnd + 1, end === -1 ? html.length : end));
}

const html = await fs.readFile('index.html', 'utf8');
const chunks = [];

const push = (chunk) => {
  const text = (chunk.text || '').replace(/\s+/g, ' ').trim();
  if (text.length < 20) return;
  chunks.push({ ...chunk, text });
};

// ---------- 1. 概况与家园 ----------
push({
  id: 'overview-epic',
  section: 'overview',
  title: '《江格尔》是什么',
  source: '展馆 · 走进江格尔',
  tags: ['江格尔', '史诗', '蒙古族', '非遗', '什么是', '江格尔是什么', '这部史诗', '江格尔讲什么'],
  text: '《江格尔》是蒙古族世代传唱的英雄史诗。它讲述江格尔与勇士们守护理想家园宝木巴的故事，'
    + '也寄托着人们对和平、团结与美好生活的向往。史诗中的冒险与交锋，承载着人们对和平生活的期待。'
    + '本展馆以数字艺术与文创设计，让这份口耳相传的文化记忆被更多人看见。',
});

// 「江格尔是谁」是最高频的问题之一，单独成段，并把"史诗人物"与"演唱者"的区分写清楚，
// 否则它会被"江格尔齐是谁"抢走（实测过：两者的词面非常接近）。
push({
  id: 'overview-jangar-hero',
  section: 'overview',
  title: '江格尔：史诗的中心人物',
  source: '展馆 · 走进江格尔 / 史诗长卷 贰',
  tags: ['江格尔是谁', '主角', '可汗', '圣主', '中心人物', '人物', '圣主可汗', '首领', '老大', '主人翁', '核心人物'],
  text: '江格尔是《江格尔》史诗的中心人物，本馆图鉴中列为第一位，称号「圣主可汗」。'
    + '围绕他与勇士们展开的故事，把个人的勇武与共同家园的命运联系起来：'
    + '英雄的价值既在于面对艰难时的胆识，也在于对伙伴与家园的担当。'
    + '请注意区分：江格尔是史诗里的人物；「江格尔齐」是对演唱这部史诗的人的称呼，两者不是一回事。',
});

push({
  id: 'overview-bomba',
  section: 'overview',
  title: '宝木巴 · 理想家园',
  source: '展馆 · 史诗长卷 壹「理想之地」',
  tags: ['宝木巴', '家园', '理想', '圣地', '地名', '理想国', '理想家园', '乌托邦', '世外桃源', '草原上的理想国', ' paradise'],
  text: '宝木巴是《江格尔》中的理想家园，也是史诗里的圣地。史诗以富于想象的笔触描绘它的丰饶与美好：'
    + '人们向往安宁的生活、和睦的伙伴，以及不被侵扰的土地。理解这个世界，可以先把目光从战斗移向家园——'
    + '勇士远行、迎战与归来的意义，最终都落在“守护”二字上。家园不仅是故事的起点，也是英雄行动的理由。',
});

// ---------- 2. 十二英雄（来自内容源，保证与图鉴一致） ----------
/** 每位英雄的"口语别名"：观众不会用正式称号提问，本地检索只认字面匹配，
 *  所以把这些说法显式写进 tags。没有它，「那个智囊人物」永远召不回阿拉坦策吉。 */
const HERO_ALIASES = {
  jiangger: ['圣主可汗', '可汗', '首领', '老大', '主心骨', '带头的人', '圣主'],
  harinidun: ['牧马英雄', '养马的', '骑马的', '马倌', '马术', '套马'],
  alatancheji: ['金胸智者', '智囊', '军师', '谋士', '出主意的', '军师型', '最聪明的', '智者', '参谋'],
  hongguer: ['雄狮英雄', '先锋', '猛将', '拿斧头的', '双刃斧', '最能打的', '狮子', '前锋', '勇士'],
  saber: ['铁臂力士', '力士', '大力士', '力气最大的', '铁臂', '机械臂', '肌肉'],
  mingyan: ['美男子', '帅哥', '马头琴', '红袍', '红色衣袍', '英俊', '雅士', '美男'],
  sanala: ['刀斧手', '双刀', '拿刀的', '刀手', '近战', '防线'],
  guzangongbu: ['大肚子英雄', '大肚子', '胖英雄', '酒壶', '爱笑的', '厨子', '会吃的'],
  harijilagen: ['神箭手', '射手', '弓箭手', '射箭的', '百步穿杨', '箭法好', '猎人'],
  hejilagen: ['铁嘴法官', '法官', '判官', '裁决', '讲理的', '法槌', '律师'],
  naqinshanghuer: ['旗手', '雄鹰', '举旗的', '战旗', '鹰', '领头冲锋'],
  sailihantabage: ['飞毛腿', '跑得最快的', '善跑', '速跑', '长跑', '跑腿'],
};

for (const hero of heroes) {
  const features = (hero.features || []).join('、');
  push({
    id: `hero-${hero.slug}`,
    section: 'heroes',
    title: `${hero.name} · ${hero.title.replaceAll('/', ' · ')}`,
    source: `展馆 · 图鉴第 ${String(hero.id).padStart(2, '0')} 位（文创演绎）`,
    tags: [hero.name, hero.slug, ...hero.title.split('/'), ...(HERO_ALIASES[hero.slug] || []), ...(hero.features || [])],
    text: `${hero.description}`
      + (features ? `本馆文创设计要点：${features}。` : '')
      + `在本馆的十二英雄组织中，${hero.name}属${hero.type === 'hidden' ? '特别典藏' : '英雄群像'}。`
      + '十二英雄是本项目的展示组织方式，史诗本身拥有丰富的人物与不同传承版本，图鉴不能替代完整的史诗。',
  });
}

// ---------- 3. 口头传承 ----------
push({
  id: 'tradition-jangarchi',
  section: 'tradition',
  title: '江格尔齐是谁',
  source: '展馆 · 口头传承 01「听」',
  tags: ['江格尔齐', '演唱者', '吟诵', '说唱', '传承人', '怎么唱', '唱歌的人', '唱史诗的人', '说书人', '民间艺人', '歌手'],
  text: '“江格尔齐”是对《江格尔》演唱者的称呼。史诗通过富有节奏的吟诵与演唱，'
    + '让人物、场景和情绪在听众面前展开。声音与现场的交流，是阅读文字之外的重要体验。'
    + '史诗在江格尔齐的吟诵中流传，如今人们以数字艺术与文创设计，让这份口耳相传的文化记忆被更多人看见。',
});

push({
  id: 'tradition-oral',
  section: 'tradition',
  title: '口传心授如何延续',
  source: '展馆 · 口头传承 02「记」',
  tags: ['口传', '记忆', '心授', '版本', '地方版本', '传承', '口耳相传', '口头流传', '师傅带徒弟', '为什么有不同版本'],
  text: '口头传承依托人的记忆、学习和实践。传唱者在讲述中延续故事，也使史诗呈现不同的地方版本与表达方式。'
    + '理解这份多样性，是尊重口头文学的重要一步。因此不同传承与整理本的叙事、称谓和篇幅会有所差异，'
    + '阅读时保留各自语境比追求唯一版本更重要。',
});

push({
  id: 'tradition-digital',
  section: 'tradition',
  title: '从记录到新的相遇',
  source: '展馆 · 口头传承 03「续」',
  tags: ['记录', '录音', '数字', '传播', '技术', '保存'],
  text: '文字整理、录音录像与数字展示，为接触史诗打开了更多入口。技术可以帮助保存与传播，'
    + '传承者、听众和真实的文化生活则始终是故事的核心。本展馆用可交互的三维形象与数字阅读，'
    + '提供一个新的相遇入口，而不是替代原文与真实传承。',
});

// ---------- 4. 阅读主题（四章正文） ----------
const chapters = [
  { id: 'chapter-panel-0', title: '壹 · 关于家园', source: '展馆 · 史诗长卷 壹' },
  { id: 'chapter-panel-1', title: '贰 · 关于勇气', source: '展馆 · 史诗长卷 贰' },
  { id: 'chapter-panel-2', title: '叁 · 关于伙伴', source: '展馆 · 史诗长卷 叁' },
  { id: 'chapter-panel-3', title: '肆 · 关于和平', source: '展馆 · 史诗长卷 肆' },
];
for (const chapter of chapters) {
  const text = textOf(panelText(html, chapter.id));
  if (!text) continue;
  push({ id: chapter.id, section: 'reading', title: chapter.title, source: chapter.source, tags: [chapter.title], text });
}

// ---------- 5. 纹样与设计 ----------
push({
  id: 'motif-cloud',
  section: 'motif',
  title: '云纹：把流动的云留在衣角',
  source: '展馆 · 纹样解读 01',
  tags: ['云纹', '纹样', '袍摆', '曲线', '刺绣', '衣服', '花纹', '衣服上的花纹', '图案', '花样', '装饰'],
  text: '云纹由弧线、回转与连绵的节奏构成，让静态服饰也有流动感。本馆以云纹装饰袍摆，'
    + '将柔和的曲线与角色的英雄气质并置。上方纹样为本站绘制的设计示意，'
    + '服饰与色彩说明针对本系列文创形象，不代表所有蒙古族地区与时期的统一样式。',
});

push({
  id: 'motif-border',
  section: 'motif',
  title: '边饰：一圈秩序勾勒衣袍',
  source: '展馆 · 纹样解读 02',
  tags: ['边饰', '几何', '袖口', '衣襟', '腰带', '边界', '服饰'],
  text: '重复的几何纹饰，让袖口、衣襟和腰带拥有清晰的边界。观察造型时，'
    + '留意它们如何引导视线，并让角色轮廓更鲜明。',
});

push({
  id: 'motif-colors',
  section: 'motif',
  title: '色彩：金色的光，松石的蓝',
  source: '展馆 · 纹样解读 03',
  tags: ['色彩', '金色', '松石蓝', '深红', '草原绿', '配色', '颜色', '用了哪几种颜色', '色调', '色彩搭配'],
  text: '本系列以金色、松石蓝、深红与草原绿构建视觉语言。色彩用于区分人物个性，'
    + '也让金属、织物与饰物在画面中形成对比。',
});

// ---------- 6. 问答（把展馆三道题变成可检索知识） ----------
push({
  id: 'quiz-bomba',
  section: 'quiz',
  title: '史诗中的理想家园叫什么',
  source: '展馆 · 草原小问答',
  tags: ['答题', '问答', '叫什么', '家园名'],
  text: '宝木巴是《江格尔》中承载和平与美好生活向往的理想家园。英雄们的行动，与守护这个家园紧密相连。',
});

push({
  id: 'quiz-jangarchi',
  section: 'quiz',
  title: '“江格尔齐”指的是谁',
  source: '展馆 · 草原小问答',
  tags: ['答题', '江格尔齐是谁', '演唱者'],
  text: '“江格尔齐”是《江格尔》演唱者的称呼。他们通过吟诵与演唱，让史诗在口头传承中延续。',
});

push({
  id: 'quiz-twelve',
  section: 'quiz',
  title: '怎样理解展馆里的“十二英雄”',
  source: '展馆 · 草原小问答',
  tags: ['答题', '十二英雄', '几个人物', '章回', '只有十二个吗', '是不是只有十二个', '一共几个人', '十二位',
    '多少位英雄', '多少英雄', '几位英雄', '32', '32位虎将', '六千', '6000', '勇士'],
  /* 这里补进了已核实的层级数字（出处见 tools/research/十二英雄形象研究.md 第六节）：
   * 史诗的层级是「12 位英雄 / 32 位虎将 / 6000 多名勇士」，三者是包含关系，
   * 而本项目图鉴只收其中的十二英雄。观众最常问的正是"到底有多少位"，
   * 给得出具体数字比只说"远不止十二位"有用得多 —— 前提是有出处。 */
  text: '十二英雄是本项目的展示组织方式。史诗拥有丰富的人物与不同传承版本，文创图鉴不能替代完整的史诗。'
    + '“十二”并非史诗人物总数，也不代表只有十二个故事。'
    + '按史诗的叙述，江格尔汗率领的是十二位英雄、三十二位虎将、六千多名勇士——'
    + '十二位是其中最亲近的一层，本项目图鉴收的就是这一层。',
});

// ---------- 7. 参观说明与边界（防止模型越界回答） ----------
push({
  id: 'visit-model',
  section: 'visit',
  title: '怎样看清模型的服饰细节',
  source: '展馆 · 参观说明',
  tags: ['模型', '三维', '怎么操作', '旋转', '缩放', '细节', '转一圈', '看背面', '放大', '怎么转', '怎么看', '操作说明', '换角度'],
  text: '拖动模型可查看正面、侧面与背面；滚轮或手机双指可缩放。'
    + '点击展厅右上角的放大按钮，再靠近看看衣襟、腰带与配饰。键盘方向键也能转动模型，按 0 可恢复初始视角。',
});

push({
  id: 'visit-favorites',
  section: 'visit',
  title: '收藏英雄存在哪里',
  source: '展馆 · 参观说明',
  tags: ['收藏', '书签', '保存', '同步', '换手机', '还在吗', '存哪里', '会丢吗', '收藏夹'],
  text: '在网页端点击人物卡片右上角的书签，再切换到“我的收藏”即可查看。'
    + '收藏保存在当前设备的浏览器中；清理浏览器数据或更换设备后，不会自动同步。',
});

push({
  id: 'visit-disclaimer',
  section: 'visit',
  title: '哪些是本项目的艺术演绎',
  source: '展馆 · 参观说明（重要边界）',
  tags: ['演绎', '文创', '是不是传统', '真实', '造型', '卡通', '动漫', '美化', '真实存在吗', '历史原型', '是不是真的'],
  text: '图鉴里的角色是基于《江格尔》人物创作的当代文创设计。Q 版比例、服饰搭配、道具与部分称号'
    + '属于本项目的艺术演绎。阅读史诗时，建议结合不同整理本与传承者的讲述理解人物。'
    + '纹样为设计示意，不代表所有蒙古族地区与时期的统一样式。'
    + '史诗人物总数远不止十二位，本馆的十二英雄是展示组织方式。',
});

push({
  id: 'visit-quiz-note',
  section: 'visit',
  title: '文化问答怎么玩',
  source: '展馆 · 探索问答',
  tags: ['问答', '答题', '得分', '题'],
  text: '展馆的文化问答共三道题，围绕宝木巴、江格尔齐与文创群像展开，'
    + '答错也无需担心，每个答案都能回到对应章节继续阅读。',
});

// ---------- 输出 ----------
const payload = {
  version: 1,
  generatedAt: new Date().toISOString(),
  generator: 'scripts/build-knowledge.mjs',
  chunks,
};

const banner = `/** 本文件由 ${payload.generator} 生成，请勿手改。
 * 语料来自展馆网页内容源（src/heroes.js 与 index.html），共 ${chunks.length} 段。
 * 生成时间：${payload.generatedAt}
 */
`;

const moduleBody = `${banner}const KNOWLEDGE = ${JSON.stringify(payload, null, 2)};

module.exports = { KNOWLEDGE };
`;
const esmBody = `${banner}export const KNOWLEDGE = ${JSON.stringify(payload, null, 2)};

export default KNOWLEDGE;
`;

const targets = [
  path.join(cloudRoot, 'data', 'knowledge.js'),
  path.join(miniprogramRoot, 'data', 'knowledge.js'),
];
for (const target of targets) {
  await fs.mkdir(path.dirname(path.resolve(target)), { recursive: true });
  await fs.writeFile(target, moduleBody);
  console.log(`写入 ${path.resolve(target)}`);
}

const bytes = Buffer.byteLength(moduleBody);
console.log(`\n知识库：${chunks.length} 段，${(bytes / 1024).toFixed(1)} KB`);
const bySection = chunks.reduce((total, chunk) => { total[chunk.section] = (total[chunk.section] || 0) + 1; return total; }, {});
console.log('分段统计：', Object.entries(bySection).map(([k, v]) => `${k}:${v}`).join('  '));
console.log('字符总量：', chunks.reduce((total, chunk) => total + chunk.text.length, 0), '字');
