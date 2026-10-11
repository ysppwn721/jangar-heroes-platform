import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
const gzip = promisify(zlib.gzip);
const built=process.argv.includes('--dist');
const root=path.resolve(built?'dist':'.');
const port=Number(process.env.PORT||4173);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.glb':'model/gltf-binary','.gz':'application/gzip','.json':'application/json'};
// Text assets are compressed the way Cloudflare and GitHub Pages compress them, so local
// timing measurements reflect the deployed transfer size instead of raw file size.
const compressible=new Set(['.html','.js','.css','.svg','.json']);
const compressed=new Map();
http.createServer(async(req,res)=>{
 try{
  let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname).replace(/^\/jiangger-blindbox-website(?=\/|$)/,'')||'/';
  if(pathname.endsWith('/'))pathname+='index.html';
  const relative=pathname.replace(/^\//,'');
  const base=!built&&(/^(images|models|licenses)\//.test(relative)||relative==='favicon.svg')?path.join(root,'public'):root;
  const target=path.resolve(base,relative);
  const topLevel=relative.split('/')[0];
  // 页面产物：index/console/graph 三个 HTML 由构建期生成，reports/ 下是量化报告。
  const allowedFile=/^(index|console|graph|ask)\.html$/.test(relative)||/^service-worker\.js$/.test(relative)||/^style(\.[0-9a-f]+)?\.css$/.test(relative)||relative==='favicon.svg'||relative==='_headers'||/^reports\//.test(relative);
  if(!target.startsWith(base+path.sep)||!allowedFile&&!['src','images','models','licenses'].includes(topLevel)){res.writeHead(403);res.end();return;}
  const extension=path.extname(target);
  // console.html 与 graph.html 是构建期生成的：源目录里读不到时回退到 public/ 下的副本
  let data;
  try{ data=await fs.readFile(target); }
  catch{ data=await fs.readFile(path.join(root,'public',relative)); }
  const headers={'Content-Type':types[extension]||'application/octet-stream','Cache-Control':'no-cache','Vary':'Accept-Encoding'};
  const accepts=String(req.headers['accept-encoding']||'');
  if(compressible.has(extension)&&accepts.includes('gzip')){
    const key=`${target}:${data.length}`;
    let body=compressed.get(key);
    if(!body){body=await gzip(data,{level:9});compressed.set(key,body);}
    headers['Content-Encoding']='gzip';headers['Content-Length']=body.length;
    if((data.length-body.length)/data.length>.1||relative==='index.html'){res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:body);return;}
    delete headers['Content-Encoding'];
  }
  if(relative.startsWith('models/v/')||relative.startsWith('images/')||relative==='favicon.svg')headers['Cache-Control']='public, max-age=31536000, immutable';
  headers['Content-Length']=data.length;
  res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`${built?'Production':'Source'} preview: http://127.0.0.1:${port}`));
