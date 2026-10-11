#!/usr/bin/env node
/**
 * assetctl —— 面向超大规模非遗三维资产的构建期处理管线
 *
 * 这个文件是"作品是软件"的第一份证据：它把原先散落在十几个一次性脚本里的
 * 资产处理逻辑收敛成一条**配置驱动、可复跑、可出报告**的命令行工具链。
 *
 * 设计取舍（为什么不用 Three.js / glTF-Transform / Draco）：
 *   运行时目标同时包含浏览器与微信小程序。小程序主包上限 1.5 MB，
 *   且不允许下载外部解码器；Draco 需要附带第三方解码器代码。
 *   因此这里只做两件被标准支持的事——
 *     ① 顶点量化（KHR_mesh_quantization，glTF 官方扩展）
 *     ② 顶点属性紧凑存储 + gzip 传输
 *   解压完全由我们自己的运行时完成，不引入任何第三方代码。
 *
 * 用法：
 *   node scripts/assetctl.mjs verify                  校验现有资产是否满足预算与完整性
 *   node scripts/assetctl.mjs report [--json|--md]     生成逐资产量化报告
 *   node scripts/assetctl.mjs cache                    生成顶点缓存效率（ACMR）报告
 *   node scripts/assetctl.mjs all                      以上全部 + 写出报告文件
 *   node scripts/assetctl.mjs budget                   只跑预算断言
 *
 * 选项：
 *   --tier=preview|detail|all   限定处理的资产级别（默认 all）
 *   --out=<dir>                 报告输出目录（默认 reports/）
 *   --quiet                     只输出结论行
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gunzip = promisify(zlib.gunzip);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ────────────────────────────── 参数解析 ────────────────────────────── */

// 参数解析已移入 runCli()，模块级只保留"默认配置路径"——这样被 import 时没有副作用。
//
// 配置用 let 而非 const，并支持 CLI 的 `--config=` 覆盖。
// 为什么必须有这个能力：迁移验证需要把同一套管线指向**另一批资产**。
// 早先的做法是"临时替换主配置文件、跑完再还原"——那不是可接受的工程做法：
// 中途抛错或进程被杀，主配置就永久留在被替换的状态。现在改为显式传入配置路径。
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'assetctl.config.json');
let config = JSON.parse(await fs.readFile(DEFAULT_CONFIG_PATH, 'utf8'));

/* ────────────────────────────── GLB 解析 ────────────────────────────── */

/**
 * 只读 GLB 头部与 JSON chunk。不展开二进制数据——报告阶段只需要元信息，
 * 展开二进制是运行时（渲染引擎）的事，两者职责分离。
 */
function readGlbContainer(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  const version = buffer.readUInt32LE(4);
  const totalLength = buffer.readUInt32LE(8);
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  return { version, totalLength, json, binaryOffset: 28 + jsonLength };
}

function chunkBytes(json) {
  let geometry = 0;
  let textures = 0;
  const imageViews = new Set();
  for (const image of json.images || []) {
    if (image.bufferView !== undefined) imageViews.add(image.bufferView);
  }
  (json.bufferViews || []).forEach((view, index) => {
    if (imageViews.has(index)) textures += view.byteLength;
    else geometry += view.byteLength;
  });
  return { geometry, textures };
}

/** 从 JPEG/PNG 头部读真实像素尺寸——报告里的贴图尺寸必须来自文件本身，不能靠文件名猜。 */
function imageDimensions(buffer, offset, mimeType) {
  if (mimeType === 'image/png' && buffer.readUInt32BE(offset) === 0x89504e47) {
    return { width: buffer.readUInt32BE(offset + 16), height: buffer.readUInt32BE(offset + 20) };
  }
  if (mimeType === 'image/jpeg') {
    let cursor = offset + 2;
    const end = offset + buffer.length;
    while (cursor < end - 1) {
      if (buffer[cursor] !== 0xff) { cursor++; continue; }
      const marker = buffer[cursor + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buffer.readUInt16BE(cursor + 5), width: buffer.readUInt16BE(cursor + 7) };
      }
      cursor += 2 + buffer.readUInt16BE(cursor + 2);
    }
  }
  return { width: 0, height: 0 };
}

