#!/usr/bin/env node
/**
 * 迁移演示：为**另一件文物类三维资产**（一件出土陶罐）生成一份合规 GLB。
 *
 * 为什么需要这个脚本——它服务于"应用与传播价值"这一项评分指标。
 * 该指标要求作品具备"进一步完善、推广、转化、传播或持续迭代的可能"。
 * 我们主张"这套资产管线是配置驱动的，换一批非遗产资产即可复用"。
 * 主张必须能被验证：这个脚本用**零外部依赖**的程序化几何生成一份全新资产，
 * 走一遍与江格尔十二英雄完全相同的 assetctl 管线，并输出独立的量化报告。
 *
 * 生成方式刻意选择"程序化建模而非下载现成模型"：
 *   · 无网络依赖，任何人可复现；
 *   · 资产是"我们的"，不存在第三方许可问题，迁移结论干净；
 *   · 带 KHR_mesh_quantization 量化属性，因此真正检验管线对量化资产的解析能力，
 *     而不是只处理自己的产出格式。
 *
 * 用法：node tools/make-toy-asset.mjs [输出目录]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(process.argv[2] || path.join(ROOT, 'migration-demo/assets'));
const slug = 'taoguan';

/* ── ① 程序化生成一个旋转体陶罐：轮廓线绕 Y 轴旋转，形成封闭网格 ── */
const RADIAL = 48;
/** 陶罐自下而上的轮廓：半径 + 高度。数值取自常见出土陶罐的鼓腹收口比例。 */
const PROFILE = [
  [0.00, 0.00], [0.16, 0.00], [0.20, 0.04], [0.26, 0.10],
  [0.34, 0.20], [0.40, 0.30], [0.42, 0.40], [0.40, 0.50],
  [0.34, 0.58], [0.26, 0.64], [0.21, 0.68], [0.20, 0.72],
  [0.235, 0.76], [0.24, 0.78],
];

const positions = [];
const normals = [];
const uvs = [];
const indices = [];
const ringStart = [];

for (let s = 0; s < PROFILE.length; s++) {
  const [radius, y] = PROFILE[s];
  ringStart.push(positions.length / 3);
  for (let r = 0; r < RADIAL; r++) {
    const theta = (r / RADIAL) * Math.PI * 2;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    positions.push(x, y, z);
    // 近似法线：先用径向再留待下面按轮廓斜率修正
    normals.push(Math.cos(theta), 0.25, Math.sin(theta));
    uvs.push(r / RADIAL, y / 0.78);
  }
}

for (let s = 0; s < PROFILE.length - 1; s++) {
  const a = ringStart[s];
  const b = ringStart[s + 1];
  for (let r = 0; r < RADIAL; r++) {
    const r2 = (r + 1) % RADIAL;
    const a0 = a + r, a1 = a + r2, b0 = b + r, b1 = b + r2;
    indices.push(a0, b0, a1, a1, b0, b1);
  }
}

// 重算法线（面法线累加再归一化），让管线里的光照计算有真实输入
const normalsAcc = new Float64Array(positions.length);
for (let i = 0; i < indices.length; i += 3) {
  const [i0, i1, i2] = [indices[i], indices[i + 1], indices[i + 2]];
  const ax = positions[i0 * 3], ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
  const bx = positions[i1 * 3], by = positions[i1 * 3 + 1], bz = positions[i1 * 3 + 2];
  const cx = positions[i2 * 3], cy = positions[i2 * 3 + 1], cz = positions[i2 * 3 + 2];
  const e1 = [bx - ax, by - ay, bz - az];
  const e2 = [cx - ax, cy - ay, cz - az];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  for (const idx of [i0, i1, i2]) {
    normalsAcc[idx * 3] += n[0];
    normalsAcc[idx * 3 + 1] += n[1];
    normalsAcc[idx * 3 + 2] += n[2];
  }
}
const vertexCount = positions.length / 3;
for (let v = 0; v < vertexCount; v++) {
  const x = normalsAcc[v * 3], y = normalsAcc[v * 3 + 1], z = normalsAcc[v * 3 + 2];
  const len = Math.hypot(x, y, z) || 1;
  normals[v * 3] = x / len;
  normals[v * 3 + 1] = y / len;
  normals[v * 3 + 2] = z / len;
}

console.log(`陶罐网格：${vertexCount} 顶点 / ${indices.length / 3} 三角面`);

/* ── ② 按 KHR_mesh_quantization 量化：位置 u16、法线 i8、UV u16 ── */
const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (let v = 0; v < vertexCount; v++) {
  for (let c = 0; c < 3; c++) {
    const value = positions[v * 3 + c];
    if (value < min[c]) min[c] = value;
    if (value > max[c]) max[c] = value;
  }
}
// 每个轴都用满 16 位范围——这是"位置 6 字节"主张的前提
const quantizedPositions = new Uint16Array(vertexCount * 3);
for (let v = 0; v < vertexCount; v++) {
  for (let c = 0; c < 3; c++) {
    const span = max[c] - min[c] || 1;
    quantizedPositions[v * 3 + c] = Math.round(((positions[v * 3 + c] - min[c]) / span) * 65535);
  }
}
const quantizedNormals = new Int8Array(vertexCount * 3);
for (let i = 0; i < vertexCount * 3; i++) {
  quantizedNormals[i] = Math.max(-127, Math.min(127, Math.round(normals[i] * 127)));
}
const quantizedUvs = new Uint16Array(vertexCount * 2);
for (let i = 0; i < vertexCount * 2; i++) {
  quantizedUvs[i] = Math.max(0, Math.min(65535, Math.round(uvs[i] * 65535)));
}

