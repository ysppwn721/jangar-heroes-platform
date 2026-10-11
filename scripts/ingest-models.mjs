#!/usr/bin/env node
/**
 * 新模型一键接入（AI 图生 3D 重制版专用）。
 *
 * 背景：现有十二尊是 AI 图生 3D，细节本来就少；重制后要保证"换上去就能用"。
 * 这个脚本把"接入"这件事收敛成一条命令，并且在**动手之前**先把源素材体检一遍 ——
 * 因为重制的模型来自混元等外部工具，格式不确定性最大，等跑到一半才报错最浪费人。
 *
 * 为什么要有"体检"：管线对源模型有 5 条硬要求（见 docs/新模型交付要求.md），
 * 其中最容易踩的是**节点必须是精确的 +90° X 旋转** —— 管线靠它把 Z-up 转成 Y-up，
 * 不满足时 `optimize-assets.mjs` 会直接抛 'Unexpected source transform'，
 * 而那时代码已经读了文件、解了 JSON，报错信息也不告诉人该怎么改。
 *
 * 用法：
 *   # 1) 只体检（把新模型放到 models2/<slug>.glb 之后先跑这个）
 *   node scripts/ingest-models.mjs --check
 *
 *   # 2) 体检 + 出两档（预览档 + 精细档），并逐档校验
 *   node scripts/ingest-models.mjs            # 全部英雄
 *   node scripts/ingest-models.mjs jiangger   # 只做一尊（先打样）
 *   QUALITY=high node scripts/ingest-models.mjs jiangger   # 指定精细档画质
 *
 * 产出（与现有管线一致，构建脚本会自动改成内容哈希名）：
 *   public/models/preview/<slug>.glb(.gz)   预览档
 *   public/models/<slug>.glb(.gz)           精细档
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { heroes } from '../src/heroes.js';

const SOURCE_DIR = process.env.SOURCE_DIR || 'models2';
/* 精细档画质的默认值是 **normal**，刻意与仓库里现有产物保持一致。
 * 为什么这点很重要：默认值若取了 high，谁跑一次接入就会把十二尊的精细档整体换成另一档 ——
 * 观感、传输体积、显存占用全变，而人只是想"接入一个模型"。要提档必须显式指定（QUALITY=high）。
 * （实测：试跑 hongguer 时用 high 档，产物哈希与仓库里的 normal 档产物不一致。） */
const QUALITY = ['high', 'max', 'normal'].includes(process.env.QUALITY) ? process.env.QUALITY : 'normal';
const checkOnly = process.argv.includes('--check');
const target = process.argv.slice(2).find(arg => !arg.startsWith('--'));

const selected = heroes.filter(hero => !target || hero.slug === target);
if (!selected.length) {
  console.error(`❌ 没有匹配的英雄。可用 slug：${heroes.map(h => h.slug).join(', ')}`);
  process.exit(1);
}

let failures = 0;
const ok = message => console.log(`   ✅ ${message}`);
const bad = message => { console.log(`   ❌ ${message}`); failures++; };
const warn = message => console.log(`   ⚠️  ${message}`);

