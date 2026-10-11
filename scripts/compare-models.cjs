/** Structural comparison between the current model files and a reference set, so a repacking or
 * re-encoding change is reported as measured numbers rather than a claim.
 * Usage: node scripts/compare-models.cjs <label> <reference-dir>
 * The reference directory holds the previous files under the same layout the build uses:
 *   <reference-dir>/<slug>.glb            (detail tier)
 *   <reference-dir>/preview/<slug>.glb    (preview tier)
 * Exits non-zero when geometry changed, because a repack must not alter the mesh.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
fs.mkdirSync('test-results', { recursive: true });
const label = process.argv[2] || 'models';
const referenceRoot = process.argv[3];
if (!referenceRoot) {
  console.error('usage: node scripts/compare-models.cjs <label> <reference-dir>');
  process.exit(1);
}
const tiers = [['preview', 'public/models/preview', 'preview'], ['detail', 'public/models', '']];

function readGlb(file) {
  const raw = fs.readFileSync(file);
  const buffer = file.endsWith('.gz') ? zlib.gunzipSync(raw) : raw;
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  const primitive = json.meshes[0].primitives[0];
  const byteLength = index => {
    const accessor = json.accessors?.[index];
    const view = accessor ? json.bufferViews?.[accessor.bufferView] : undefined;
    return view?.byteLength || 0;
  };
  return {
    json, primitive,
    // The transfer size is the file as it is stored (gzip when the reference keeps .gz).
    transfer: raw.length,
    geometryBytes: [primitive.attributes.POSITION, primitive.attributes.NORMAL, primitive.attributes.TEXCOORD_0, primitive.indices]
      .reduce((total, index) => total + byteLength(index), 0),
    textureBytes: (json.images || []).reduce((total, image) => total + (image.bufferView === undefined ? 0 : (json.bufferViews[image.bufferView]?.byteLength || 0)), 0),
  };
}

const report = { label, comparedAt: new Date().toISOString(), reference: referenceRoot, tiers: {} };
let changedGeometry = false;
for (const [tier, currentDir, referenceSub] of tiers) {
  const rows = [];
  for (const name of fs.readdirSync(currentDir).filter(file => file.endsWith('.glb'))) {
    // The reference set may keep either the raw GLB or its gzip form; both carry the same JSON.
    const candidates = [path.join(referenceRoot, referenceSub, name), path.join(referenceRoot, referenceSub, `${name}.gz`)];
    const reference = candidates.find(candidate => fs.existsSync(candidate));
    if (!reference) continue;
    const before = readGlb(reference), after = readGlb(path.join(currentDir, name));
    const position = model => model.json.accessors[model.primitive.attributes.POSITION];
    const indices = model => model.json.accessors[model.primitive.indices];
    const same = position(before).count === position(after).count && indices(before).count === indices(after).count;
    if (!same) changedGeometry = true;
    rows.push({
      file: name,
      transferBefore: before.transfer, transferAfter: after.transfer,
      deltaPercent: +((after.transfer / before.transfer - 1) * 100).toFixed(1),
      geometryBefore: before.geometryBytes, geometryAfter: after.geometryBytes,
      geometryDeltaPercent: +((after.geometryBytes / before.geometryBytes - 1) * 100).toFixed(1),
      textureBytesBefore: before.textureBytes, textureBytesAfter: after.textureBytes,
      vertices: `${position(before).count} -> ${position(after).count}`,
      triangles: `${indices(before).count / 3} -> ${indices(after).count / 3}`,
      positionComponent: `${position(before).componentType} -> ${position(after).componentType} (${position(after).normalized ? 'normalized' : 'raw'})`,
      nodeScale: `${JSON.stringify(before.json.nodes[0].scale)} -> ${JSON.stringify(after.json.nodes[0].scale)}`,
      sameGeometry: same,
    });
  }
  const sum = key => rows.reduce((total, row) => total + row[key], 0);
  report.tiers[tier] = {
    models: rows.length,
    transferDeltaPercent: +((sum('transferAfter') / sum('transferBefore') - 1) * 100).toFixed(1),
    geometryDeltaPercent: +((sum('geometryAfter') / sum('geometryBefore') - 1) * 100).toFixed(1),
    identicalGeometry: rows.every(row => row.sameGeometry),
    rows,
  };
}
report.identicalGeometry = !changedGeometry;
console.log(JSON.stringify(report, null, 2));
fs.writeFileSync(`test-results/model-comparison-${label}.json`, JSON.stringify(report, null, 2));
if (changedGeometry) {
  console.error('Geometry changed in this repack; verify visually before publishing.');
  process.exit(1);
}