const COMPONENT = {
  5120: { name: 'i8', bytes: 1 },
  5121: { name: 'u8', bytes: 1 },
  5122: { name: 'i16', bytes: 2, normalized: true },
  5123: { name: 'u16', bytes: 2 },
  5125: { name: 'u32', bytes: 4 },
  5126: { name: 'f32', bytes: 4 },
};
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** 逐属性计算真实的每顶点字节数。这是"紧凑存储"主张的量化依据。 */
function vertexLayout(primitive, json) {
  const rows = [];
  let bytesPerVertex = 0;
  let isQuantized = false;
  for (const [semantic, accessorIndex] of Object.entries(primitive.attributes)) {
    const accessor = json.accessors[accessorIndex];
    const component = COMPONENT[accessor.componentType];
    const components = TYPE_COMPONENTS[accessor.type];
    const stride = component.bytes * components;
    bytesPerVertex += stride;
    if (component.normalized) isQuantized = true;
    rows.push({
      semantic,
      componentType: component.name,
      normalized: Boolean(component.normalized),
      components,
      bytesPerVertex: stride,
    });
  }
  // 交错存储时还会补齐到 4 字节边界（glTF 要求 accessor 偏移对齐）
  const alignedStride = Math.ceil(bytesPerVertex / 4) * 4;
  return { rows, bytesPerVertex, alignedStride, isQuantized };
}

/* ────────────────────────────── 资产扫描 ────────────────────────────── */

async function collectAssets(tierFilter = 'all') {
  const tiers = tierFilter === 'all' ? Object.keys(config.tiers) : [tierFilter];
  const assets = [];
  for (const tier of tiers) {
    const spec = config.tiers[tier];
    if (!spec) throw new Error(`unknown tier: ${tier}`);
    const dir = path.join(ROOT, spec.outputDir);
    let names;
    try {
      names = (await fs.readdir(dir)).filter(n => n.endsWith('.glb'));
    } catch {
      continue; // 该级别尚未产出
    }
    for (const name of names.sort()) {
      const file = path.join(dir, name);
      const slug = name.replace(/\.glb$/, '');
      const buffer = await fs.readFile(file);
      const { version, json, binaryOffset } = readGlbContainer(buffer);

      let gzipBytes = null;
      try {
        gzipBytes = (await fs.readFile(`${file}.gz`)).length;
      } catch {
        // 没有 .gz 时现场 gzip 一次，保证报告口径一致
        gzipBytes = zlib.gzipSync(buffer, { level: 9 }).length;
      }

      const primitive = json.meshes[0].primitives[0];
      const position = json.accessors[primitive.attributes.POSITION];
      const indices = json.accessors[primitive.indices];
      const material = json.materials[primitive.material];
      const layout = vertexLayout(primitive, json);
      const { geometry, textures } = chunkBytes(json);

      const textureRoles = [
        ['baseColor', material.pbrMetallicRoughness?.baseColorTexture?.index],
        ['normal', material.normalTexture?.index],
        ['metalRough', material.pbrMetallicRoughness?.metallicRoughnessTexture?.index],
      ];
      const images = [];
      for (const [role, textureIndex] of textureRoles) {
        if (textureIndex === undefined) continue;
        const image = json.images[json.textures[textureIndex].source];
        if (image.bufferView === undefined) {
          images.push({ role, format: 'external', bytes: 0, width: 0, height: 0, gpuWithMips: 0 });
          continue;
        }
        const view = json.bufferViews[image.bufferView];
        const offset = binaryOffset + (view.byteOffset || 0);
        const slice = buffer.subarray(offset, offset + view.byteLength);
        const { width, height } = imageDimensions(buffer, offset, image.mimeType);
        images.push({
          role,
          format: image.mimeType || 'unknown',
          bytes: view.byteLength,
          width,
          height,
          // GPU 常开 mipmap：RGBA8 基础上再乘 4/3
          gpuWithMips: Math.round(width * height * 4 * 4 / 3),
        });
      }

      assets.push({
        tier,
        slug,
        file: path.relative(ROOT, file).replaceAll('\\', '/'),
        glbVersion: version,
        totalBytes: buffer.length,
        gzipBytes,
        geometryBytes: geometry,
        textureBytes: textures,
        vertices: position.count,
        triangles: Math.round(indices.count / 3),
        indexType: COMPONENT[indices.componentType].name,
        indexComponentType: indices.componentType,
        attributes: Object.keys(primitive.attributes),
        layout,
        quantization: (json.extensionsUsed || []).includes('KHR_mesh_quantization'),
        extensionsUsed: json.extensionsUsed || [],
        images,
        textureGPUBytes: images.reduce((sum, i) => sum + i.gpuWithMips, 0),
      });
    }
  }
  return assets;
}

/* ──────────────────────────── 顶点缓存效率 ──────────────────────────── */

