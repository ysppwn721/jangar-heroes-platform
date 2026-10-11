#!/usr/bin/env node
/**
 * 从网页端的英雄真源生成小程序端名录 —— 「一份真源，两端一致」。
 *
 * 为什么需要它：同一批英雄文案散在两端各写一份，**已经分叉过**：
 * 小程序里明彦被写成"神箭手"，而"著名射手"是哈日吉拉根的史料职分（Хар Җилң）；
 * 网页端称萨布尔"铁臂力士"，小程序说他"无畏的草原骑士"。
 * 评委把网站与小程序并排看，或者对着我们整理的座次表核对，就会发现说法不一致。
 *
 * 做法沿用项目里已经跑通的同一套范式（见 scripts/build-knowledge.mjs）：
 *   真源 = 网页端 src/heroes.js（含 roster 子对象，放小程序专用字段）
 *   产物 = <miniprogram-root>/utils/heroes.js
 *   生成后**逐字节校验**两端一致，不一致就报错退出 —— 这样"改一处忘另一处"不可能再发生。
 *
 * 用法：
 *   node scripts/build-roster.mjs --miniprogram-root D:\WeChatProjects\miniprogram-7\miniprogram
 *   node scripts/build-roster.mjs --miniprogram-root <路径> --check   # 只校验不写入
 */
import fs from 'node:fs';
import path from 'node:path';
import { heroes } from '../src/heroes.js';

const argOf = name => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1];
};
const checkOnly = process.argv.includes('--check');
const miniprogramRoot = argOf('miniprogram-root');

if (!miniprogramRoot && !checkOnly) {
  console.error('缺少参数。用法：node scripts/build-roster.mjs --miniprogram-root <小程序 miniprogram 目录>');
  process.exit(1);
}

/* 小程序端需要、而网页端不需要的常量：从现有文件里**原样读取**而不是重新硬编码。
 * 这样云环境 ID 只有一处定义，不会因为换环境而两端不一致。 */
const TARGET = miniprogramRoot ? path.join(miniprogramRoot, 'utils', 'heroes.js') : null;
const readExisting = file => {
  if (!file || !fs.existsSync(file)) return null;
  const source = fs.readFileSync(file, 'utf8');
  const cloud = /const CLOUD_MODEL_ROOT = '([^']+)'/.exec(source);
  const fallback = /const FALLBACK_HERO = '([^']+)'/.exec(source);
  return { cloudRoot: cloud ? cloud[1] : null, fallback: fallback ? fallback[1] : null };
};
const existing = readExisting(TARGET);
if (!existing?.cloudRoot) {
  console.error(`❌ 读不到现有名录里的 CLOUD_MODEL_ROOT：${TARGET || '(未提供路径)'}`);
  console.error('   为避免把云环境 ID 写错，本脚本不自己猜这个值 —— 请确认路径指向小程序 miniprogram/utils/heroes.js');
  process.exit(1);
}

/* 校验云文件 ID 前缀的**格式**，并与 app.js 里 wx.cloud.init 的 env 交叉核对。
 *
 * 为什么必须校验：这个值原先只是"原样读取再写回"，错了不会被发现，
 * 而后果是线上所有模型都下载失败（报"请检查模型名是否正确"，指向文件名，
 * 很容易查错方向）。真实事故：曾经写成
 *   cloud://deepseek-health-7gm0bvdz4e0903d7.6465-...-1398860838/models
 * 第一段用了"环境名"而不是"环境 ID"，两段不配对，于是取不到文件。
 *
 * 规范格式：cloud://<环境ID>.<环境ID>-<云账号APPID>/<目录>
 * （下载地址的 host 就是 <环境ID>.tcb.qcloud.la，可用来反查真实环境 ID） */