/** 读一个 GLB 的头与 JSON 块（不引入任何依赖） */
function readGlb(buffer, file) {
  if (buffer.length < 20) throw new Error(`${file}: 文件过小，不是 GLB`);
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: magic 不是 "glTF"（可能是 .gltf+bin 或未导出的源文件）`);
  const version = buffer.readUInt32LE(4);
  if (version !== 2) throw new Error(`${file}: glTF 版本是 ${version}，需要 2`);
  const jsonSize = buffer.readUInt32LE(12);
  const jsonType = buffer.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) throw new Error(`${file}: 第一个块不是 JSON 块`);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonSize).toString('utf8'));
  return { json, binary: buffer.subarray(28 + jsonSize), version };
}

/** 管线对源模型的 5 条硬要求 + 若干提醒 */
function inspect(hero, buffer, file) {
  const issues = [];
  const notes = [];
  let json = null;
  try { ({ json } = readGlb(buffer, file)); } catch (error) { return { issues: [error.message], notes: [] }; }

  // ① 单一 mesh、单一 primitive（管线只读 meshes[0].primitives[0]）
  const meshes = json.meshes || [];
  if (meshes.length !== 1) issues.push(`有 ${meshes.length} 个 mesh，管线只处理 1 个（多 mesh 请先合并/删除多余网格）`);
  const primitives = meshes[0]?.primitives || [];
  if (primitives.length !== 1) issues.push(`第一个 mesh 有 ${primitives.length} 个 primitive，管线只处理 1 个`);
  const primitive = primitives[0];
  if (!primitive) return { issues: [...issues, '找不到 primitive'], notes };

  // ② 必需属性齐全
  for (const [name, label] of [['POSITION', '顶点位置'], ['NORMAL', '法线'], ['TEXCOORD_0', 'UV']]) {
    if (primitive.attributes?.[name] === undefined) issues.push(`缺少属性 ${name}（${label}）`);
  }
  if (primitive.indices === undefined) issues.push('缺少索引（indices）：管线按索引三角形处理');

  // ③ 节点必须是精确的 +90° X 旋转（Z-up → Y-up 的转换依据）
  const node = (json.nodes || []).find(item => item.mesh === 0);
  if (!node) issues.push('找不到引用 mesh 0 的节点');
  else {
    const r = node.rotation;
    const ok90 = Array.isArray(r) && Math.abs(r[0] - 0.7071068) <= 0.0001 && Math.abs(r[1]) <= 0.0001
      && Math.abs(r[2]) <= 0.0001 && Math.abs(r[3] - 0.7071068) <= 0.0001;
    if (!ok90) {
      issues.push(`节点旋转不是 +90°X 四元数（当前 ${JSON.stringify(r)}）。`
        + '管线靠它把 Z-up 转成 Y-up，不满足会直接抛 Unexpected source transform。'
        + '导出前请在建模/导出设置里选择 Y-up→Z-up 的标准导出，或手动把节点旋转设为 [0.7071068,0,0,0.7071068]。');
    }
    if (node.scale && node.scale.some(v => v !== 1)) notes.push(`节点带缩放 ${JSON.stringify(node.scale)}（管线会照常处理，但建议导出时归一到 1）`);
  }

  // ④ 三张贴图齐全（baseColor / normal / metalRough）
  const material = json.materials?.[primitive.material];
  if (!material) issues.push('找不到材质（materials[primitive.material]）');
  else {
    const pbr = material.pbrMetallicRoughness || {};
    for (const [key, label] of [['baseColorTexture', '基础色贴图'], ['metallicRoughnessTexture', '金属粗糙贴图']]) {
      if (pbr[key]?.index === undefined) issues.push(`缺少${label}`);
    }
    if (material.normalTexture?.index === undefined) issues.push('缺少法线贴图（决定"看起来像不像实物"，本项目画质的最大来源）');
    // 贴图必须是内嵌的（管线直接从 GLB 里读 bufferView）
    for (const [key, label] of [['baseColorTexture', '基础色'], ['metallicRoughnessTexture', '金属粗糙']]) {
      const index = pbr[key]?.index;
      if (index === undefined) continue;
      const image = json.images?.[json.textures?.[index]?.source];
      if (image?.bufferView === undefined) issues.push(`${label}贴图不是内嵌的（需要 GLB 内嵌图片，不能是外部 URI）`);
    }
    const normalTexture = json.textures?.[material.normalTexture?.index]?.source;
    if (normalTexture !== undefined && json.images?.[normalTexture]?.bufferView === undefined) {
      issues.push('法线贴图不是内嵌的（需要 GLB 内嵌图片）');
    }
  }

  // ⑤ 贴图尺寸与面数：只是提醒（决定画质与体积，不阻塞）
  const images = json.images || [];
  for (const [i, image] of images.entries()) {
    const view = json.bufferViews?.[image.bufferView];
    if (view) notes.push(`贴图 ${i}：${image.mimeType || '未知格式'} ${(view.byteLength / 1048576).toFixed(2)} MiB`);
    if (image.mimeType && image.mimeType !== 'image/png' && image.mimeType !== 'image/jpeg') {
      issues.push(`贴图 ${i} 是 ${image.mimeType}：管线用 sharp 解码，请导出 PNG 或 JPEG`);
    }
  }
  const positionAccessor = json.accessors?.[primitive.attributes?.POSITION];
  if (positionAccessor) {
    notes.push(`顶点 ${positionAccessor.count.toLocaleString()}`);
    if (positionAccessor.componentType === 5126 && !positionAccessor.normalized) notes.push('顶点位置是未归一化的 float（管线支持，但量化后传得更小）');
  }
  const indexAccessor = json.accessors?.[primitive.indices];
  if (indexAccessor) {
    notes.push(`三角形约 ${Math.round(indexAccessor.count / 3).toLocaleString()}（源素材 150 万面是当前基准，建议不要低于它）`);
    if (indexAccessor.count / 3 < 200000) warn(`${hero.name} 只有约 ${Math.round(indexAccessor.count / 3).toLocaleString()} 面，低于当前基准 150,198 面，细节可能反而更少`);
  }
  return { issues, notes };
}

/** 找 sharp（贴图编码用）。
 *
 * 为什么要有这段探测：sharp 是**开发期**依赖，本项目刻意不装（保持零依赖；官网运行时完全不需要它），
 * 但本机/队友机器上可能在别处已经有一份。让它自动找，比让人去理解"为什么出档报 Cannot find module"好得多。
 * 实在找不到时给出**明确可执行**的两条路，而不是一句报错。
 */
function resolveSharp() {
  if (process.env.SHARP_MODULE) return { spec: process.env.SHARP_MODULE, auto: false };
  const candidates = [
    'sharp',
    path.resolve('node_modules/sharp'),
    path.resolve('.cache/node_modules/sharp'),
    process.env.SHARP_FALLBACK || '',
  ].filter(Boolean);
  for (const spec of candidates) {
    try { require.resolve(spec); return { spec, auto: spec !== 'sharp' }; } catch { /* 继续找 */ }
  }
  return null;
}
const sharp = resolveSharp();

console.log(`═══ 新模型接入 ${checkOnly ? '（只体检）' : `（体检 + 出档，精细档画质 ${QUALITY}）`} ═══\n`);
console.log(`源目录：${SOURCE_DIR}/　目标：public/models/preview/ + public/models/`);

if (!sharp) {
  warn('本机找不到 sharp —— 只做体检没问题；**出档**需要它把贴图编码成 JPEG。两条路任选：');
  console.log('      · 临时指定已有的一份：$env:SHARP_MODULE="D:\\path\\to\\node_modules\\sharp"');
  console.log('      · 或在本项目装一次（开发依赖，不影响官网运行时）：npm i -D sharp');
  if (!checkOnly) {
    console.error('\n❌ 出档需要 sharp，已中止（没有改动任何产物）。');
    process.exit(1);
  }
} else if (sharp.auto) {
  console.log(`   · 使用已有的 sharp：${sharp.spec}`);
}

const report = [];
for (const hero of selected) {
  const file = path.join(SOURCE_DIR, `${hero.slug}.glb`);
  console.log(`\n── ${hero.name}（${hero.slug}）`);
  if (!existsSync(file)) {
    bad(`没有源模型：${file}（把重制好的 GLB 放成这个名字即可）`);
    report.push({ slug: hero.slug, status: 'missing' });
    continue;
  }
  const buffer = await fs.readFile(file);
  console.log(`   源文件 ${(buffer.length / 1048576).toFixed(2)} MiB`);
  const { issues, notes } = inspect(hero, buffer, file);
  for (const note of notes) console.log(`   · ${note}`);
  if (issues.length) {
    for (const issue of issues) bad(issue);
    report.push({ slug: hero.slug, status: 'rejected', issues });
    continue;
  }
  ok('源素材体检通过（5 条硬要求全部满足）');
  report.push({ slug: hero.slug, status: 'checked' });
}

if (failures) {
  console.log(`\n=== 汇总 ===\n❌ ${failures} 处不符合管线要求 —— 先按上面的提示改源素材（详见 docs/新模型交付要求.md），再跑一次。`);
  console.log('   本次没有改动任何产物。');
  process.exit(1);
}

if (checkOnly) {
  console.log('\n=== 汇总 ===\n✅ 体检全部通过。接着跑 `node scripts/ingest-models.mjs` 出两档。');
  process.exit(0);
}

/* ---------------------------------------------------------------- *
 * 出档：调用既有管线，逐档校验
 * ---------------------------------------------------------------- */
console.log('\n═══ 出档 ═══');
const run = (args, env) => {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) {
    console.error(`❌ 失败：node ${args.join(' ')}`);
    process.exit(result.status || 1);
  }
};
console.log(`\n① 预览档（轻量，首屏与离线预缓存用）`);
run(['scripts/optimize-assets.mjs', ...(target ? [target] : []), '--preview']);
console.log(`\n② 精细档（QUALITY=${QUALITY}，细看时加载）`);
run(['scripts/optimize-assets.mjs', ...(target ? [target] : [])], { QUALITY });
console.log('\n③ 产物校验（属性类型 / 高度 / 索引范围 / 体积预算）');
run(['scripts/check-assets.mjs']);

console.log('\n=== 汇总 ===');
console.log('✅ 两档已生成并通过校验。接下来：');
console.log('   · npm run build          → 生成内容哈希名与离线预缓存清单');
console.log('   · npm run preview        → 本地打开对比观感');
console.log('   · node scripts/audit:visual（可选）→ 截图对比画质变化');