/**
 * ACMR（Average Cache Miss Ratio）—— GPU 后变换缓存命中率的行业指标。
 * 1.0 左右是理想值；越大表示顶点重复读取越多。
 * 这里用简化模型模拟 FIFO 顶点缓存，仅用于**同一批资产内部横向比较**，
 * 不代表真实驱动的绝对值。
 */
function acmr(indices, cacheSize) {
  const cache = [];
  const inCache = new Set();
  let misses = 0;
  for (const index of indices) {
    if (inCache.has(index)) continue;
    misses++;
    if (cache.length >= cacheSize) {
      const evicted = cache.shift();
      inCache.delete(evicted);
    }
    cache.push(index);
    inCache.add(index);
  }
  return indices.length ? misses / (indices.length / 3) : 0;
}

function readIndices(buffer, json, accessorIndex, binaryOffset) {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const component = COMPONENT[accessor.componentType];
  const start = binaryOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const count = accessor.count;
  const indices = new Array(count);
  for (let i = 0; i < count; i++) {
    const at = start + i * component.bytes;
    indices[i] = component.bytes === 2 ? buffer.readUInt16LE(at) : buffer.readUInt32LE(at);
  }
  return indices;
}

async function collectCacheReport(assets) {
  const rows = [];
  for (const asset of assets) {
    const buffer = await fs.readFile(path.join(ROOT, asset.file));
    const { json, binaryOffset } = readGlbContainer(buffer);
    const primitive = json.meshes[0].primitives[0];
    const indices = readIndices(buffer, json, primitive.indices, binaryOffset);
    const unique = new Set(indices).size;
    rows.push({
      tier: asset.tier,
      slug: asset.slug,
      vertices: asset.vertices,
      triangles: asset.triangles,
      indicesReferenced: unique,
      reuseRatio: Number((indices.length / unique).toFixed(2)),
      acmr32: Number(acmr(indices, 32).toFixed(3)),
      acmr16: Number(acmr(indices, 16).toFixed(3)),
      indexType: asset.indexType,
    });
  }
  return rows;
}

/* ────────────────────────────── 预算断言 ────────────────────────────── */

function checkBudget(assets) {
  const problems = [];
  for (const asset of assets) {
    const spec = config.tiers[asset.tier];
    // 传输预算：gzip 字节数。决定用户实际下载多少、缓存占多少。
    if (asset.gzipBytes > spec.transferBudget) {
      problems.push({
        level: 'fail',
        asset: asset.file,
        metric: 'transfer',
        rule: `${asset.tier} 传输体积 ≤ ${spec.transferBudgetHuman}`,
        actual: `${(asset.gzipBytes / 1024).toFixed(0)} KiB gzip`,
      });
    }
    // 原始体积预算：只受部署平台单文件上限约束，与传输量无关。
    if (spec.rawBudget && asset.totalBytes > spec.rawBudget) {
      problems.push({
        level: 'fail',
        asset: asset.file,
        metric: 'raw',
        rule: `${asset.tier} 原始体积 ≤ ${spec.rawBudgetHuman}`,
        actual: `${(asset.totalBytes / 1048576).toFixed(2)} MiB`,
      });
    }
    if (asset.totalBytes > config.budgets.cloudflareSingleFileBytes) {
      problems.push({
        level: 'fail',
        asset: asset.file,
        metric: 'raw',
        rule: `部署平台单文件 ≤ ${config.budgets.cloudflareSingleFileHuman}`,
        actual: `${(asset.totalBytes / 1048576).toFixed(2)} MiB`,
      });
    }
    // 索引类型必须与级别声明一致：轻量版用 u16 才省一半索引字节。
    // 声明为 'auto' 表示不做强制——迁移验证时资产规模未知，
    // 小网格用 u16、大网格用 u32 都合理，此时强制任一种都是错的。
    if (spec.indexComponentType !== 'auto' && asset.indexComponentType !== spec.indexComponentType) {
      problems.push({
        level: 'warn',
        asset: asset.file,
        metric: 'layout',
        rule: `${asset.tier} 索引类型应为 ${spec.indexTypeName}`,
        actual: asset.indexType,
      });
    }
    // 量化扩展是这套管线的核心主张，缺失说明该资产没走量化路径
    if (!asset.quantization) {
      problems.push({
        level: 'warn',
        asset: asset.file,
        metric: 'layout',
        rule: '应使用 KHR_mesh_quantization 量化顶点',
        actual: '未使用',
      });
    }
  }

  // 精细版总量按传输体积核算（这是用户真实下载量），与 check-assets.mjs 口径一致
  const detailTotal = assets
    .filter(a => a.tier === 'detail')
    .reduce((sum, a) => sum + a.gzipBytes, 0);
  if (detailTotal > config.budgets.detailTierTotalBytes) {
    problems.push({
      level: 'fail',
      asset: '(精细版合计)',
      metric: 'transfer',
      rule: `精细版传输总量 ≤ ${config.budgets.detailTierTotalHuman}`,
      actual: `${(detailTotal / 1048576).toFixed(2)} MiB gzip`,
    });
  }

  return { problems, detailTotal };
}