const cloudProblems = [];
const m = /^cloud:\/\/([^.]+)\.([^/]+)\/(.+)$/.exec(existing.cloudRoot);
if (!m) {
  cloudProblems.push(`CLOUD_MODEL_ROOT 不符合 cloud://<环境ID>.<环境ID>-<APPID>/<目录> 的形式：${existing.cloudRoot}`);
} else {
  const [, first, second, dirPart] = m;
  // 第二段必须是 `${环境ID}-${数字}`，且第一段就是那个环境 ID
  const envId = second.replace(/-\d+$/, '');
  if (!/-\d+$/.test(second)) {
    cloudProblems.push(`CLOUD_MODEL_ROOT 第二段缺少 "-<云账号APPID>" 后缀：${second}`);
  }
  if (first !== envId) {
    cloudProblems.push(
      `CLOUD_MODEL_ROOT 两段环境 ID 不配对：第一段 "${first}" ≠ 第二段蕴含的 "${envId}"。\n`
      + '     规范形式是 cloud://<环境ID>.<环境ID>-<APPID>/<目录>；\n'
      + '     把"环境名"填进第一段会导致所有模型下载失败。'
    );
  }
  if (!dirPart) cloudProblems.push('CLOUD_MODEL_ROOT 缺少目录部分');
  // 与 app.js 的 wx.cloud.init 交叉核对。
  // ⚠️ 两者写法不同是**允许**的：实测 wx.cloud.init 必须用环境名，
  // 而云存储 fileId 前缀用完整环境 ID；环境 ID 的形态是
  // `<4位前缀>-<环境名>-<云账号APPID>`，所以环境名是环境 ID 的中段。
  // 只有"既不相同、也不是彼此的中段"才是真不一致（指向两个环境）。
  // 曾因为把 app.js 改成完整环境 ID 想让两者一致，导致**登录直接失败** ——
  // 所以这里只提示、不阻断。
  const appJs = miniprogramRoot ? path.join(miniprogramRoot, 'app.js') : null;
  if (appJs && fs.existsSync(appJs)) {
    const appSrc = fs.readFileSync(appJs, 'utf8');
    const env = /wx\.cloud\.init\(\{[\s\S]{0,200}?env:\s*'([^']+)'/.exec(appSrc);
    if (env && env[1]) {
      const sameEnv = env[1] === envId || envId.includes(env[1]) || env[1].includes(envId);
      if (!sameEnv) {
        cloudProblems.push(
          `app.js 的 wx.cloud.init env="${env[1]}" 与 CLOUD_MODEL_ROOT 的环境 ID "${envId}" 不像是同一个环境。\n`
          + '     两者指向不同环境时 getTempFileURL 会取不到文件。'
        );
      } else if (env[1] !== envId) {
        console.log(`ℹ️  app.js 用环境名 "${env[1]}"，CLOUD_MODEL_ROOT 用完整环境 ID —— 属正常写法差异`);
      }
    }
  }
}
if (cloudProblems.length) {
  console.error('❌ CLOUD_MODEL_ROOT 校验未通过：');
  for (const p of cloudProblems) console.error('   · ' + p);
  process.exit(1);
}
console.log(`✅ 云文件 ID 校验通过：环境 ${/^cloud:\/\/([^.]+)\./.exec(existing.cloudRoot)[1]}`);

/** 校验：真源必须字段齐全且自洽 */
const problems = [];
const seenId = new Set();
const seenSlug = new Set();
const seenName = new Set();
for (const hero of heroes) {
  const where = `id=${hero.id} ${hero.name || ''}`;
  for (const field of ['id', 'name', 'title', 'slug', 'description']) {
    if (!hero[field]) problems.push(`${where} 缺少 ${field}`);
  }
  if (!Array.isArray(hero.features) || !hero.features.length) problems.push(`${where} 缺少 features`);
  if (!hero.roster) { problems.push(`${where} 缺少 roster（小程序端专用字段）`); continue; }
  for (const field of ['role', 'tagText']) {
    if (!hero.roster[field]) problems.push(`${where} 缺少 roster.${field}`);
  }
  if (typeof hero.roster.hidden !== 'boolean') problems.push(`${where} roster.hidden 必须是布尔`);
  if (seenId.has(hero.id)) problems.push(`${where} id 重复`);
  if (seenSlug.has(hero.slug)) problems.push(`${where} slug 重复`);
  if (seenName.has(hero.name)) problems.push(`${where} 名字重复`);
  seenId.add(hero.id); seenSlug.add(hero.slug); seenName.add(hero.name);
  // 网页端 type 与小程序 hidden 必须表达同一件事，否则两端"隐藏款"标记会不一致
  const webHidden = hero.type === 'hidden';
  if (webHidden !== hero.roster.hidden) {
    problems.push(`${where} type(${hero.type}) 与 roster.hidden(${hero.roster.hidden}) 不一致`);
  }
  // 称号不应与其他英雄的史料职分撞车（明彦被写成"神箭手"就是这类错误）
  const epithet = String(hero.title).split('/')[0];
  const clash = heroes.find(other => other !== hero
    && (String(other.title).includes(epithet) || String(other.roster?.role || '') === String(hero.roster.role))
    && epithet.length >= 2);
  if (clash && !String(hero.title).includes('/')) {
    problems.push(`${where} 称号「${epithet}」与 ${clash.name} 重复 —— 请确认不是把别人的职分按到了这一位身上`);
  }
}
if (problems.length) {
  console.error(`❌ 真源有 ${problems.length} 处问题：`);
  for (const item of problems) console.error(`   · ${item}`);
  process.exit(1);
}
console.log(`✅ 真源自检通过：${heroes.length} 尊，字段齐全、id/slug/名字唯一、隐藏款两端一致`);

