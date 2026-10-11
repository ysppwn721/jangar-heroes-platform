import fs from 'node:fs';

/** 核查四页的标题一致性与分享元数据完整性。 */
const PAGES = ['index.html', 'console.html', 'graph.html', 'ask.html'];
const WORK = '《江格尔》十二英雄——基于手写 WebGL 管线的史诗数字展陈交互系统';

let problems = 0;
console.log('四页标题与分享元数据核查');
console.log('='.repeat(78));
for (const p of PAGES) {
  const h = fs.readFileSync(`dist/${p}`, 'utf8');
  const title = (h.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  const og = (h.match(/property="og:/g) || []).length;
  const tw = (h.match(/name="twitter:/g) || []).length;
  const canonical = (h.match(/rel="canonical"/g) || []).length;
  const desc = (h.match(/name="description"/g) || []).length;
  const containsWork = title.includes(WORK) || title.includes('十二英雄');

  const ok = og >= 8 && tw === 4 && canonical === 1 && desc === 1 && containsWork;
  if (!ok) problems++;
  console.log(`  ${ok ? '✓' : '✗'} ${p.padEnd(14)} og:${String(og).padStart(2)} twitter:${tw} canonical:${canonical} desc:${desc}`);
  console.log(`      title: ${title}`);
}

// 旧名残留
console.log('\n旧作品名残留（dist 全站检索）：');
const OLD = ['数字资源一体化软件系统', '宝木巴 · 英雄集', '宝木巴·英雄集'];
let oldHits = 0;
for (const p of PAGES) {
  const h = fs.readFileSync(`dist/${p}`, 'utf8');
  for (const name of OLD) {
    const n = h.split(name).length - 1;
    if (n) { oldHits += n; console.log(`  ✗ ${p}: 「${name}」×${n}`); }
  }
}
if (!oldHits) console.log('  ✓ 无残留');

// 字面 markdown 残留
console.log('\n字面 markdown（**…**）残留：');
let mdHits = 0;
for (const p of PAGES) {
  const h = fs.readFileSync(`dist/${p}`, 'utf8');
  // 只看正文区域，忽略注释与脚本
  const body = h.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  const n = (body.match(/\*\*[^*\n]{2,40}\*\*/g) || []).length;
  if (n) { mdHits += n; console.log(`  ✗ ${p}: ${n} 处`); }
}
if (!mdHits) console.log('  ✓ 无残留');

console.log('\n' + '='.repeat(78));
console.log(problems === 0 && oldHits === 0 && mdHits === 0
  ? '✓ 全部通过'
  : `✗ 存在问题：标题元数据 ${problems} 页、旧名 ${oldHits} 处、markdown ${mdHits} 处`);
if (problems || oldHits || mdHits) process.exit(1);