/* ─────────────────── manifest 生成与一致性断言 ─────────────────── */
/**
 * public/models/manifest.json 是**对外发布**的资产清单，材料与文档会引用它。
 * 它一旦与实际 GLB 不一致，就直接踩竞赛前置审查的「材料与实际成果一致」。
 *
 * 本仓库曾真实发生过：江格尔一尊被重新接入（150,198 面 → 252,732 面），
 * 但 manifest 未同步，且没有任何检查会发现——因为校验只读实际文件。
 * 因此这里做两件事：
 *   ① `--write-manifest` 从实际 GLB 二进制重新生成；
 *   ② `verify` 阶段断言 manifest 与实际情况逐字段一致，不一致即构建失败。
 */
function buildManifest(assets) {
  const originals = config.originals?.models || {};
  return {
    generatedAt: new Date().toISOString(),
    generator: 'scripts/assetctl.mjs --write-manifest',
    format: 'Self-contained GLB 2.0 with KHR_mesh_quantization; native gzip transport, no external decoder',
    note: '本文件由 assetctl 从实际 GLB 二进制生成。修改资产后必须重跑 --write-manifest，否则 assetctl verify 会失败。',
    models: assets
      .filter(a => a.tier === 'detail')
      .map(a => {
        const origin = originals[a.slug] || {};
        return {
          file: `${a.slug}.glb`,
          sourceBytes: origin.sourceBytes ?? null,
          originalTriangles: origin.originalTriangles ?? null,
          bytes: a.totalBytes,
          transferBytes: a.gzipBytes,
          triangles: a.triangles,
          vertices: a.vertices,
          bytesPerVertex: Number((a.totalBytes / Math.max(1, a.vertices)).toFixed(2)),
          indexType: a.indexType,
          textures: a.images.map(i => ({ role: i.role, format: i.format, width: i.width, height: i.height, bytes: i.bytes })),
        };
      }),
  };
}

async function checkManifest(assets) {
  const problems = [];
  // manifest 位置由配置决定，默认是主站清单。
  // 迁移验证用的是另一批资产、另一份清单，因此必须可配——否则会拿江格尔的清单
  // 去比对陶罐资产，产出一堆无意义的"多余条目"。
  const rel = config.manifestPath || 'public/models/manifest.json';
  const target = path.join(ROOT, rel);

  // 若本次采集里没有 detail 级资产，说明这不是"主站资产集"，
  // 清单一致性检查不适用，直接跳过（迁移演示就属于这种情况）。
  const detailAssets = assets.filter(a => a.tier === 'detail');
  if (!detailAssets.length) return problems;

  let committed;
  try {
    committed = JSON.parse(await fs.readFile(target, 'utf8'));
  } catch {
    if (!config.manifestPath) {
      problems.push({ level: 'fail', asset: rel, metric: 'manifest', rule: '清单缺失或不可解析', actual: '读取失败' });
    }
    return problems;
  }
  const fresh = buildManifest(assets);
  const byFile = new Map((committed.models || []).map(m => [m.file, m]));
  for (const model of fresh.models) {
    const old = byFile.get(model.file);
    if (!old) {
      problems.push({ level: 'fail', asset: `manifest:${model.file}`, metric: 'manifest', rule: '清单缺少该资产', actual: '缺失' });
      continue;
    }
    for (const field of ['bytes', 'transferBytes', 'triangles', 'vertices']) {
      if (old[field] !== model[field]) {
        problems.push({
          level: 'fail',
          asset: `manifest:${model.file}`,
          metric: 'manifest',
          rule: `${field} 应与实际资产一致`,
          actual: `清单 ${old[field]} ≠ 实际 ${model[field]}`,
        });
      }
    }
  }
  for (const file of byFile.keys()) {
    if (!fresh.models.some(m => m.file === file)) {
      problems.push({ level: 'warn', asset: `manifest:${file}`, metric: 'manifest', rule: '清单中存在实际不存在的资产', actual: '多余条目' });
    }
  }
  return problems;
}

