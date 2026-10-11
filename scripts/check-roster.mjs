#!/usr/bin/env node
/**
 * 英雄名录一致性校验：网页端真源 ↔ 小程序端生成物。
 *
 * 这道检查存在的唯一理由：**两端曾经真的分叉过**。
 * 小程序手写了一份名录，把明彦写成"神箭手"（那是哈日吉拉根的史料职分），
 * 萨布尔的称号两端也不同。改了网页忘了小程序，评委并排一看就露。
 *
 * 现在小程序端由 scripts/build-roster.mjs 生成，本脚本负责在测试阶段**确认它没被手改**，
 * 以及两端共同字段（id / name）严格一致。
 *
 * 用法：node scripts/check-roster.mjs [--miniprogram-root <小程序 miniprogram 目录>]
 * 环境变量：MINIPROGRAM_ROOT（与参数二选一）
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { heroes } from '../src/heroes.js';

const require = createRequire(import.meta.url);
const argOf = name => { const index = process.argv.indexOf(`--${name}`); return index === -1 ? null : process.argv[index + 1]; };
const miniRoot = argOf('miniprogram-root') || process.env.MINIPROGRAM_ROOT;

let failures = 0;
const ok = message => console.log(`   ✅ ${message}`);
const bad = message => { console.log(`   ❌ ${message}`); failures++; };
const head = title => console.log(`\n=== ${title} ===`);

console.log('═══ 英雄名录一致性（网页真源 ↔ 小程序生成物）═══');

if (!miniRoot) {
  console.error('\n❌ 未提供小程序目录。用法：node scripts/check-roster.mjs --miniprogram-root <路径>');
  process.exit(1);
}
const target = path.join(miniRoot, 'utils', 'heroes.js');
if (!fs.existsSync(target)) {
  console.error(`\n❌ 找不到 ${target}`);
  process.exit(1);
}

const { HEROES: mini } = require(target);

head('① 两端共同字段');
if (mini.length !== heroes.length) bad(`条数不同：网页 ${heroes.length} / 小程序 ${mini.length}`);
else ok(`条数一致（${heroes.length} 尊）`);

const byId = new Map(mini.map(row => [row.id, row]));
for (const hero of heroes) {
  const other = byId.get(hero.id);
  if (!other) { bad(`${hero.name}(id=${hero.id}) 在小程序端缺失`); continue; }
  if (other.name !== hero.name) bad(`id=${hero.id} 名字不同：网页「${hero.name}」/ 小程序「${other.name}」`);
}
if (!failures) ok('每一尊的 id 与名字两端完全一致');

head('② 隐藏款标记');
for (const hero of heroes) {
  const other = byId.get(hero.id);
  if (!other) continue;
  const webHidden = hero.type === 'hidden';
  if (webHidden !== other.hidden) bad(`${hero.name}：网页 type=${hero.type} / 小程序 hidden=${other.hidden}`);
}
if (!failures) ok('隐藏款标记两端一致');

head('③ 称号不与史料职分撞车');
/* 史料职分来自已核实的座次表（tools/research/十二英雄形象研究.md）：
 *   洪古尔=最伟大的战士、阿拉坦策吉=明见者、萨瓦尔=重手、明彦=世界之美、
 *   波尔芒纳=掌马者、古赞贡布=左侧首位、哈日·吉勒干=射手、克·吉勒干=说唱者兼审判座
 * 仅对"射手"这类辨识度极高的职分做冲突检查 —— 过度检查会把合理表达误判成错误。 */
const SHOOTER_TITLES = ['神箭手', '射手'];
const shooters = heroes.filter(hero => SHOOTER_TITLES.some(word =>
  String(hero.title).includes(word) || String(hero.roster?.role || '').includes(word)));
if (shooters.length === 1) ok(`射手类称号只落在一位身上：${shooters[0].name}`);
else if (shooters.length === 0) bad('没有任何英雄使用射手类称号 —— 哈日吉拉根的史料职分是"著名射手"，应当保留');
else bad(`射手类称号落到了 ${shooters.length} 位身上：${shooters.map(h => h.name).join('、')}（史料里"著名射手"是哈日·吉勒干的职分）`);

head('④ 生成物未被手改');
const generated = fs.readFileSync(target, 'utf8');
if (/本文件由脚本生成，请勿手改/.test(generated)) ok('小程序端名录带有"脚本生成"标记');
else bad('小程序端名录缺少生成标记 —— 可能被手改过');

// 用同一份真源重新渲染一次，逐字节比对（不写文件）
const rows = heroes.map(hero => `  { id: ${hero.id}, name: '${hero.name}', role: '${hero.roster.role}', tagText: '${hero.roster.tagText}', hidden: ${hero.roster.hidden} }`);
const expectedRoster = `const HEROES = [\n${rows.join(',\n')}\n];`;
if (generated.includes(expectedRoster)) ok('名录内容与真源重新渲染的结果逐字节一致');
else {
  bad('名录内容与真源不一致 —— 有人手改了生成物，或改了真源没重新生成');
  console.log('   修复：在网页项目里跑');
  console.log(`     node scripts/build-roster.mjs --miniprogram-root ${miniRoot}`);
}

console.log(`\n=== 汇总 ===\n${failures === 0 ? '✅ 英雄名录两端一致' : `❌ ${failures} 项未通过`}`);
process.exit(failures === 0 ? 0 : 1);
