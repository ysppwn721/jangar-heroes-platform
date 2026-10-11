#!/usr/bin/env node
/**
 * 迁移验证：用一条**与江格尔无关**的资产，跑一遍完全相同的 assetctl 管线。
 *
 * 目的（对应"应用与传播价值"评分指标）：
 *   我们主张"这套管线是配置驱动的，换一批非遗/文物三维资产即可复用"。
 *   主张若只有论证、没有实跑，就只是说法。这个脚本把主张变成证据——
 *     ① 生成一件程序化陶罐资产（tools/make-toy-asset.mjs，零外部依赖）
 *     ② 写一份独立配置（只改 outputDir / 预算 / manifestPath）
 *     ③ 用**同一个 assetctl.mjs**、以 `--config` 指向该配置跑出独立报告
 *     ④ 独立断言报告数值与资产文件实际字节一致
 *   全程不改动主配置、不触碰主资产目录，可反复复跑。
 *
 * 用法：node tools/migration-test.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = path.join(ROOT, 'migration-demo');
const ASSETS = path.join(DEMO, 'assets');
const MODEL_DIR = path.join(DEMO, 'models', 'detail');
const REPORT_DIR = path.join(DEMO, 'report');
const line = '─'.repeat(74);

console.log(line);
console.log('▌ 迁移验证 · 用一条与江格尔无关的资产复跑同一套管线');
console.log(line);

/* ① 生成程序化资产 */
console.log('\n① 生成迁移演示资产（程序化建模，零外部依赖，无第三方许可问题）');
const gen = spawnSync(process.execPath, [path.join(ROOT, 'tools/make-toy-asset.mjs'), ASSETS], {
  encoding: 'utf8',
  cwd: ROOT,
});
if (gen.status !== 0) {
  console.error(gen.stdout, gen.stderr);
  throw new Error('生成演示资产失败');
}
for (const l of gen.stdout.trim().split('\n')) console.log(`   ${l}`);

/* ② 独立配置：只改目录与预算，管线代码一行不动 */
console.log('\n② 写独立配置（只改 outputDir / 预算口径 / manifestPath）');
await fs.rm(path.join(DEMO, 'models'), { recursive: true, force: true });
await fs.mkdir(MODEL_DIR, { recursive: true });
await fs.copyFile(path.join(ASSETS, 'taoguan.glb'), path.join(MODEL_DIR, 'taoguan.glb'));
await fs.copyFile(path.join(ASSETS, 'taoguan.glb.gz'), path.join(MODEL_DIR, 'taoguan.glb.gz'));

const mainConfig = JSON.parse(await fs.readFile(path.join(ROOT, 'assetctl.config.json'), 'utf8'));
const demoConfig = {
  ...mainConfig,
  name: 'taoguan-migration-check',
  description: '迁移验证配置：结构与主配置完全一致，仅把输出目录指向一件与江格尔无关的资产。'
    + '用于证明管线是配置驱动的，而不是为某一批资产硬编码的。',
  tiers: {
    detail: {
      ...mainConfig.tiers.detail,
      description: '迁移演示资产（程序化陶罐），走与精细版完全相同的校验与报告路径。',
      outputDir: path.relative(ROOT, MODEL_DIR).replaceAll('\\', '/'),
      // 资产规模未知，索引用 u16 还是 u32 都合理，因此不做强制
      indexComponentType: 'auto',
      indexTypeName: 'auto',
    },
  },
  // 迁移资产有自己的清单，不能拿主站清单来比对
  manifestPath: 'migration-demo/models/manifest.json',
  originals: { note: '迁移演示资产为程序化生成，无"原始采集"阶段，故为空。', models: {} },
};
const configRel = 'migration-demo/assetctl.demo.json';
await fs.writeFile(path.join(ROOT, configRel), JSON.stringify(demoConfig, null, 2) + '\n', 'utf8');
console.log(`   ${configRel}`);