/* ────────────────────────────── 报告渲染 ────────────────────────────── */

const mib = n => (n / 1048576).toFixed(2);
const kib = n => (n / 1024).toFixed(0);

function renderConsole(assets, cache, budget) {
  const lines = [];
  lines.push('assetctl · 三维资产处理管线报告');
  lines.push('='.repeat(96));
  lines.push(
    'file'.padEnd(44),
    'total'.padStart(9), 'gzip'.padStart(9), 'geom'.padStart(8),
    'tex'.padStart(8), 'verts'.padStart(8), 'tris'.padStart(8),
    'idx'.padStart(4), 'B/vtx'.padStart(6),
  );
  for (const asset of assets) {
    lines.push(
      asset.file.padEnd(44),
      `${kib(asset.totalBytes)}K`.padStart(9),
      `${kib(asset.gzipBytes)}K`.padStart(9),
      `${kib(asset.geometryBytes)}K`.padStart(8),
      `${kib(asset.textureBytes)}K`.padStart(8),
      String(asset.vertices).padStart(8),
      String(asset.triangles).padStart(8),
      asset.indexType.padStart(4),
      String(asset.layout.bytesPerVertex).padStart(6),
    );
  }

  const sum = key => assets.reduce((total, a) => total + a[key], 0);
  lines.push('');
  lines.push(`合计 ${assets.length} 个资产：`);
  lines.push(`  原始 ${mib(sum('totalBytes'))} MiB → gzip ${mib(sum('gzipBytes'))} MiB` +
    `（几何 ${mib(sum('geometryBytes'))} MiB / 贴图 ${mib(sum('textureBytes'))} MiB）`);
  lines.push(`  顶点 ${sum('vertices').toLocaleString()} / 三角面 ${sum('triangles').toLocaleString()}`);
  lines.push(`  GPU 贴图常驻（含 mipmap）${mib(sum('textureGPUBytes'))} MiB`);

  for (const tier of Object.keys(config.tiers)) {
    const group = assets.filter(a => a.tier === tier);
    if (!group.length) continue;
    const spec = config.tiers[tier];
    const raw = group.reduce((s, a) => s + a.totalBytes, 0);
    const gz = group.reduce((s, a) => s + a.gzipBytes, 0);
    lines.push(`  ${tier.padEnd(8)} ${spec.label}  ${group.length} 个` +
      `，传输上限 ${spec.transferBudgetHuman}/个（实测均 gzip ${kib(gz / group.length)}K，原始均 ${kib(raw / group.length)}K）`);
  }

  if (cache.length) {
    lines.push('');
    lines.push('顶点缓存效率（ACMR，越低越好；1.0 为理想）：');
    lines.push('  ' + 'tier'.padEnd(9) + 'model'.padEnd(20) + 'verts'.padStart(8) +
      'tris'.padStart(8) + 'reuse'.padStart(7) + 'ACMR32'.padStart(8) + 'ACMR16'.padStart(8));
    for (const row of cache) {
      lines.push('  ' + row.tier.padEnd(9) + row.slug.padEnd(20) +
        String(row.vertices).padStart(8) + String(row.triangles).padStart(8) +
        String(row.reuseRatio).padStart(7) + String(row.acmr32).padStart(8) + String(row.acmr16).padStart(8));
    }
    const avg32 = cache.reduce((s, r) => s + r.acmr32, 0) / cache.length;
    const avg16 = cache.reduce((s, r) => s + r.acmr16, 0) / cache.length;
    lines.push(`  平均 ACMR32 ${avg32.toFixed(3)} / ACMR16 ${avg16.toFixed(3)}` +
      `（越小越好；已按 16 位索引预检，决定是否值得退回 u16）`);
  }

  // 原始 → 产出 的总账：这一节回答"这套管线到底省了多少"
  const originals = config.originals?.models || {};
  const detail = assets.filter(a => a.tier === 'detail');
  const knownOriginal = detail.reduce((sum, a) => sum + (originals[a.slug]?.sourceBytes || 0), 0);
  const knownTriangles = detail.reduce((sum, a) => sum + (originals[a.slug]?.originalTriangles || 0), 0);
  if (knownOriginal) {
    const detailRaw = detail.reduce((s, a) => s + a.totalBytes, 0);
    const detailGz = detail.reduce((s, a) => s + a.gzipBytes, 0);
    lines.push('');
    lines.push('原始 → 产出（精细版 12 尊）：');
    lines.push(`  原始 ${mib(knownOriginal)} MiB → 产出 ${mib(detailRaw)} MiB（${(100 * detailRaw / knownOriginal).toFixed(1)}%）` +
      ` → gzip 传输 ${mib(detailGz)} MiB（${(100 * detailGz / knownOriginal).toFixed(1)}%）`);
    lines.push(`  三角面 ${knownTriangles.toLocaleString()} → ${detail.reduce((s, a) => s + a.triangles, 0).toLocaleString()}` +
      `（保留 ${(100 * detail.reduce((s, a) => s + a.triangles, 0) / knownTriangles).toFixed(1)}%）`);
  }

  lines.push('');
  lines.push('预算断言：');
  if (!budget.problems.length) {
    lines.push('  ✓ 全部通过（含 manifest 与实际资产一致性）');
  } else {
    for (const p of budget.problems) {
      lines.push(`  ${p.level === 'fail' ? '✗' : '!'} [${p.metric || '—'}] ${p.asset} — ${p.rule}（实际 ${p.actual}）`);
    }
  }
  return lines.join('\n');
}

