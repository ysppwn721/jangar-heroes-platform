/** Regenerate the self-contained GLBs from the project's uncompressed originals.
 * No Draco decoder is needed at runtime. Spatial clustering preserves UV islands.
 * sharp is only a development-time image encoder, never a website dependency.
 *
 * 画质档位由环境变量控制（源素材是 4096² 贴图 + 150 万面，默认档只用到其中很小一部分）：
 *
 *   QUALITY=high     精细版：主贴图 2048²、法线/金属粗糙 2048²、简化分辨率 256
 *   QUALITY=max      精细版：主贴图 4096²、法线/金属粗糙 4096²、简化分辨率 320
 *   QUALITY=normal   保持原有默认值（不设该变量时的行为）
 *
 * 为什么法线贴图值得单独提：源模型法线贴图是 4096²，而默认档只输出 768²（3.5% 像素）。
 * 法线贴图决定"看起来像不像实物"，是观感损失最大的一环。
 *
 * 实测注意：这批模型是 AI 图生 3D，UV 被切成约 2000 个碎岛，
 * 因此提高贴图分辨率的收益会被 UV 碎度限制（每岛在 2048² 上仅约 1000 像素）。
 * 调档前先看 .cache/uv-quality.mjs 的输出。
 */
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { heroes } from '../src/heroes.js';
const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const preview = process.argv.includes('--preview');
const single = process.argv.slice(2).find(arg => !arg.startsWith('--'));
const outputDir = process.env.OUTPUT_DIR || (preview ? 'public/models/preview' : 'public/models');
const quality = ['high', 'max', 'ar', 'ar-hq', 'ar-lite'].includes(process.env.QUALITY) ? process.env.QUALITY : 'normal';
await fs.mkdir(outputDir, { recursive: true });
const results = [];

/** 精细版的画质档位：贴图尺寸、JPEG 质量、几何简化分辨率。
 *
 * 各通道的尺寸是**差异化**的，依据是实测数据（见 .cache/mr-variance.mjs）：
 *   · baseColor：颜色与纹样细节，肉眼最敏感 → 给足
 *   · normal：决定"看起来像不像实物"，源素材是 4096²，默认档只用掉 3.5% → 提升收益最大
 *   · metalRough：测出 G 通道（粗糙度）范围 0.35~0.62、B 通道（金属度）0~1，
 *     **承载真实质感，不能换成常量**；但变化是低频的（布料/金属分区），
 *     所以用中等尺寸即可，把显存留给前两张。
 *
 * 显存提示（2048² RGBA 含 mipmap 约 21 MB）：
 *   默认档三张合计约 18 MB；high 档约 34 MB；max 档 128 MB（集显/手机扛不住，仅作对照）。
 */
const PROFILES = {
  normal: { label: '默认', color: 1536, normal: 768, mr: 768, resolution: 192 },
  high: { label: '高画质', color: 2048, normal: 2048, mr: 1024, resolution: 256 },
  max: { label: '最高画质', color: 4096, normal: 4096, mr: 2048, resolution: 320 },
  /* AR 档（小程序 VisionKit/XR-Frame 用）—— 与网页两档的关键区别：
   * AR 侧必须把量化属性**解量化成 Float32**（XR-Frame 拒绝 normalized accessor），
   * 所以顶点部分在真机上会再涨一倍多；而 **索引缓冲正比于三角面数**，
   * 是精细档里最大的一块（252k 面 ≈ 2.9 MB 索引）。
   *
   * 于是这里的取舍是：**贴图保持精细档水平**（观感主要来自贴图），
   * **几何降到 AR 可承受的规模**（省下的是索引 + 解量化后的顶点）。
   * 实测（江格尔）：detail 252,732 面 → 解量化后约 15 MB；本档目标 2~3 MB。 */
  ar: { label: 'AR 档', color: 2048, normal: 1024, mr: 512, resolution: 128 },
  /* AR 高质量档：几何提到 256（与网页 detail 档同为 252,732 面），贴图与 ar 相同。
   *
   * 为什么要加这一档：resolution=128 只保留原始网格的 4.7%（149.98 万 → 7.0 万面），
   * 人像表面被体素聚类削成块状平面 —— 真机反馈为"像破了皮"。
   * 实测各档（江格尔，同一套 ar 贴图）：
   *   128 →  69,936 面 / 2.42 MB      192 → 150,198 面 / 4.34 MB
   *   256 → 252,732 面 / 6.26 MB      320 → 369,207 面 / 8.41 MB
   * 选 256：正好等于网页 detail 档的规格（252,732 面 / 160,256 顶点），
   * 体积仍在真机可承受范围，且与"网页上看到的质量"一致。 */
  'ar-hq': { label: 'AR 高质量档', color: 2048, normal: 1024, mr: 512, resolution: 256 },
  /* AR 档的省显存版本：几何与 ar 相同，只把贴图降到 1536/768。
   * 为什么要留两档：贴图解码后的显存占用才是真机的瓶颈（2048² RGBA+mipmap ≈ 21 MB），
   * 而真机上限没法在这里测 —— 所以给两个档位，由真机实测决定用哪个。 */
  'ar-lite': { label: 'AR 省显存档', color: 1536, normal: 768, mr: 512, resolution: 128 },
};
const profile = PROFILES[quality];
const detailResolution = profile.resolution;
const JPEG_QUALITY = { color: 92, normal: 92, mr: 88 };

