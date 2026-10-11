#!/usr/bin/env node
/**
 * 生成 robots.txt 与 sitemap.xml。
 *
 * 为什么不写死在仓库里：这两个文件里的 URL 必须是**绝对地址**，
 * 而地址取决于最终部署到哪个域名。部署前并不知道，所以改为构建期按环境变量生成：
 *
 *   SITE_ORIGIN=https://your-site.example node scripts/gen-seo.mjs
 *
 * 未设置时用占位域名 `https://jiangger.example`，并在文件里留注释说明需替换——
 * 这样"忘了改"是可见的，而不是静默产出一个指向不存在域名的 sitemap。
 *
 * 用法：node scripts/gen-seo.mjs   （通常由 scripts/build.mjs 调用）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLACEHOLDER = 'https://jiangger.example';

/** 交付页面与其在 sitemap 中的权重/更新频率。 */
const PAGES = [
  { file: 'index.html', priority: '1.0', freq: 'monthly', note: '数字展馆（应用实例）' },
  { file: 'console.html', priority: '0.9', freq: 'monthly', note: '技术控制台' },
  { file: 'graph.html', priority: '0.9', freq: 'monthly', note: '知识图谱与史料溯源' },
  { file: 'ask.html', priority: '0.8', freq: 'monthly', note: 'AI 辅助叙述' },
];

export async function runGen({ origin = process.env.SITE_ORIGIN || PLACEHOLDER, outDir = ROOT } = {}) {
  const base = origin.replace(/\/+$/, '');
  const isPlaceholder = base === PLACEHOLDER;
  const today = new Date().toISOString().slice(0, 10);

  /* robots.txt —— 允许抓取全部页面；声明 sitemap 位置 */
  const robots = [
    '# 《江格尔》十二英雄——基于手写 WebGL 管线的史诗数字展陈交互系统',
    isPlaceholder
      ? `# ⚠️ 占位域名：部署后请以 SITE_ORIGIN=<真实域名> 重新生成本文件与 sitemap.xml`
      : `# 站点：${base}`,
    'User-agent: *',
    'Allow: /',
    '',
    'Sitemap: ' + base + '/sitemap.xml',
    '',
  ].join('\n');
  await fs.writeFile(path.join(outDir, 'robots.txt'), robots, 'utf8');

  /* sitemap.xml */
  const urls = PAGES.map(p => [
    '  <url>',
    `    <loc>${base}/${p.file}</loc>`,
    `    <lastmod>${today}</lastmod>`,
    `    <changefreq>${p.freq}</changefreq>`,
    `    <priority>${p.priority}</priority>`,
    `    <!-- ${p.note} -->`,
    '  </url>',
  ].join('\n')).join('\n');

  const sitemap = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    isPlaceholder
      ? '<!-- 占位域名：部署后请以 SITE_ORIGIN=<真实域名> 重新生成 -->'
      : `<!-- ${base} -->`,
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
    '',
  ].join('\n');
  await fs.writeFile(path.join(outDir, 'sitemap.xml'), sitemap, 'utf8');

  return { base, isPlaceholder, pages: PAGES.length };
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const result = await runGen();
  console.log(`已生成 robots.txt 与 sitemap.xml（${result.pages} 个页面）`);
  console.log(`  站点：${result.base}`);
  if (result.isPlaceholder) {
    console.log('  ⚠️ 当前为占位域名。部署后请重新运行：');
    console.log('     SITE_ORIGIN=https://真实域名 node scripts/gen-seo.mjs');
  }
}