function renderMarkdown(assets, cache, budget) {
  const sum = key => assets.reduce((total, a) => total + a[key], 0);
  const out = [];
  out.push('# 三维资产处理管线 · 量化报告');
  out.push('');
  out.push(`生成时间：${new Date().toISOString()}`);
  out.push(`管线版本：${config.name}`);
  out.push('');
  out.push('本报告由 `node scripts/assetctl.mjs all` 生成。产出指标全部从 GLB 二进制头部直接解析，可复跑复现，不引用任何手写数字。');
  out.push('');
  out.push('## 一、预算口径说明');
  out.push('');
  out.push('| 指标 | 含义 | 约束 |');
  out.push('|---|---|---|');
  // 预算表述按**实际存在的级别**生成。早先硬编码 tiers.preview / tiers.detail，
  // 于是单级别配置（例如迁移验证）会在这里抛 TypeError 崩掉——
  // 报告渲染不该假设配置里有哪几档。
  const budgetRows = Object.entries(config.tiers).map(([key, spec]) => {
    const parts = [`${spec.label || key} 传输 ${spec.transferBudgetHuman}/个`];
    if (spec.rawBudgetHuman) parts.push(`原始 ${spec.rawBudgetHuman}/个`);
    return parts.join('；');
  });
  out.push(`| 传输体积（gzip） | 用户实际下载量与缓存占用 | ${budgetRows.join('；')} |`);
  out.push(`| 原始体积（GLB） | 部署平台单文件上限 | 平台硬限 ${config.budgets.cloudflareSingleFileHuman} |`);
  out.push('');
  out.push('两个指标分管两件事，**不能混用**：拿 gzip 体积当磁盘体积会低估，拿原始体积当传输体积会高估。');
  out.push('');
  out.push('## 二、逐资产构成');
  out.push('');
  out.push('| 资产 | 级别 | 原始 | gzip | 几何 | 贴图 | 顶点 | 三角面 | 索引 | 字节/顶点 | 量化 |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const a of assets) {
    out.push(`| \`${a.file}\` | ${config.tiers[a.tier].label} | ${kib(a.totalBytes)} KiB | ${kib(a.gzipBytes)} KiB | ` +
      `${kib(a.geometryBytes)} KiB | ${kib(a.textureBytes)} KiB | ${a.vertices.toLocaleString()} | ` +
      `${a.triangles.toLocaleString()} | ${a.indexType} | ${a.layout.bytesPerVertex} | ${a.quantization ? 'KHR_mesh_quantization' : '无'} |`);
  }
  out.push('');
  out.push('## 三、合计');
  out.push('');
  out.push(`- 资产数量：${assets.length}`);
  out.push(`- 原始体积合计：**${mib(sum('totalBytes'))} MiB**`);
  out.push(`- gzip 传输体积合计：**${mib(sum('gzipBytes'))} MiB**（压缩率 ${(100 * (1 - sum('gzipBytes') / sum('totalBytes'))).toFixed(1)}%）`);
  out.push(`- 几何 ${mib(sum('geometryBytes'))} MiB / 贴图 ${mib(sum('textureBytes'))} MiB`);
  out.push(`- 顶点合计 ${sum('vertices').toLocaleString()}，三角面合计 ${sum('triangles').toLocaleString()}`);
  out.push(`- GPU 贴图常驻（含 mipmap）：${mib(sum('textureGPUBytes'))} MiB`);
  out.push('');

  const originals = config.originals?.models || {};
  const detail = assets.filter(a => a.tier === 'detail');
  const knownOriginal = detail.reduce((s, a) => s + (originals[a.slug]?.sourceBytes || 0), 0);
  if (knownOriginal) {
    const dRaw = detail.reduce((s, a) => s + a.totalBytes, 0);
    const dGz = detail.reduce((s, a) => s + a.gzipBytes, 0);
    const dTri = detail.reduce((s, a) => s + a.triangles, 0);
    const oTri = detail.reduce((s, a) => s + (originals[a.slug]?.originalTriangles || 0), 0);
    out.push('## 四、原始 → 产出');
    out.push('');
    out.push('| 阶段 | 体积 | 相对原始 |');
    out.push('|---|---|---|');
    out.push(`| 原始采集资产（models2/，仓库外） | ${mib(knownOriginal)} MiB | 100% |`);
    out.push(`| 精细版产出 | ${mib(dRaw)} MiB | ${(100 * dRaw / knownOriginal).toFixed(1)}% |`);
    out.push(`| 精细版 gzip 传输 | ${mib(dGz)} MiB | ${(100 * dGz / knownOriginal).toFixed(1)}% |`);
    out.push('');
    out.push(`三角面 ${oTri.toLocaleString()} → ${dTri.toLocaleString()}（保留 ${(100 * dTri / oTri).toFixed(1)}%）`);
    out.push('');
  }

  out.push('## 五、顶点属性布局');
  out.push('');
  const sample = assets[0];
  if (sample) {
    out.push('以 `' + sample.file + '` 为例：');
    out.push('');
    out.push('| 属性 | 分量类型 | 归一化 | 分量数 | 字节/顶点 |');
    out.push('|---|---|---|---|---|');
    for (const row of sample.layout.rows) {
      out.push(`| ${row.semantic} | ${row.componentType} | ${row.normalized ? '是' : '否'} | ${row.components} | ${row.bytesPerVertex} |`);
    }
    out.push('');
    out.push(`合计 **${sample.layout.bytesPerVertex} 字节/顶点**，交错存储补齐到 **${sample.layout.alignedStride} 字节**（4 字节对齐）。`);
  }
  out.push('');
  out.push('## 六、顶点缓存效率（ACMR）');
  out.push('');
  out.push('| 级别 | 模型 | 顶点 | 三角面 | 索引复用比 | ACMR32 | ACMR16 |');
  out.push('|---|---|---|---|---|---|---|');
  for (const r of cache) {
    out.push(`| ${r.tier} | ${r.slug} | ${r.vertices.toLocaleString()} | ${r.triangles.toLocaleString()} | ${r.reuseRatio} | ${r.acmr32} | ${r.acmr16} |`);
  }
  out.push('');
  out.push('> ACMR（Average Cache Miss Ratio）用 FIFO 顶点缓存简化模型估算，仅用于**同一批资产内部横向比较**，不代表真实驱动的绝对值。');
  out.push('');
  out.push('## 七、预算与一致性断言');
  out.push('');
  if (!budget.problems.length) {
    out.push('✓ 全部通过：传输体积、原始体积、部署平台单文件上限、索引类型、量化扩展，以及 **manifest 与实际资产一致性**。');
  } else {
    out.push('| 级别 | 指标 | 资产 | 规则 | 实际 |');
    out.push('|---|---|---|---|---|');
    for (const p of budget.problems) {
      out.push(`| ${p.level === 'fail' ? '✗ 失败' : '! 警告'} | ${p.metric || '—'} | \`${p.asset}\` | ${p.rule} | ${p.actual} |`);
    }
  }
  out.push('');
  out.push('## 八、运行时约束');
  out.push('');
  out.push('| 约束 | 值 |');
  out.push('|---|---|');
  out.push(`| 外部库 | ${config.runtimeConstraints.externalLibraries.length === 0 ? '无' : config.runtimeConstraints.externalLibraries.join(', ')} |`);
  out.push(`| Draco 解码器 | ${config.runtimeConstraints.dracoDecoder ? '需要' : '不需要'} |`);
  out.push(`| Three.js | ${config.runtimeConstraints.threeJs ? '使用' : '不使用'} |`);
  out.push(`| CDN 依赖 | ${config.runtimeConstraints.cdnDependencies ? '有' : '无'} |`);
  out.push('');
  out.push(`> ${config.runtimeConstraints.note}`);
  out.push('');
  return out.join('\n');
}


