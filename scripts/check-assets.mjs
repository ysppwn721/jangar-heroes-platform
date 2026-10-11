import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { heroes } from '../src/heroes.js';
import { parseModel } from '../src/viewer.js';

/* 体积预算。高画质档（QUALITY=high）下精细版贴图为 2048² + 2048² + 1024²，
 * 单模型 gzip 约 4.8 MiB，因此精细版预算重新定为 6 MiB，并增设"十二个合计"上限，
 * 防止逐个都"刚好达标"却把整站撑爆。
 * 关键前提：精细版是**异步升级**下载的，首屏只加载轻量版（<750 KiB），
 * 所以精细版变大不影响首次可交互 —— 这正是两级加载机制的价值。 */
const DETAIL_BUDGET = 6 * 1024 * 1024;      // 单个精细模型
const DETAIL_TOTAL_BUDGET = 80 * 1024 * 1024; // 十二个精细模型合计
const PREVIEW_BUDGET = 750 * 1024;           // 单个轻量模型
let rawTotal=0,transferTotal=0,detailTotal=0;
for(const hero of heroes){
  for(const asset of [hero.poster,hero.image])assert((await fs.stat(`public/${asset}`)).size>0,asset);
  for(const tier of ['', 'preview/']){
  const file=`public/models/${tier}${hero.slug}.glb`,b=await fs.readFile(file),packed=await fs.readFile(`${file}.gz`);
  assert.equal(b.toString('ascii',0,4),'glTF');assert.equal(b.readUInt32LE(8),b.length);
  assert(b.equals(gunzipSync(packed)),`${file}: compressed transport differs`);
  if(tier){
    assert(packed.length<PREVIEW_BUDGET,`${file}: 轻量模型超出 750 KiB 预算（${(packed.length/1024).toFixed(0)} KiB）`);
  }else{
    assert(packed.length<DETAIL_BUDGET,`${file}: 精细模型超出 6 MiB 预算（${(packed.length/1048576).toFixed(2)} MiB）`);
    detailTotal+=packed.length;
  }
  const json=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));
  assert(!json.extensionsUsed?.includes('KHR_draco_mesh_compression'));
  for(const buffer of json.buffers||[])assert(!buffer.uri);
  for(const image of json.images||[])assert(!image.uri);
  const model=parseModel(b.buffer.slice(b.byteOffset,b.byteOffset+b.length));
  assert(model.positions.length>3000&&model.indices.length>3000,`${file}: no real mesh`);
  assert(model.indices.length%3===0);
  const vertexCount=model.positions.length/3;
  assert(model.normals.length===model.positions.length&&model.uv.length===vertexCount*2);
  // The renderer uploads these with a FLOAT vertex attribute pointer, so a typed array other
  // than Float32Array renders nothing at all: check the type, not only the length.
  assert(model.positions instanceof Float32Array,`${file}: positions must decode to Float32Array, got ${model.positions.constructor.name}`);
  assert(model.normals instanceof Float32Array,`${file}: normals must decode to Float32Array, got ${model.normals.constructor.name}`);
  assert(model.uv instanceof Float32Array,`${file}: uv must decode to Float32Array, got ${model.uv.constructor.name}`);
  assert(model.indices instanceof Uint16Array||model.indices instanceof Uint32Array,`${file}: indices must decode to Uint16Array or Uint32Array`);
  // The exhibit fits the model from its bounds, so the decoded size has to match the format.
  const height=model.bounds.max[1]-model.bounds.min[1];
  assert(Math.abs(height-2.7)<.01,`${file}: decoded height ${height.toFixed(3)} is not the exhibited 2.7 units`);
  let minY=Infinity,maxY=-Infinity;
  for(let i=1;i<model.positions.length;i+=3){minY=Math.min(minY,model.positions[i]);maxY=Math.max(maxY,model.positions[i]);}
  assert(Math.abs(maxY-minY-2.7)<.01,`${file}: decoded vertex height ${(maxY-minY).toFixed(3)} disagrees with the recorded bounds`);
  for(const index of model.indices)assert(index<vertexCount,`${file}: index out of range`);
  for(const value of model.positions)assert(Number.isFinite(value)&&Math.abs(value)<3);
  rawTotal+=b.length;transferTotal+=packed.length;
  }
}
for(const asset of ['favicon.svg','images/hero-bg.webp','images/packaging.webp'])await fs.access(`public/${asset}`);
assert.equal(new Set(heroes.map(h=>h.id)).size,12);assert.equal(new Set(heroes.map(h=>h.slug)).size,12);
assert(detailTotal<DETAIL_TOTAL_BUDGET,`十二个精细模型合计 ${(detailTotal/1048576).toFixed(1)} MiB 超出 ${DETAIL_TOTAL_BUDGET/1048576} MiB 预算`);
console.log(`Validated 12 preview + 12 detailed models, textures, bounds and triangle indices: ${(transferTotal/1048576).toFixed(2)} MB compressed (${(rawTotal/1048576).toFixed(2)} MB decoded GLB files).`);
console.log(`预算检查：轻量 ≤750 KiB/个，精细 ≤6 MiB/个，精细合计 ${(detailTotal/1048576).toFixed(1)} MiB / ${DETAIL_TOTAL_BUDGET/1048576} MiB。`);
