/** Native WebGL exhibit renderer for this project's self-contained, single-mesh GLBs.
 * No network libraries, npm runtime dependencies, or decoder workers are required.
 */
import { modelAssets } from './model-assets.js';

const vertexSource = `
precision highp float;
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUV;
uniform mat4 uProjection;
uniform mat4 uView;
varying vec3 vPosition;
varying vec3 vNormal;
varying vec2 vUV;
void main() {
  vPosition = aPosition;
  vNormal = aNormal;
  vUV = aUV;
  gl_Position = uProjection * uView * vec4(aPosition, 1.0);
}`;
const fragmentSource = `
precision highp float;
varying vec3 vPosition;
varying vec3 vNormal;
varying vec2 vUV;
uniform sampler2D uColor;
uniform sampler2D uNormal;
uniform sampler2D uMetalRough;
uniform vec3 uEye;
uniform float uNormalScale;
const float PI = 3.14159265;
vec3 surfaceNormal() {
  vec3 n = normalize(vNormal);
  #ifdef HAS_DERIVATIVES
  vec3 q1 = dFdx(vPosition), q2 = dFdy(vPosition);
  vec2 st1 = dFdx(vUV), st2 = dFdy(vUV);
  vec3 t = q1 * st2.y - q2 * st1.y;
  vec3 b = -q1 * st2.x + q2 * st1.x;
  float scale = inversesqrt(max(max(dot(t,t),dot(b,b)),0.000001));
  vec3 map = texture2D(uNormal, vUV).xyz * 2.0 - 1.0;
  map.xy *= uNormalScale;
  n = normalize(mat3(t*scale,b*scale,n)*map);
  #endif
  return gl_FrontFacing ? n : -n;
}
vec3 lightBRDF(vec3 n, vec3 v, vec3 l, vec3 base, float metal, float rough, vec3 radiance) {
  vec3 h = normalize(v+l);
  float nl = max(dot(n,l),0.0), nv = max(dot(n,v),0.001), nh = max(dot(n,h),0.0);
  float a = rough*rough, a2 = a*a, d = nh*nh*(a2-1.0)+1.0;
  float distribution = a2 / max(PI*d*d,0.001);
  float k = (rough+1.0)*(rough+1.0)/8.0;
  float geometry = nv/(nv*(1.0-k)+k) * nl/(nl*(1.0-k)+k);
  vec3 f0 = mix(vec3(0.04),base,metal);
  vec3 fresnel = f0+(1.0-f0)*pow(1.0-max(dot(h,v),0.0),5.0);
  vec3 specular = distribution*geometry*fresnel / max(4.0*nv*nl,0.001);
  vec3 diffuse = (1.0-fresnel)*(1.0-metal)*base/PI;
  return (diffuse+specular)*radiance*nl;
}
vec3 toneMap(vec3 x) { return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.0,1.0); }
void main() {
  vec4 sampled = texture2D(uColor,vUV);
  vec3 base = pow(sampled.rgb,vec3(2.2));
  vec3 mr = texture2D(uMetalRough,vUV).rgb;
  float metal = clamp(mr.b,0.0,0.5), rough = clamp(mr.g,0.32,0.95);
  vec3 n = surfaceNormal(), v = normalize(uEye-vPosition);
  vec3 hemisphere = mix(vec3(.36,.40,.33),vec3(.88,.92,.98),n.y*.5+.5);
  vec3 color = base*hemisphere*(.65-.20*metal);
  vec3 reflection = reflect(-v,n);
  vec3 reflectedLight = mix(vec3(.27,.30,.23),vec3(.95,.96,1.0),reflection.y*.5+.5);
  color += mix(vec3(.04),base,metal)*reflectedLight*.45;
  color += lightBRDF(n,v,normalize(vec3(3.0,5.0,5.0)),base,metal,rough,vec3(3.2,2.95,2.6));
  color += lightBRDF(n,v,normalize(vec3(-4.0,2.0,2.0)),base,metal,rough,vec3(1.2,1.4,1.65));
  color += lightBRDF(n,v,normalize(vec3(1.0,3.0,-4.0)),base,metal,rough,vec3(1.1,1.03,.85));
  gl_FragColor = vec4(pow(toneMap(color*1.06),vec3(1.0/2.2)),sampled.a);
}`;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
function perspective(fov, aspect, near=.05, far=80) {
  const f=1/Math.tan(fov/2),nf=1/(near-far);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0]);
}
function lookAt(eye) {
  const len=Math.hypot(...eye),z=eye.map(x=>x/len);
  const xLength=Math.hypot(z[2],z[0]),x=[z[2]/xLength,0,-z[0]/xLength];
  const y=[z[1]*x[2],z[2]*x[0]-z[0]*x[2],-z[1]*x[0]];
  const dot=(a,b)=>a.reduce((sum,value,i)=>sum+value*b[i],0);
  return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);
}
export function parseModel(buffer) {
  const view=new DataView(buffer);
  if(view.byteLength<28||view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==view.byteLength)throw new Error('Invalid GLB');
  const jsonLength=view.getUint32(12,true),json=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,20,jsonLength)));
  const binaryOffset=28+jsonLength;
  const primitive=json.meshes?.[0]?.primitives?.[0];
  if(!primitive||primitive.extensions?.KHR_draco_mesh_compression)throw new Error('This gallery requires the prepared, decoder-free models');
  const rawAccessor=(index)=>{
    const a=json.accessors[index],v=json.bufferViews[a.bufferView];
    const Type={5126:Float32Array,5125:Uint32Array,5123:Uint16Array,5122:Int16Array,5120:Int8Array}[a.componentType];
    const width={SCALAR:1,VEC2:2,VEC3:3}[a.type];
    if(!Type||!width)throw new Error('Unsupported GLB attribute');
    const stride = v.byteStride ? v.byteStride / Type.BYTES_PER_ELEMENT : width;
    const raw = new Type(buffer,binaryOffset+(v.byteOffset||0)+(a.byteOffset||0),(a.count-1)*stride+width);
    if(stride===width)return raw;
    const dense=new Type(a.count*width);
    for(let i=0;i<a.count;i++)for(let k=0;k<width;k++)dense[i*width+k]=raw[i*stride+k];
    return dense;
  };
  const accessor=(index)=>{
    const a=json.accessors[index];
    const raw=rawAccessor(index);
    if(!a.normalized)return raw;
    const divisor={5120:127,5122:32767,5123:65535}[a.componentType]||1;
    const result=new Float32Array(raw.length);
    for(let i=0;i<raw.length;i++)result[i]=Math.max(-1,raw[i]/divisor);
    return result;
  };
  const material=json.materials[primitive.material],bounds=json.accessors[primitive.attributes.POSITION];
  const texture=(index)=>{
    const image=json.images[json.textures[index].source],v=json.bufferViews[image.bufferView];
    return new Blob([new Uint8Array(buffer,binaryOffset+(v.byteOffset||0),v.byteLength)],{type:image.mimeType});
  };
  const normalIndex=material.normalTexture?.index, mrIndex=material.pbrMetallicRoughness?.metallicRoughnessTexture?.index;
  // Positions are decoded to float here, because the vertex attribute is declared as FLOAT.
  // The prepared files normalise each axis to the signed 16-bit range and carry the real size
  // in a per-axis node scale; applying that scale while decoding keeps the recorded precision
  // instead of throwing it away with a single uniform divisor.
  const positionAccessor=json.accessors[primitive.attributes.POSITION];
  const node=json.nodes?.find(n=>n.mesh===0);
  const scale=node?.scale||[1,1,1];
  const stored=rawAccessor(primitive.attributes.POSITION);
  const positions=new Float32Array(stored.length);
  if(positionAccessor.normalized){
    const divisor=32767;
    for(let i=0;i<stored.length;i++)positions[i]=Math.max(-1,stored[i]/divisor)*scale[i%3];
  }else for(let i=0;i<stored.length;i++)positions[i]=stored[i]*scale[i%3];
  const unit=bounds.normalized?32767:1;
  return {
    positions,normals:accessor(primitive.attributes.NORMAL),uv:accessor(primitive.attributes.TEXCOORD_0),indices:accessor(primitive.indices),
    textures:[texture(material.pbrMetallicRoughness.baseColorTexture.index),normalIndex===undefined?null:texture(normalIndex),mrIndex===undefined?null:texture(mrIndex)],
    normalScale:material.normalTexture?.scale ?? 1,
    bounds:{min:bounds.min.map((n,k)=>n/unit*scale[k]),max:bounds.max.map((n,k)=>n/unit*scale[k])},
  };
}