/* ---- 主流程 ---- */

/**
 * ⚠️ 这一段必须只在"本文件被直接执行"时运行，绝不能在"被 import"时运行。
 *
 * 因为主流程末尾会调用 process.exit()。构建流程（scripts/build.mjs）需要把
 * 资产校验并进同一次构建，于是静态 import 了本文件——结果 import 副作用里的
 * process.exit() 把构建进程**静默终止**了：构建打印到最后一条校验信息就结束，
 * 看起来像"构建成功"，实际后续阶段（生成页面、打包 dist）一行都没跑。
 * 这个坑真实发生过，所以这里用直接执行判定把它隔离掉。
 *
 * 被 import 时导出 runCli()，由调用方决定失败如何处理（抛错，不杀进程）。
 */
export async function runCli(argv = process.argv.slice(2), { silent = false } = {}) {
  const flag = name => argv.some(a => a === `--${name}`);
  const option = (name, fallback) => {
    const hit = argv.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const command = argv.find(a => !a.startsWith('--')) || 'verify';
  const quiet = silent || flag('quiet');
  const localOutDir = path.resolve(ROOT, option('out', 'reports'));
  const localTier = option('tier', 'all');

  // 配置可在本次调用内被覆盖：迁移验证就是靠这个把同一套管线指向另一批资产，
  // 而不需要"临时替换主配置再还原"（那种做法中途失败会留下损坏的配置）。
  const configPath = path.resolve(ROOT, option('config', DEFAULT_CONFIG_PATH));
  config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  if (!quiet && configPath !== DEFAULT_CONFIG_PATH) {
    console.log(`配置：${path.relative(ROOT, configPath)}（${config.name}）`);
  }

  const assets = await collectAssets(localTier);
  if (!assets.length) {
    throw new Error(`没有找到任何资产（tier=${localTier}，config=${path.relative(ROOT, configPath)}）。`
      + '请先运行构建产出资产目录，或检查配置里的 outputDir。');
  }

  // manifest 是**对外发布**的清单，材料会引用它。它必须与实际 GLB 一致，
  // 否则直接踩竞赛前置审查的「材料与实际成果一致」。曾经真的不一致过。
  const manifestProblems = command === 'write-manifest' ? [] : await checkManifest(assets);
  const budget = checkBudget(assets);
  budget.problems.push(...manifestProblems);
  const needsCache = ['cache', 'all'].includes(command);
  const cache = needsCache ? await collectCacheReport(assets) : [];

  if (command === 'write-manifest') {
    const manifest = buildManifest(assets);
    const rel = config.manifestPath || 'public/models/manifest.json';
    const target = path.join(ROOT, rel);
    await fs.writeFile(target, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log(`已重写 ${rel}（${manifest.models.length} 尊精细模型）`);
    console.log('写入前请确认资产是最终版；写入后 assetctl verify 应全部通过。');
    return { exitCode: 0, assets, cache, budget };
  }

  if (['verify', 'report', 'all', 'budget', 'cache'].includes(command)) {
    if (!quiet) console.log(renderConsole(assets, cache, budget));
  } else {
    throw new Error(`未知命令：${command}\n可用：verify | report | cache | budget | all | write-manifest`);
  }

  if (['report', 'all'].includes(command)) {
    await fs.mkdir(localOutDir, { recursive: true });
    const payload = {
      generatedAt: new Date().toISOString(),
      pipeline: config.name,
      assets,
      cache,
      budgets: config.budgets,
      budgetMetrics: config.budgetMetrics,
      tierBudgets: Object.fromEntries(Object.entries(config.tiers).map(([k, v]) => [k, {
        transferBudget: v.transferBudget,
        transferBudgetHuman: v.transferBudgetHuman,
        rawBudget: v.rawBudget ?? null,
        rawBudgetHuman: v.rawBudgetHuman ?? null,
      }])),
      originals: config.originals?.models || {},
      problems: budget.problems,
    };
    await fs.writeFile(path.join(localOutDir, 'asset-report.json'), JSON.stringify(payload, null, 2));
    await fs.writeFile(path.join(localOutDir, 'asset-report.md'), renderMarkdown(assets, cache, budget));
    if (!quiet) {
      console.log(`\n报告已写出：${path.relative(ROOT, path.join(localOutDir, 'asset-report.json'))}`);
      console.log(`            ${path.relative(ROOT, path.join(localOutDir, 'asset-report.md'))}`);
    }
  }

  return { exitCode: budget.problems.some(p => p.level === 'fail') ? 1 : 0, assets, cache, budget };
}

/** 直接执行本文件时才跑 CLI 并按退出码结束进程；被 import 时什么都不做。 */
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const result = await runCli(process.argv.slice(2));
  process.exit(result.exitCode);
}