/* ③ 同一个 assetctl，用 --config 指向独立配置 */
console.log('\n③ 调用同一个 assetctl.mjs（--config 指向独立配置，主配置不被改动）');
const assetctl = await import(pathToFileURL(path.join(ROOT, 'scripts/assetctl.mjs')).href);
await fs.rm(REPORT_DIR, { recursive: true, force: true });
const migration = await assetctl.runCli([
  'all',
  `--config=${configRel}`,
  '--out=migration-demo/report',
], { silent: true });
if (migration.exitCode !== 0) {
  console.error('管线返回非零退出码：', migration.exitCode);
  for (const p of migration.budget.problems) console.error('  ', p);
  process.exit(1);
}

/* ④ 独立断言：报告数值必须与资产文件实际字节一致 */
console.log('\n④ 独立断言（报告 vs 资产文件的真实字节）');
const report = JSON.parse(await fs.readFile(path.join(REPORT_DIR, 'asset-report.json'), 'utf8'));
const asset = report.assets[0];
const rawGlb = await fs.readFile(path.join(MODEL_DIR, 'taoguan.glb'));
const expectedGzip = zlib.gzipSync(rawGlb, { level: 9 }).length;
const jsonChunkLength = rawGlb.readUInt32LE(12);
const gltf = JSON.parse(rawGlb.subarray(20, 20 + jsonChunkLength).toString('utf8'));
const primitive = gltf.meshes[0].primitives[0];

const checks = [
  ['报告只含 1 个资产', report.assets.length === 1],
  ['资产 slug 正确', asset.slug === 'taoguan'],
  ['原始字节数与文件一致', asset.totalBytes === rawGlb.length],
  ['gzip 字节数与现场压缩结果一致', asset.gzipBytes === expectedGzip],
  ['识别出 KHR_mesh_quantization 量化', asset.quantization === true],
  ['顶点属性识别完整', asset.attributes.join(',') === 'POSITION,NORMAL,TEXCOORD_0'],
  ['顶点数与 GLB accessor 一致', asset.vertices === gltf.accessors[primitive.attributes.POSITION].count],
  ['三角面数与 GLB 一致', asset.triangles === gltf.accessors[primitive.indices].count / 3],
  ['每顶点 13 字节（位置 6 + 法线 3 + UV 4）', asset.layout.bytesPerVertex === 13],
  ['贴图尺寸被解析出来（64×64）', asset.images[0]?.width === 64 && asset.images[0]?.height === 64],
  ['预算断言全部通过', report.problems.length === 0],
  ['报告记录了配置名', report.pipeline === 'taoguan-migration-check'],
  ['主配置未被改动', JSON.parse(await fs.readFile(path.join(ROOT, 'assetctl.config.json'), 'utf8')).name === mainConfig.name],
];
let pass = 0;
for (const [label, ok] of checks) {
  console.log(`   ${ok ? '✓' : '✗'} ${label}`);
  if (ok) pass++;
}

console.log(`\n   资产实测：${asset.vertices} 顶点 / ${asset.triangles} 三角面 / `
  + `${(asset.totalBytes / 1024).toFixed(1)} KiB（gzip ${(asset.gzipBytes / 1024).toFixed(1)} KiB）`);
console.log(`   字节/顶点 ${asset.layout.bytesPerVertex}，索引 ${asset.indexType}，量化 ${asset.quantization ? '是' : '否'}`);

/* ⑤ 结论 */
console.log('\n' + line);
if (pass === checks.length) {
  console.log(`✓ 迁移验证通过（${pass}/${checks.length}）`);
  console.log('  同一套 assetctl、零代码改动、仅换一份配置，即对一条与江格尔无关的');
  console.log('  量化 GLB 资产产出了完整量化报告。这就是"可复用"的实测证据。');
  console.log(`  报告：${path.relative(ROOT, path.join(REPORT_DIR, 'asset-report.json'))}`);
  console.log(`  资产：${path.relative(ROOT, path.join(MODEL_DIR, 'taoguan.glb'))}`);
} else {
  console.log(`✗ 迁移验证失败：${checks.length - pass} 项断言未通过`);
  process.exit(1);
}
console.log(line);