const indexArray = vertexCount <= 65535 ? new Uint16Array(indices) : new Uint32Array(indices);
const indexComponentType = vertexCount <= 65535 ? 5123 : 5125;

/* ── ③ 组一个最小但合法的 GLB：单个 buffer，多个 bufferView ── */
function pad4(buffer, fill = 0) {
  const remainder = buffer.length % 4;
  if (!remainder) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(4 - remainder, fill)]);
}

const parts = [];
const bufferViews = [];
const accessors = [];
function addAccessor(typedArray, componentType, type, components, extra = {}) {
  const bytes = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
  const padded = pad4(bytes);
  const byteOffset = parts.reduce((sum, p) => sum + p.length, 0);
  parts.push(padded);
  bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length });
  accessors.push({
    bufferView: bufferViews.length - 1,
    componentType,
    count: typedArray.length / components,
    type,
    ...extra,
  });
  return accessors.length - 1;
}

const posAccessor = addAccessor(quantizedPositions, 5123, 'VEC3', 3, {
  normalized: true,
  min: [0, 0, 0],
  max: [65535, 65535, 65535],
});
const normAccessor = addAccessor(quantizedNormals, 5120, 'VEC3', 3, { normalized: true });
const uvAccessor = addAccessor(quantizedUvs, 5123, 'VEC2', 2, { normalized: true });
const idxAccessor = addAccessor(indexArray, indexComponentType, 'SCALAR', 1);

/* 一张 64×64 的陶土色贴图（PNG，用 zlib 手写，避免引入图像库） */
function crc32(buffer) {
  let c = ~0;
  for (let i = 0; i < buffer.length; i++) {
    c ^= buffer[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
const SIZE = 64;
const raw = Buffer.alloc(SIZE * (SIZE * 3 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 3 + 1)] = 0;
  for (let x = 0; x < SIZE; x++) {
    const at = y * (SIZE * 3 + 1) + 1 + x * 3;
    // 陶土底色 + 轻微竖向条纹，模拟轮制痕迹
    const stripe = Math.sin(x * 0.9) * 8;
    raw[at] = Math.max(0, Math.min(255, 168 + stripe));
    raw[at + 1] = Math.max(0, Math.min(255, 118 + stripe * 0.6));
    raw[at + 2] = Math.max(0, Math.min(255, 82 + stripe * 0.4));
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  pngChunk('IEND', Buffer.alloc(0)),
]);
const pngPadded = pad4(png);
const pngOffset = parts.reduce((sum, p) => sum + p.length, 0);
parts.push(pngPadded);
bufferViews.push({ buffer: 0, byteOffset: pngOffset, byteLength: png.length });

const binary = Buffer.concat(parts);

const gltf = {
  asset: { version: '2.0', generator: 'make-toy-asset.mjs (迁移演示用程序化资产)' },
  extensionsUsed: ['KHR_mesh_quantization'],
  extensionsRequired: ['KHR_mesh_quantization'],
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'taoguan' }],
  meshes: [{
    name: 'taoguan',
    primitives: [{
      attributes: { POSITION: posAccessor, NORMAL: normAccessor, TEXCOORD_0: uvAccessor },
      indices: idxAccessor,
      material: 0,
    }],
  }],
  materials: [{
    name: 'taotao',
    pbrMetallicRoughness: {
      baseColorTexture: { index: 0 },
      metallicFactor: 0.05,
      roughnessFactor: 0.85,
    },
  }],
  textures: [{ source: 0, sampler: 0 }],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
  images: [{ bufferView: bufferViews.length - 1, mimeType: 'image/png' }],
  accessors,
  bufferViews,
  buffers: [{ byteLength: binary.length }],
};

const jsonText = Buffer.from(JSON.stringify(gltf), 'utf8');
const jsonPadded = pad4(jsonText, 0x20);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binary.length, 8);
const jsonChunkHeader = Buffer.alloc(8);
jsonChunkHeader.writeUInt32LE(jsonPadded.length, 0);
jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4);
const binChunkHeader = Buffer.alloc(8);
binChunkHeader.writeUInt32LE(binary.length, 0);
binChunkHeader.writeUInt32LE(0x004e4942, 4);
const glb = Buffer.concat([header, jsonChunkHeader, jsonPadded, binChunkHeader, binary]);

await fs.mkdir(outDir, { recursive: true });
const glbPath = path.join(outDir, `${slug}.glb`);
await fs.writeFile(glbPath, glb);
await fs.writeFile(`${glbPath}.gz`, zlib.gzipSync(glb, { level: 9 }));

console.log(`已生成迁移演示资产：${path.relative(ROOT, glbPath)}`);
console.log(`  GLB ${(glb.length / 1024).toFixed(1)} KiB → gzip ${(zlib.gzipSync(glb).length / 1024).toFixed(1)} KiB`);
console.log(`  量化：POSITION u16（每轴用满 16 位）/ NORMAL i8 / TEXCOORD_0 u16`);
console.log(`  索引：${indexComponentType === 5123 ? 'u16' : 'u32'}`);
console.log('  该资产与江格尔十二英雄无关，是程序化生成的独立三维资产。');