export function createViewer({canvas,container,onProgress,onStatus,onReady,onRotation,onQuality=()=>{},demoMode}) {
  const options={alpha:true,antialias:true,premultipliedAlpha:false,powerPreference:'low-power'};
  const gl=canvas.getContext('webgl2',options)||canvas.getContext('webgl',options);
  if(!gl)throw new Error('WebGL is unavailable');
  const webgl2=typeof WebGL2RenderingContext!=='undefined'&&gl instanceof WebGL2RenderingContext;
  const derivatives=webgl2||!!gl.getExtension('OES_standard_derivatives');
  const uint32=webgl2||!!gl.getExtension('OES_element_index_uint');
  const anisotropy=gl.getExtension('EXT_texture_filter_anisotropic')||gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
  const maxAnisotropy=anisotropy?gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT):1;
  let anisotropyLevel=maxAnisotropy>1?2:1;
  let program,uniforms,attributes;
  function initProgram() {
    let vs=vertexSource,fs=fragmentSource;
    if(webgl2){
      vs='#version 300 es\n'+vs.replaceAll('attribute ','in ').replaceAll('varying ','out ');
      fs='#version 300 es\n'+fs.replaceAll('varying ','in ').replaceAll('texture2D(','texture(').replaceAll('gl_FragColor','outputColor').replace('precision highp float;','precision highp float;\nout vec4 outputColor;');
    }
    const defines=derivatives?'#define HAS_DERIVATIVES\n':'';
    fs=webgl2?fs.replace('#version 300 es\n','#version 300 es\n'+defines):(derivatives?'#extension GL_OES_standard_derivatives : enable\n':'')+defines+fs;
    const shaders=[];
    try {
      for(const [type,source] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){
        const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader));
      }
      program=gl.createProgram();shaders.forEach(s=>gl.attachShader(program,s));gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
    }finally{shaders.forEach(s=>gl.deleteShader(s));}
    attributes=['aPosition','aNormal','aUV'].map(name=>gl.getAttribLocation(program,name));
    uniforms=Object.fromEntries(['uProjection','uView','uEye','uColor','uNormal','uMetalRough','uNormalScale'].map(name=>[name,gl.getUniformLocation(program,name)]));
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);gl.clearColor(0,0,0,0);
  }
  initProgram();
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  // Backing-store resolution. Rendering at the full device pixel ratio of a phone triples the
  // fragment work for a difference nobody sees on a 400px exhibit, so the ratio is capped per
  // device class and then adapted to the frame times actually measured on this machine.
  const smallScreen=matchMedia('(max-width: 900px), (pointer: coarse)');
  const ratioCap=()=>smallScreen.matches?1.5:innerWidth<1920?1.75:2;
  const baseRatio=()=>Math.min(devicePixelRatio||1,ratioCap());
  let renderScale=1;
  let slowFrames=0,fastFrames=0;
  const cache=new Map();
  /* 显存预算：高画质精细版的贴图可达每模型约 48 MiB（2048² + 2048² + 1024²）。
   * 这里估算本机可承受的贴图总量，超预算时降低贴图尺寸再上传，
   * 而不是让集显/手机把显存吃爆 —— 几何与模型精度不受影响。
   * MAX_TEXTURE_SIZE 与设备档位一起决定预算：集显与手机定得保守。 */
  const textureBudget=()=>{
    const maxTexture=gl.getParameter(gl.MAX_TEXTURE_SIZE)||2048;
    const smallScreen=matchMedia('(max-width: 900px), (pointer: coarse)').matches;
    const lowPower=/(intel|apple gpu|adreno 5|mali-[gt][0-9]?[0-9])/i.test(String(gl.getParameter(gl.RENDERER)||''));
    // 单位 MiB：手机/集成显卡 48，普通独显 128，MAX_TEXTURE_SIZE 小的一律压低
    let budget=smallScreen||lowPower?48:128;
    if(maxTexture<4096)budget=Math.min(budget,48);
    if(maxTexture<2048)budget=Math.min(budget,24);
    return budget;
  };
  let current,slug,version=0,controller,lost=false,disposed=false;
  let upgradeTimer=0,upgradeTask=null,desiredSlug;
  let frame=0,visible=true,lastTime=0,dirty=true,autoRotate=!reducedMotion.matches;
  let yaw=0,pitch=.04,distance=5,fitDistance=5,velocityX=0,velocityY=0;
  let drawCount=0,loadDuration=0;
  const pointers=new Map();
  const removers=[];
  const listen=(target,type,handler,opts)=>{target.addEventListener(type,handler,opts);removers.push(()=>target.removeEventListener(type,handler,opts));};
  onRotation(autoRotate);
  function release(model) {
    if(!model)return;
    model.buffers?.forEach(b=>gl.deleteBuffer(b));model.gpuTextures?.forEach(t=>gl.deleteTexture(t));
    model.buffers=null;model.gpuTextures=null;
  }
  async function upload(model) {
    model.buffers=[];model.gpuTextures=[];
    try {
      for(const [i,data] of [model.positions,model.normals,model.uv,model.indices].entries()){
        const buffer=gl.createBuffer();model.buffers.push(buffer);
        // A typed array view such as Int16Array can span the whole decoded GLB, so upload only
        // the bytes that belong to this attribute; using the view directly inflates the vertex
        // buffer by the size of every texture in the file.
        const exact=data.buffer&&data.byteLength!==data.buffer.byteLength?data.slice():data;
        const target=i===3?gl.ELEMENT_ARRAY_BUFFER:gl.ARRAY_BUFFER;gl.bindBuffer(target,buffer);gl.bufferData(target,exact,gl.STATIC_DRAW);
      }
      for(const [i,blob] of model.textures.entries()){
        const texture=gl.createTexture();model.gpuTextures.push(texture);gl.bindTexture(gl.TEXTURE_2D,texture);
        let width=1,height=1;
        if(blob){
          let bitmap=await createImageBitmap(blob,{colorSpaceConversion:'none',premultiplyAlpha:'none'});
          if(lost||disposed){bitmap.close();throw new Error('WebGL context unavailable');}
          // 显存预算：单张超预算就逐级减半，宁可降一档画质，也不让集显/手机把显存吃爆
          const perTexture=Math.max(4096,textureBudget()*1048576);
          let scale=1;
          while(bitmap.width*bitmap.height*4*scale*scale>perTexture&&scale>0.25)scale/=2;
          if(scale<1){
            const targetWidth=Math.max(1,Math.round(bitmap.width*scale)),targetHeight=Math.max(1,Math.round(bitmap.height*scale));
            const drawing=typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(targetWidth,targetHeight):document.createElement('canvas');
            if(!(drawing instanceof OffscreenCanvas)){drawing.width=targetWidth;drawing.height=targetHeight;}
            drawing.getContext('2d').drawImage(bitmap,0,0,targetWidth,targetHeight);
            bitmap.close();
            bitmap=await createImageBitmap(drawing);
            model.textureDownscaled=true;
          }
          gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);width=bitmap.width;height=bitmap.height;bitmap.close();
        }else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(i===1?[128,128,255,255]:[255,190,0,255]));
        const powerOfTwo=n=>(n&(n-1))===0;
        model.textureSizes=model.textureSizes||[];model.textureSizes[i]=[width,height];
        applyTextureFilter(texture,width,height);
      }
      model.indexType=model.indices instanceof Uint32Array?gl.UNSIGNED_INT:gl.UNSIGNED_SHORT;
      if(model.indexType===gl.UNSIGNED_INT&&!uint32)throw new Error('32 bit indices unavailable');
    }catch(error){release(model);throw error;}
  }
  /* Mipmaps stay on: they are cheap to build, remove the shimmer on distant geometry and let the
   * sampler read the level it needs. Anisotropic filtering is the expensive half, so it follows
   * the measured frame time instead of being applied unconditionally. */
  function applyTextureFilter(texture,width,height) {
    const powerOfTwo=n=>(n&(n-1))===0;
    if(webgl2||(powerOfTwo(width)&&powerOfTwo(height))){gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);}
    else gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    if(anisotropy&&maxAnisotropy>1)gl.texParameterf(gl.TEXTURE_2D,anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(maxAnisotropy,anisotropyLevel));
  }
  /* Quality steps re-apply the sampler settings only: the decoded pixels stay on the GPU, so
   * this costs nothing compared with re-decoding and re-uploading the image. */
  function updateTextureFilter() {
    if(!current?.gpuTextures)return;
    const sizes=current.textureSizes||[];
    current.gpuTextures.forEach((texture,i)=>{
      const size=sizes[i]||[1,1];
      gl.bindTexture(gl.TEXTURE_2D,texture);applyTextureFilter(texture,size[0],size[1]);
    });
  }
  function fit(reset=true) {
    const aspect=Math.max(container.clientWidth/Math.max(container.clientHeight,1),.1);
    if(current){
      const {min,max}=current.bounds;
      const height=max[1]-min[1],width=Math.max(max[0]-min[0],max[2]-min[2]);
      fitDistance=Math.max(height,width/aspect)/(2*Math.tan(35*Math.PI/360))*1.18+width*.12;
    }
    if(reset){yaw=0;pitch=.04;distance=fitDistance;velocityX=velocityY=0;}
    dirty=true;start();
  }
  function draw() {
    if(lost||disposed)return;
    gl.viewport(0,0,canvas.width,canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    if(!current?.buffers)return;
    gl.useProgram(program);
    [3,3,2].forEach((size,i)=>{gl.bindBuffer(gl.ARRAY_BUFFER,current.buffers[i]);gl.enableVertexAttribArray(attributes[i]);gl.vertexAttribPointer(attributes[i],size,gl.FLOAT,false,0,0);});
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,current.buffers[3]);
    const eye=[Math.sin(yaw)*Math.cos(pitch)*distance,Math.sin(pitch)*distance,Math.cos(yaw)*Math.cos(pitch)*distance];
    gl.uniformMatrix4fv(uniforms.uProjection,false,perspective(35*Math.PI/180,canvas.width/canvas.height));
    gl.uniformMatrix4fv(uniforms.uView,false,lookAt(eye));gl.uniform3fv(uniforms.uEye,eye);gl.uniform1f(uniforms.uNormalScale,current.normalScale);
    current.gpuTextures.forEach((texture,i)=>{gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(uniforms[['uColor','uNormal','uMetalRough'][i]],i);});
    gl.drawElements(gl.TRIANGLES,current.indices.length,current.indexType,0);drawCount++;
  }
  function tick(time) {
    frame=0;if(!visible||document.hidden||lost||disposed)return;
    const delta=Math.min((time-lastTime)/1000,.05);lastTime=time;
    if(autoRotate&&current){yaw+=delta*.22;dirty=true;}
    if(!pointers.size&&(Math.abs(velocityX)+Math.abs(velocityY))>.0001){
      yaw+=velocityX;pitch=clamp(pitch+velocityY,-1.15,1.15);
      const damping=Math.pow(.86,delta*60);velocityX*=damping;velocityY*=damping;dirty=true;
    }
    if(dirty){draw();dirty=false;adaptQuality(delta);}
    if((autoRotate&&current)||(Math.abs(velocityX)+Math.abs(velocityY))>.0001)frame=requestAnimationFrame(tick);
  }
  function start(){if(!frame&&visible&&!document.hidden&&!lost&&!disposed){lastTime=performance.now();frame=requestAnimationFrame(tick);}}
  /* Keep the exhibit smooth on weaker GPUs without ever dropping model detail: first the
   * expensive sampler mode goes, then backing-store pixels. The model, its textures, its
   * materials and its triangle count never change. Two slow frames in a row (over 24 ms, about
   * 42 fps) are needed before a step, so a single hitch cannot blur the exhibit, and recovery
   * is deliberately slower than the fallback. */
  function adaptQuality(delta) {
    if(delta>.024){slowFrames++;fastFrames=0;}
    else if(delta<.016){fastFrames++;slowFrames=0;}
    else {slowFrames=0;fastFrames=0;}
    if(slowFrames>=2){
      slowFrames=0;
      if(anisotropyLevel>1){anisotropyLevel=1;updateTextureFilter();dirty=true;}
      else if(renderScale>minRenderScale()){renderScale=Math.max(minRenderScale(),renderScale-.08);resize();}
    } else if(fastFrames>=90){
      fastFrames=0;
      if(renderScale<1){renderScale=Math.min(1,renderScale+.04);resize();}
      else if(anisotropyLevel<Math.min(maxAnisotropy,2)){anisotropyLevel=Math.min(maxAnisotropy,2);updateTextureFilter();dirty=true;}
    }
  }
  /* Blurring below the base ratio is only worth it when the display is denser than 1x; on a
   1x screen the reduction would be visible without saving much work. */
  const minRenderScale=()=>baseRatio()>1?0.75:1;
  function resize() {
    const ratio=baseRatio()*renderScale;
    const width=Math.max(1,Math.round(container.clientWidth*ratio)),height=Math.max(1,Math.round(container.clientHeight*ratio));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;fit();}
  }
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(container);
  const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(visible){dirty=true;start();scheduleUpgrade();reconsiderUpgrade();}else{cancelAnimationFrame(frame);frame=0;}},{threshold:.01});observer.observe(container);
  listen(document,'visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;}else{dirty=true;start();scheduleUpgrade();}});
  function rotate(value){autoRotate=value;onRotation(value);dirty=true;start();}
  listen(reducedMotion,'change',()=>{if(reducedMotion.matches){velocityX=velocityY=0;rotate(false);}});
  const pinchDistance=()=>{const [a,b]=[...pointers.values()];return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0;};
  listen(canvas,'pointerdown',event=>{
    if(!current||lost||event.button>0)return;
    canvas.setPointerCapture(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});velocityX=velocityY=0;rotate(false);
  });
  listen(canvas,'pointermove',event=>{
    if(!pointers.has(event.pointerId))return;
    const previous=pointers.get(event.pointerId),oldDistance=pinchDistance();
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size===1){
      const dx=(event.clientX-previous.x)*.008,dy=(event.clientY-previous.y)*.006;
      yaw-=dx;pitch=clamp(pitch+dy,-1.15,1.15);velocityX=reducedMotion.matches?0:-dx*.45;velocityY=reducedMotion.matches?0:dy*.45;
    }else{const next=pinchDistance();if(next>0)distance=clamp(distance*oldDistance/next,fitDistance*.5,fitDistance*1.8);velocityX=velocityY=0;}
    dirty=true;start();
  });
  const pointerUp=event=>{pointers.delete(event.pointerId);if(event.type==='pointercancel')velocityX=velocityY=0;start();};
  listen(canvas,'pointerup',pointerUp);listen(canvas,'pointercancel',pointerUp);listen(canvas,'lostpointercapture',pointerUp);
  listen(canvas,'wheel',event=>{
    if(!current||lost)return;event.preventDefault();const multiplier=event.deltaMode===1?16:event.deltaMode===2?container.clientHeight:1;
    distance=clamp(distance*Math.exp(event.deltaY*multiplier*.001),fitDistance*.5,fitDistance*1.8);dirty=true;start();
  },{passive:false});
  listen(canvas,'keydown',event=>{
    if(!current||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','0',' '].includes(event.key))return;
    event.preventDefault();velocityX=velocityY=0;
    if(event.key==='0'){fit();return;}
    if(event.key===' '){rotate(!autoRotate);return;}
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){yaw+=event.key==='ArrowLeft'?.18:-.18;rotate(false);}
    else if(event.key==='ArrowUp'||event.key==='ArrowDown'){pitch=clamp(pitch+(event.key==='ArrowUp'?.12:-.12),-1.15,1.15);rotate(false);}
    else distance=clamp(distance*(event.key==='-'?1.12:.88),fitDistance*.5,fitDistance*1.8);
    dirty=true;start();
  });
  listen(canvas,'webglcontextlost',event=>{
    event.preventDefault();lost=true;++version;controller?.abort();clearTimeout(upgradeTimer);cancelAnimationFrame(frame);frame=0;
    container.classList.remove('is-ready');onStatus('图形环境恢复中 · 正在保留模型',true);
  });
  listen(canvas,'webglcontextrestored',async()=>{
    lost=false;
    try{
      initProgram();for(const model of cache.values()){model.buffers=null;model.gpuTextures=null;}
      if(current){await upload(current);resize();draw();onReady();onStatus('拖动旋转 · 滚轮或双指缩放');onQuality(current.tier);scheduleUpgrade();}dirty=true;start();
    }catch(error){onStatus('图形环境恢复失败 · 请刷新页面',true);console.warn(error);}
  });
  function present(model,newSlug,preserveView=false) {
    const previous=cache.get(newSlug);
    current=model;slug=newSlug;cache.delete(slug);cache.set(slug,model);
    if(previous&&previous!==model)release(previous);
    while(cache.size>3){const [key,old]=cache.entries().next().value;cache.delete(key);release(old);}
    fit(!preserveView);draw();onReady();onQuality(model.tier);onStatus('拖动旋转 · 滚轮或双指缩放');dirty=true;start();
  }
  const stale = request => request !== version || lost || disposed;
  /** 是否允许自动升级到精细档。
   *  三条都要满足：网络没被标记省流量、没开省流量模式、当前确实在线。
   *  离线时强行请求精细档只会白等 45 秒超时（超时阈值就是 45s），
   *  然后观众看到一个"加载失败"——那是纯粹自己给自己找的翻车。 */
  function autoUpgradeAllowed() {
    const connection=navigator.connection;
    if (connection?.saveData || ['slow-2g','2g'].includes(connection?.effectiveType)) return false;
    if (typeof demoMode === 'function' && demoMode()) return false;
    if (navigator.onLine === false) return false;
    return true;
  }
  function scheduleUpgrade() {
    clearTimeout(upgradeTimer);
    if(!current || current.tier!=='preview' || slug!==desiredSlug || upgradeTask || !visible || document.hidden || lost || disposed || !autoUpgradeAllowed())return;
    // Give the lightweight model a frame before decoding/uploading the detailed one.
    upgradeTimer=setTimeout(()=>{if(visible&&!document.hidden)upgrade();},250);
  }
  /* 重新滚回展厅时补一次调度。
   * 为什么需要：自动升级只由 scheduleUpgrade() 发起，而它主要在"模型就绪"那一刻被调用。
   * 如果观众在预览档还没加载完就滚走了（visible=false），那一刻的调度会被跳过；
   * 之后即使滚回来也没有任何时机再去调度 —— 结果是精细档永远不加载，
   * 但界面看起来一切正常（就是一直糊）。这类"不报错的功能缺失"最难发现。 */
  function reconsiderUpgrade(){
    if(!current || current.tier!=='preview' || upgradeTask)return;
    scheduleUpgrade();
  }
  async function downloadModel(newSlug,tier,request,activeController) {
    const compressed=typeof DecompressionStream!=='undefined';
    const key=compressed?'gzip':'raw';
    const fallback=`models/${tier==='preview'?'preview/':''}${newSlug}.glb${compressed?'.gz':''}`;
    const url=new URL(modelAssets[newSlug]?.[tier]?.[key]||`./${fallback}`,document.baseURI);
    const timeout=setTimeout(()=>activeController.abort(),tier==='preview'?15000:45000);
    let model;
    try {
      const response=await fetch(url,{signal:activeController.signal,priority:tier==='preview'?'high':'low'});
      if(!response.ok)throw new Error(`GLB HTTP ${response.status}`);
      const total=Number(response.headers.get('content-length'));let buffer;
      if(response.body){
        const reader=response.body.getReader(),chunks=[];let length=0;
        while(true){
          const {done,value}=await reader.read();if(done)break;chunks.push(value);length+=value.byteLength;
          if(!stale(request)&&tier==='preview'){
            const percent=total?Math.min(93,Math.round(length/total*93)):30;
            onProgress(percent);onStatus(`正在加载 360° 模型 · ${percent}%`);
          }
        }
        const bytes=new Uint8Array(length);let offset=0;chunks.forEach(chunk=>{bytes.set(chunk,offset);offset+=chunk.byteLength;});buffer=bytes.buffer;
      }else buffer=await response.arrayBuffer();
      if(stale(request))return null;
      // Some hosts decompress gzip responses themselves. Detect actual bytes.
      const magic=new Uint8Array(buffer,0,Math.min(2,buffer.byteLength));
      if(magic[0]===0x1f&&magic[1]===0x8b)buffer=await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      if(stale(request))return null;
      if(tier==='preview'){onProgress(95);onStatus('正在呈现模型');}
      model=parseModel(buffer);model.tier=tier;await upload(model);
      if(stale(request)){release(model);return null;}
      return model;
    }catch(error){if(model)release(model);throw error;}
    finally{clearTimeout(timeout);}
  }
  function upgrade() {
    clearTimeout(upgradeTimer);
    if(upgradeTask)return upgradeTask;
    if(!current || current.tier==='detail' || slug!==desiredSlug || lost || disposed)return Promise.resolve();
    const request=version,newSlug=slug;
    const activeController=new AbortController();controller=activeController;
    onQuality('loading');onStatus('可拖动旋转 · 正在完善细节');
    const task=(async()=>{
      try {
        const detailed=await downloadModel(newSlug,'detail',request,activeController);
        if(!detailed)return;
        present(detailed,newSlug,true);
        performance.mark(`model-detail-ready:${newSlug}`);
      }catch(error){
        if(stale(request))return;
        // A failed quality upgrade never removes an already interactive model.
        onQuality('preview');onStatus('360° 模型可用 · 可重试精细显示');
        console.warn('Detailed model unavailable; retaining interactive preview.',error);
      }
    })().finally(()=>{if(upgradeTask===task)upgradeTask=null;});
    upgradeTask=task;return task;
  }
  async function load(newSlug) {
    if(lost){onStatus('图形环境恢复中 · 稍后重试',true);return;}
    const request=++version;desiredSlug=newSlug;controller?.abort();clearTimeout(upgradeTimer);upgradeTask=null;
    controller=new AbortController();const activeController=controller,started=performance.now();
    if(cache.has(newSlug)){
      const model=cache.get(newSlug);if(!model.buffers)await upload(model);
      if(!stale(request)){present(model,newSlug);scheduleUpgrade();}return;
    }
    onQuality('initial');onProgress(0);onStatus('正在加载 360° 模型 · 0%');
    try {
      let model;
      try {model=await downloadModel(newSlug,'preview',request,activeController);}
      catch(error){
        if(stale(request))return;
        // Handle a partial deployment: the detailed model remains a valid fallback.
        const fallbackController=new AbortController();controller=fallbackController;
        onStatus('正在加载完整模型');model=await downloadModel(newSlug,'detail',request,fallbackController);
      }
      if(!model){
        /* 两档都没拿到（预览与精细同时失败，例如整批资源缺失）。
         * 早先这里直接 return：界面既不标失败、也不给"重新加载"入口 ——
         * 观众看到的是永远加载不出来的展厅。实测是 check-progressive.cjs 抓出来的。 */
        if(!stale(request)){container.classList.remove('is-ready');onProgress(0);onQuality('initial');onStatus('3D 加载失败 · 点击重试',true);}
        return;
      }
      loadDuration=performance.now()-started;present(model,newSlug);
      performance.mark(`model-ready:${newSlug}`);
      if(model.tier==='detail')performance.mark(`model-detail-ready:${newSlug}`);
      else scheduleUpgrade();
    }catch(error){
      if(stale(request))return;
      container.classList.remove('is-ready');onProgress(0);onQuality('initial');
      onStatus(controller.signal.aborted?'模型下载超时 · 点击重试':'3D 加载失败 · 点击重试',true);
      console.warn('Model load failed:',error);
    }
  }
  resize();
  return {
    load,
    upgrade,
    reset(){fit();},
    toggleRotation(){rotate(!autoRotate);},
    getState(){return {slug,quality:current?.tier,upgrading:!!upgradeTask,yaw,pitch,distance,autoRotate,drawCount,triangles:current?.indices.length/3||0,cacheSize:cache.size,loadDuration,webglVersion:webgl2?2:1,lost,renderScale,anisotropyLevel,textureBytes:current?.textureSizes?.reduce((sum,size)=>sum+(size?size[0]*size[1]*4:0),0)||0};},
    dispose(){disposed=true;++version;controller?.abort();clearTimeout(upgradeTimer);cancelAnimationFrame(frame);observer.disconnect();resizeObserver.disconnect();removers.forEach(remove=>remove());cache.forEach(release);cache.clear();gl.deleteProgram(program);},
  };
}