function accessorData(json, binary, index) {
  const a = json.accessors[index], v = json.bufferViews[a.bufferView];
  const Type = {5126:Float32Array,5125:Uint32Array,5123:Uint16Array}[a.componentType];
  const components = {SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];
  if (!Type || v.byteStride) throw new Error('Unsupported source accessor');
  return new Type(binary.buffer, binary.byteOffset + (v.byteOffset || 0) + (a.byteOffset || 0), a.count * components);
}
function simplify(positions, normals, uv, indices, resolution) {
  const count = positions.length / 3, min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  for(let i=0;i<count;i++)for(let k=0;k<3;k++){min[k]=Math.min(min[k],positions[i*3+k]);max[k]=Math.max(max[k],positions[i*3+k]);}
  const cell = Math.max(...max.map((x,k)=>x-min[k])) / resolution;
  const parent = Uint32Array.from({length:count},(_,i)=>i);
  const root = i => { while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i; };
  for(let i=0;i<indices.length;i+=3){parent[root(indices[i+1])]=root(indices[i]);parent[root(indices[i+2])]=root(indices[i]);}
  const spatial = new Map(), vertexSpatial = new Uint32Array(count), spatialSums=[];
  const clusters = new Map(), remap = new Uint32Array(count), sums = [];
  for(let i=0;i<count;i++) {
    const p=i*3,t=i*2;
    const x=Math.floor((positions[p]-min[0])/cell), y=Math.floor((positions[p+1]-min[1])/cell), z=Math.floor((positions[p+2]-min[2])/cell);
    // UV bins keep separated texture islands from averaging into unrelated pixels.
    const spatialKey=x+(resolution+1)*(y+(resolution+1)*z);
    let spatialIndex=spatial.get(spatialKey);
    if(spatialIndex===undefined){spatialIndex=spatialSums.length;spatial.set(spatialKey,spatialIndex);spatialSums.push([0,0,0,0]);}
    vertexSpatial[i]=spatialIndex;
    const positionSum=spatialSums[spatialIndex];for(let k=0;k<3;k++)positionSum[k]+=positions[p+k];positionSum[3]++;
    const key=spatialKey+','+root(i);
    let index=clusters.get(key);
    if(index===undefined){index=sums.length;clusters.set(key,index);sums.push([0,0,0,0,0,0,0,0,0,spatialIndex]);}
    const s=sums[index];
    for(let k=0;k<3;k++){s[k]+=positions[p+k];s[k+3]+=normals[p+k];}
    s[6]+=uv[t];s[7]+=uv[t+1];s[8]++;remap[i]=index;
  }
  const triangles=[], seen=new Set();
  for(let i=0;i<indices.length;i+=3){
    const a=remap[indices[i]],b=remap[indices[i+1]],c=remap[indices[i+2]];
    if(a===b||b===c||a===c)continue;
    if(sums[a][9]===sums[b][9]||sums[b][9]===sums[c][9]||sums[a][9]===sums[c][9])continue;
    const sorted=[a,b,c].sort((x,y)=>x-y),key=sorted.join(',');
    if(seen.has(key))continue;seen.add(key);triangles.push(a,b,c);
  }
  // Drop clusters which no longer participate in a triangle.
  const compact=new Map(), verts=[];
  const outIndices=triangles.map(index=>{
    if(!compact.has(index)){compact.set(index,verts.length);verts.push(sums[index]);}
    return compact.get(index);
  });
  const outP=new Float32Array(verts.length*3),outN=new Float32Array(verts.length*3),outUV=new Float32Array(verts.length*2);
  for(let i=0;i<verts.length;i++){
    const s=verts[i], n=Math.hypot(s[3],s[4],s[5])||1;
    for(let k=0;k<3;k++){outP[i*3+k]=spatialSums[s[9]][k]/spatialSums[s[9]][3];outN[i*3+k]=s[k+3]/n;}
    outUV[i*2]=s[6]/s[8];outUV[i*2+1]=s[7]/s[8];
  }
  return {positions:outP,normals:outN,uv:outUV,indices:verts.length<65536?new Uint16Array(outIndices):new Uint32Array(outIndices)};
}
function packGLB(json, chunks) {
  let offset=0;
  json.bufferViews=chunks.map(({data,target,byteStride})=>{const view={buffer:0,byteOffset:offset,byteLength:data.byteLength};if(target)view.target=target;if(byteStride)view.byteStride=byteStride;offset+=(data.byteLength+3)&~3;return view;});
  json.buffers=[{byteLength:offset}];
  const binary=Buffer.alloc(offset);
  chunks.forEach(({data},i)=>Buffer.from(data.buffer,data.byteOffset,data.byteLength).copy(binary,json.bufferViews[i].byteOffset));
  const text=Buffer.from(JSON.stringify(json)), jsonSize=(text.length+3)&~3;
  const output=Buffer.alloc(12+8+jsonSize+8+binary.length,0x20);
  output.write('glTF');output.writeUInt32LE(2,4);output.writeUInt32LE(output.length,8);
  output.writeUInt32LE(jsonSize,12);output.writeUInt32LE(0x4e4f534a,16);text.copy(output,20);
  output.writeUInt32LE(binary.length,20+jsonSize);output.writeUInt32LE(0x004e4942,24+jsonSize);binary.copy(output,28+jsonSize);
  return output;
}
for (const hero of heroes.filter(h=>!single||h.slug===single)) {
  const original=await fs.readFile(`models2/${hero.slug}.glb`);
  const jsonSize=original.readUInt32LE(12),json=JSON.parse(original.subarray(20,20+jsonSize)), binary=original.subarray(28+jsonSize);
  const primitive=json.meshes[0].primitives[0];
  const p=accessorData(json,binary,primitive.attributes.POSITION),n=accessorData(json,binary,primitive.attributes.NORMAL),uv=accessorData(json,binary,primitive.attributes.TEXCOORD_0),ix=accessorData(json,binary,primitive.indices);
  const geometry=simplify(p,n,uv,ix,preview ? 72 : detailResolution);
  // Bake the original +90 degree X node rotation, then center and fit the exhibit.
  const node=json.nodes.find(n=>n.mesh===0);
  if(!node.rotation||Math.abs(node.rotation[0]-.7071068)>.0001)throw new Error('Unexpected source transform');
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<geometry.positions.length;i+=3){
    const y=geometry.positions[i+1];geometry.positions[i+1]=-geometry.positions[i+2];geometry.positions[i+2]=y;
    const ny=geometry.normals[i+1];geometry.normals[i+1]=-geometry.normals[i+2];geometry.normals[i+2]=ny;
    for(let k=0;k<3;k++){min[k]=Math.min(min[k],geometry.positions[i+k]);max[k]=Math.max(max[k],geometry.positions[i+k]);}
  }
  const center=min.map((x,k)=>(x+max[k])/2),scale=2.7/(max[1]-min[1]);
  for(let i=0;i<geometry.positions.length;i++)geometry.positions[i]=(geometry.positions[i]-center[i%3])*scale;
  const material=json.materials[primitive.material], colorIndex=json.textures[material.pbrMetallicRoughness.baseColorTexture.index].source;
  const normalIndex=json.textures[material.normalTexture.index].source, mrIndex=json.textures[material.pbrMetallicRoughness.metallicRoughnessTexture.index].source;
  const textures=[];
  const textureSettings = preview
    ? [[colorIndex,768,80],[normalIndex,256,76],[mrIndex,256,72]]
    : [
      [colorIndex, profile.color, JPEG_QUALITY.color],
      [normalIndex, profile.normal, JPEG_QUALITY.normal],
      [mrIndex, profile.mr, JPEG_QUALITY.mr],
    ];
  for(const [index,size,quality] of textureSettings){
    const view=json.bufferViews[json.images[index].bufferView];
    const png=binary.subarray(view.byteOffset,view.byteOffset+view.byteLength);
    // withoutEnlargement 保证不会把源贴图放大（源是 4096²，高出这以上没有意义）
    textures.push(await sharp(png).resize({width:size,height:size,fit:'inside',withoutEnlargement:true}).jpeg({quality,chromaSubsampling:'4:4:4'}).toBuffer());
  }
  const vertexCount=geometry.positions.length/3;
  // Attributes are stored as separate, tightly packed buffers instead of one padded 32-byte
  // vertex: 6 bytes of position, 3 of normal and 4 of UV add up to 13 bytes per vertex instead
  // of the previous 8 + 4 + 4 interleaved slots. Positions use the full signed 16-bit range on
  // every axis (per-axis scale instead of a single global one), which is both smaller and finer
  // than before, and normals keep their own normalisation because they are unit vectors.
  const packedPositions=new Int16Array(vertexCount*3),packedNormals=new Int8Array(vertexCount*3),packedUV=new Uint16Array(vertexCount*2);
  const axisExtent=[0,1,2].map(k=>{
    let extent=0;
    for(let i=0;i<vertexCount;i++)extent=Math.max(extent,Math.abs(geometry.positions[i*3+k]));
    return extent||1;
  });
  const packedMin=[32767,32767,32767],packedMax=[-32767,-32767,-32767];
  for(let i=0;i<vertexCount;i++){
    for(let k=0;k<3;k++){
      const value=Math.round(geometry.positions[i*3+k]/axisExtent[k]*32767);
      if(Math.abs(value)>32767)throw new Error('Position quantization bounds exceeded');
      packedPositions[i*3+k]=value;packedMin[k]=Math.min(packedMin[k],value);packedMax[k]=Math.max(packedMax[k],value);
      packedNormals[i*3+k]=Math.round(Math.max(-1,Math.min(1,geometry.normals[i*3+k]))*127);
    }
    for(let k=0;k<2;k++)packedUV[i*2+k]=Math.round(Math.max(0,Math.min(1,geometry.uv[i*2+k]))*65535);
  }
  const indexComponent=geometry.indices.BYTES_PER_ELEMENT===2?5123:5125;
  const outputJSON={
    asset:{version:'2.0',generator:'Jangar local UV-aware spatial simplifier'},
    extensionsUsed:['KHR_mesh_quantization'],extensionsRequired:['KHR_mesh_quantization'],
    // Per-axis decode scale: the node matrix maps [-1,1] on x/z to the model width and on y to
    // 2.7 units, so the normalised positions keep the same world size as before.
    scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0,scale:[axisExtent[0],axisExtent[1],axisExtent[2]]}],
    meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1,TEXCOORD_0:2},indices:3,material:0}]}],
    accessors:[
      {bufferView:0,componentType:5122,normalized:true,count:vertexCount,type:'VEC3',min:packedMin,max:packedMax},
      {bufferView:1,componentType:5120,normalized:true,count:vertexCount,type:'VEC3'},
      {bufferView:2,componentType:5123,normalized:true,count:vertexCount,type:'VEC2'},
      {bufferView:3,componentType:indexComponent,count:geometry.indices.length,type:'SCALAR'},
    ],
    materials:[{doubleSided:true,pbrMetallicRoughness:{baseColorTexture:{index:0},metallicRoughnessTexture:{index:2}},normalTexture:{index:1,scale:0.55}}],
    textures:[{source:0},{source:1},{source:2}],images:[0,1,2].map((_,i)=>({bufferView:4+i,mimeType:'image/jpeg'})),
  };
  // byteStride is deliberately omitted: stride equals the attribute size, so the buffers stay
  // tightly packed and the viewer's non-interleaved upload path applies directly.
  const output=packGLB(outputJSON,[{data:packedPositions,target:34962},{data:packedNormals,target:34962},{data:packedUV,target:34962},{data:geometry.indices,target:34963},...textures.map(data=>({data}))]);
  await fs.writeFile(`${outputDir}/${hero.slug}.glb`,output);
  const compressed=gzipSync(output,{level:9});
  await fs.writeFile(`${outputDir}/${hero.slug}.glb.gz`,compressed);
  const old=(await fs.stat(`models/${hero.slug}.glb`)).size;
  const result={file:`${hero.slug}.glb`,quality:preview?'preview':quality,originalBytes:old,sourceBytes:original.length,bytes:output.length,transferBytes:compressed.length,originalTriangles:ix.length/3,triangles:geometry.indices.length/3,vertices:geometry.positions.length/3,bytesPerVertex:+(output.length/vertexCount).toFixed(2),indexType:indexComponent===5123?'u16':'u32',textures:textures.map(t=>`${Math.round(t.length/1024)}KB`)};
  results.push(result);console.log(JSON.stringify(result));
}
if(!single)await fs.writeFile(`${outputDir}/manifest.json`,JSON.stringify({generatedAt:new Date().toISOString(),format:'Self-contained GLB 2.0 with KHR_mesh_quantization; native gzip transport, no external decoder',models:results},null,2));