/** 生成小程序端文件（CommonJS，保持原有导出契约不变） */
// slug 必须一起生成：真源里有 slug 且上面校验了唯一性，若不输出，
// 小程序端就只能再手写一份 id→slug 的表 —— 那正是"两端各写一份会分叉"的老问题。
const rows = heroes.map(hero => `  { id: ${hero.id}, name: '${hero.name}', slug: '${hero.slug}', role: '${hero.roster.role}', tagText: '${hero.roster.tagText}', hidden: ${hero.roster.hidden} }`);
const output = `/**
 * 十二位英雄名录 —— ⚠️ **本文件由脚本生成，请勿手改**
 *
 * 生成命令（在网页项目里跑）：
 *   node scripts/build-roster.mjs --miniprogram-root <本项目的 miniprogram 目录>
 *
 * 真源：网页端 src/heroes.js（${heroes.length} 尊英雄的完整资料）。
 * 为什么要有这一步：两端曾各自手写一份名录，文案分叉过 ——
 * 小程序把明彦写成"神箭手"，而"著名射手"是哈日吉拉根的史料职分。
 * 改成生成后，两端永远一致，且生成时会逐字节校验。
 *
 * 盲盒页、抽盒页、英雄模型馆三处都用这一份。
 */
const HEROES = [
${rows.join(',\n')}
];

/** id → slug。**从真源生成**，不再手写 —— 手写副本会随真源改动而漂移。 */
const HERO_SLUG = HEROES.reduce((acc, h) => { acc[h.id] = h.slug || ''; return acc; }, {});

/** 在名录上补齐 slug（供语料反查与分享链接复用） */
const HERO_ROSTER = HEROES.map(hero => ({ ...hero, slug: HERO_SLUG[hero.id] || '' }));

/** 立绘的逻辑路径（云存储） */
const heroImagePath = id => \`/images/blindbox/\${id}.jpg\`;

/** 英雄模型目录（云存储） */
const CLOUD_MODEL_ROOT = '${existing.cloudRoot}';

/** 包内兜底立绘：云地址解析失败或网络不可用时使用 */
const FALLBACK_HERO = '${existing.fallback || '/images/fallback-hero.jpg'}';

/** 带逻辑路径与兜底地址的名录，供页面直接 setData */
const rosterForView = () => HERO_ROSTER.map(h => ({
  ...h,
  cloudPath: heroImagePath(h.id),
  mark: h.name.slice(0, 1),
  img: FALLBACK_HERO
}));

/** 按语料 slug（\`hero-jiangger\` 的后半段）反查英雄；查不到返回 null */
const heroBySlug = slug => HERO_ROSTER.find(hero => hero.slug === slug) || null;

// 导出列表必须与实际使用方一致：曾漏了 HERO_ROSTER / HERO_SLUG / heroBySlug，
// 而 ar-model-catalog 与 utils/source-link.js 正引用它们 —— 谁跑一次生成就会把
// 这三个导出抹掉，导致引用方在运行时报 undefined 才崩。改这里前先 grep 使用方。
module.exports = {
  HEROES, HERO_ROSTER, HERO_SLUG, heroBySlug,
  heroImagePath, rosterForView, CLOUD_MODEL_ROOT, FALLBACK_HERO
};
`;

if (!TARGET) { console.log('（--check 模式，跳过写入）'); process.exit(0); }

const previous = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';
if (previous === output) {
  console.log('✅ 小程序端名录已是最新（逐字节一致）');
  process.exit(0);
}
if (checkOnly) {
  console.error('❌ 小程序端名录与真源不一致 —— 跑一次不带 --check 的命令即可同步：');
  console.error(`   node scripts/build-roster.mjs --miniprogram-root ${path.dirname(path.dirname(TARGET))}`);
  process.exit(1);
}
fs.writeFileSync(TARGET, output, 'utf8');
console.log(`✅ 已生成 ${TARGET}（${output.length} 字节，${heroes.length} 尊）`);
console.log('   复核：node scripts/build-roster.mjs --miniprogram-root <同一路径> --check');
