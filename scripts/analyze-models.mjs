/** GLB composition report: geometry vs texture bytes, vertex/index layout, texture dimensions.
 * Usage: node scripts/analyze-models.mjs [slug...]
 */
import fs from 'node:fs/promises';

function chunkReport(json) {
  let geometry = 0, textures = 0;
  const imageViews = new Set();
  for (const image of json.images || []) if (image.bufferView !== undefined) imageViews.add(image.bufferView);
  (json.bufferViews || []).forEach((view, index) => {
    const target = view.target || 0;
    if (imageViews.has(index)) textures += view.byteLength;
    else if (target === 34962 || target === 34963) geometry += view.byteLength;
    else geometry += view.byteLength;
  });
  return { geometry, textures };
}

function imageInfo(buffer, binaryOffset, json, image) {
  if (image.bufferView === undefined) return { bytes: 0, format: 'external' };
  const view = json.bufferViews[image.bufferView];
  const bytes = view.byteLength;
  const start = binaryOffset + (view.byteOffset || 0);
  let width = 0, height = 0, format = image.mimeType || 'unknown';
  if (image.mimeType === 'image/png' && buffer.readUInt32BE(start) === 0x89504e47) {
    width = buffer.readUInt32BE(start + 16); height = buffer.readUInt32BE(start + 20);
  } else if (image.mimeType === 'image/jpeg') {
    let offset = start + 2;
    while (offset < start + bytes - 1) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        height = buffer.readUInt16BE(offset + 5); width = buffer.readUInt16BE(offset + 7); break;
      }
      offset += 2 + buffer.readUInt16BE(offset + 2);
    }
  }
  return { bytes, format, width, height, gpuRGBA: width * height * 4, gpuWithMips: Math.round(width * height * 4 * 4 / 3) };
}

const slugs = process.argv.slice(2);
const dirs = ['public/models/preview/', 'public/models/'];
const rows = [];
for (const dir of dirs) {
  let names = slugs.length ? slugs : (await fs.readdir(dir)).filter(n => n.endsWith('.glb')).map(n => n.replace('.glb', ''));
  for (const name of names) {
    const file = `${dir}${name}.glb`;
    let buffer;
    try { buffer = await fs.readFile(file); } catch { continue; }
    const jsonLength = buffer.readUInt32LE(12);
    const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
    const binaryOffset = 28 + jsonLength;
    const primitive = json.meshes[0].primitives[0];
    const accessorOf = index => json.accessors[index];
    const position = accessorOf(primitive.attributes.POSITION);
    const indices = accessorOf(primitive.indices);
    const material = json.materials[primitive.material];
    const textureRoles = [
      ['baseColor', material.pbrMetallicRoughness.baseColorTexture.index, true],
      ['normal', material.normalTexture?.index, false],
      ['metalRough', material.pbrMetallicRoughness.metallicRoughnessTexture?.index, false],
    ];
    const { geometry, textures } = chunkReport(json);
    const images = textureRoles.filter(([, i]) => i !== undefined).map(([role, index]) => ({ role, ...imageInfo(buffer, binaryOffset, json, json.images[json.textures[index].source]) }));
    rows.push({
      file: `${dir}${name}.glb`,
      totalBytes: buffer.length,
      gzipBytes: (await fs.readFile(`${file}.gz`)).length,
      geometryBytes: geometry,
      textureBytes: textures,
      vertices: position.count,
      triangles: indices.count / 3,
      positionType: { 5122: 'i16n', 5126: 'f32' }[position.componentType] || position.componentType,
      indexType: { 5123: 'u16', 5125: 'u32' }[indices.componentType],
      attributes: Object.keys(primitive.attributes).join(','),
      images,
      textureGPUTotal: images.reduce((sum, i) => sum + (i.gpuWithMips || 0), 0),
    });
  }
}
const mib = n => (n / 1048576).toFixed(2);
console.log('file'.padEnd(46), 'total'.padStart(8), 'gzip'.padStart(8), 'geom'.padStart(8), 'tex'.padStart(8), 'verts'.padStart(8), 'tris'.padStart(8), 'idx'.padStart(4), 'GPUtex'.padStart(8));
for (const row of rows) {
  console.log(row.file.padEnd(46), mib(row.totalBytes).padStart(8), mib(row.gzipBytes).padStart(8), mib(row.geometryBytes).padStart(8), mib(row.textureBytes).padStart(8), String(row.vertices).padStart(8), String(row.triangles).padStart(8), String(row.indexType).padStart(4), mib(row.textureGPUTotal).padStart(8));
  for (const image of row.images) console.log(`   ${image.role.padEnd(11)} ${image.format.padEnd(11)} ${String(image.width + 'x' + image.height).padEnd(11)} ${(image.bytes / 1024).toFixed(0).padStart(6)} KiB  GPU ${mib(image.gpuWithMips)} MiB (+mips)`);
}
if (rows.length) {
  const sum = key => rows.reduce((total, row) => total + row[key], 0);
  console.log('\nTOTAL', rows.length, 'files:', mib(sum('totalBytes')), 'MiB raw,', mib(sum('gzipBytes')), 'MiB gzip;', mib(sum('geometryBytes')), 'MiB geometry,', mib(sum('textureBytes')), 'MiB textures');
  const perTier = {};
  for (const row of rows) { const tier = row.file.includes('/preview/') ? 'preview' : 'detail'; perTier[tier] = perTier[tier] || { n: 0, raw: 0, gzip: 0 }; perTier[tier].n++; perTier[tier].raw += row.totalBytes; perTier[tier].gzip += row.gzipBytes; }
  for (const [tier, value] of Object.entries(perTier)) console.log(`  ${tier}: ${value.n} models, avg raw ${(value.raw / value.n / 1024).toFixed(0)} KiB, avg gzip ${(value.gzip / value.n / 1024).toFixed(0)} KiB`);
}
