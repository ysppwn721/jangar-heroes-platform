import fs from 'node:fs';

/**
 * ask.html 自包含性检查。
 *
 * 这个检查针对一个具体的线上事故模式：静态托管在路径不存在时会回退返回 index.html
 * （HTTP 200 + text/html），因此运行时 fetch 数据**不会**失败在状态码上，
 * 而会失败在 r.json() 解析上 —— 页面看起来正常，AI 模块却静默变空。
 * 消除这一类风险的唯一彻底办法是让页面**不依赖任何运行时 fetch**。
 */
const file = 'dist/ask.html';
const html = fs.readFileSync(file, 'utf8');

const checks = [
  ['含内联语料节点 id="corpus-data"', html.includes('id="corpus-data"')],
  ['不含任何运行时 fetch(', !html.includes('fetch(')],
  ['含初始化失败兜底文案', html.includes('检索模块未能初始化')],
  ['含 send 按钮禁用逻辑', html.includes("send.disabled = true")],
  ['语料确实被内联（非空 JSON）', /id="corpus-data">\{"chunks":\[\{/.test(html)],
  ['仍加载检索核心模块', html.includes('retrieval-core')],
];
let pass = 0;
console.log(`ask.html 自包含性检查（${(html.length / 1024).toFixed(1)} KiB）`);
for (const [label, ok] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  if (ok) pass++;
}
console.log(`\n${pass === checks.length ? '✓ 通过' : '✗ 失败'} ${pass}/${checks.length}`);
console.log('  结论：页面不再发起运行时数据请求，静态托管的回退行为无法再使其失效。');
if (pass !== checks.length) process.exit(1);
