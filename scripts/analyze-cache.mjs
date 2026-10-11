/** Report vertex-cache and reuse statistics for the prepared models.
 * The GPU vertex shader runs once per cache miss, so a high ACMR means most of the
 * vertex work is thrown away. This measures the current ordering so a reorder pass can be
 * judged against a number instead of a guess.
 * Usage: node scripts/analyze-cache.mjs [slug...]
 */
import fs from 'node:fs/promises';

/** Simulates a post-transform vertex cache of the given size and returns misses per triangle. */
function acmr(indices, cacheSize = 32) {
  const cache = [];
  const inCache = new Set();
  let misses = 0;
  const vertices = indices.length;
  for (let i = 0; i < vertices; i++) {
    const index = indices[i];
    if (!inCache.has(index)) {
      misses++;
      if (cache.length >= cacheSize) inCache.delete(cache.shift());
      cache.push(index); inCache.add(index);
    }
  }
  return misses / (vertices / 3);
}

function readGlb(buffer) {
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  const binaryOffset = 28 + jsonLength;
  const primitive = json.meshes[0].primitives[0];
  const indexAccessor = json.accessors[primitive.indices];
  const view = json.bufferViews[indexAccessor.bufferView];
  const Type = indexAccessor.componentType === 5125 ? Uint32Array : Uint16Array;
  const indices = new Type(buffer.buffer, buffer.byteOffset + binaryOffset + (view.byteOffset || 0), indexAccessor.count);
  const vertexCount = json.accessors[primitive.attributes.POSITION].count;
  return { json, indices, vertexCount };
}

const slugs = process.argv.slice(2);
const rows = [];
for (const [dir, tier] of [['public/models/preview/', 'preview'], ['public/models/', 'detail']]) {
  const names = slugs.length ? slugs : (await fs.readdir(dir)).filter(n => n.endsWith('.glb')).map(n => n.replace('.glb', ''));
  for (const name of names) {
    let buffer;
    try { buffer = await fs.readFile(`${dir}${name}.glb`); } catch { continue; }
    const { indices, vertexCount } = readGlb(buffer);
    const unique = new Set(indices).size;
    rows.push({
      tier, name,
      vertices: vertexCount, triangles: indices.length / 3,
      uniqueIndexed: unique,
      reuse: +(indices.length / unique).toFixed(2),
      acmr32: +acmr(indices, 32).toFixed(3),
      acmr16: +acmr(indices, 16).toFixed(3),
    });
  }
}
const pad = (value, width) => String(value).padStart(width);
console.log('tier'.padEnd(8), 'model'.padEnd(16), pad('verts', 8), pad('tris', 8), pad('unique', 8), pad('reuse', 6), pad('ACMR32', 7), pad('ACMR16', 7));
for (const row of rows) console.log(row.tier.padEnd(8), row.name.padEnd(16), pad(row.vertices, 8), pad(row.triangles, 8), pad(row.uniqueIndexed, 8), pad(row.reuse, 6), pad(row.acmr32, 7), pad(row.acmr16, 7));
const byTier = {};
for (const row of rows) {
  const entry = byTier[row.tier] ??= { count: 0, acmr32: 0, acmr16: 0, reuse: 0, shaderVertices: 0 };
  entry.count++; entry.acmr32 += row.acmr32; entry.acmr16 += row.acmr16; entry.reuse += row.reuse;
  entry.shaderVertices += row.triangles * 3 * row.acmr32;
}
for (const [tier, entry] of Object.entries(byTier)) {
  console.log(`${tier}: ${entry.count} models, mean ACMR32 ${(entry.acmr32 / entry.count).toFixed(3)}, mean ACMR16 ${(entry.acmr16 / entry.count).toFixed(3)}, mean vertex reuse ${(entry.reuse / entry.count).toFixed(2)}, mean shader vertices/frame ${Math.round(entry.shaderVertices / entry.count).toLocaleString('en-US')}`);
}
