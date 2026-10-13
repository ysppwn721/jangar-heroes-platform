import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
const gzip = promisify(zlib.gzip);
const built=process.argv.includes('--dist');
const root=path.resolve(built?'dist':'.');
const port=Number(process.env.PORT||4173);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.glb':'model/gltf-binary','.gz':'application/gzip','.json':'application/json','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8','.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.m4a':'audio/mp4','.ogg':'audio/ogg'};
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
  // 允许访问的路径：四个交付页 + 404 页 + 稳定入口 + robots/sitemap + reports/ + src/images/models/licenses。
  // ⚠️ 这里**只做"目录级"白名单**，不再对具体文件名做白名单——否则未匹配的路径会被判 403，
  // 而不是走 404 分支。文件是否存在交给下面的 readFile 决定，"不存在"才是我们要模拟的行为。
  const allowedDir=['src','images','models','licenses','reports','media'].includes(topLevel);
  const allowedFile=/^[A-Za-z0-9._-]+$/.test(relative);
  if(!target.startsWith(base+path.sep)){res.writeHead(403,{'Content-Type':'text/plain; charset=utf-8'});res.end('Forbidden');return;}
  const extension=path.extname(target);
  // 404 语义：找不到文件时返回 404.html **且状态码为 404**。
  // 为什么本地也要模拟：真实的静态托管（Cloudflare Pages / GitHub Pages）在存在 404.html 时
  // 就是这样做的；而它同时也是我们踩过的坑——若托管配置成"找不到就回退返回 index.html"，
  // 那么 /robots.txt、/sitemap.xml 这类被写错的路径会返回 HTML，
  // 爬虫拿 HTML 当 sitemap 解析，收录直接失败；打错入口的人也会看到首页而非错误提示。
  // 本地不模拟的话，这个行为要到部署后才会暴露——正是"本地全绿、对外是坏的"。
  let data = null;
  let notFound = false;
  // 只有"目录级白名单内的路径"或"顶层单段文件名"才尝试读取；
  // 其它形状的一律走 404，避免把任意路径都当成可探测对象。
  const attempt = allowedDir || (allowedFile && !relative.includes('\\'));
  if(attempt){
    for(const candidate of [target, path.join(root,'public',relative)]){
      try{ data=await fs.readFile(candidate); break; }catch{ /* 继续尝试下一个候选 */ }
    }
  }
  if(data===null){
    notFound = true;
    // 404 页面的位置：构建产物模式在 dist/ 根，源码模式在 public/
    for(const candidate of [path.join(root,'404.html'), path.join(root,'public','404.html')]){
      try{ data=await fs.readFile(candidate); break; }catch{ /* 继续 */ }
    }
    if(data===null){ res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}); res.end('404 Not Found'); return; }
  }
  const headers={'Content-Type':types[notFound ? '.html' : extension]||'application/octet-stream','Cache-Control':'no-cache','Vary':'Accept-Encoding'};
  const accepts=String(req.headers['accept-encoding']||'');
  if(compressible.has(extension)&&accepts.includes('gzip')){
    const key=`${target}:${data.length}`;
    let body=compressed.get(key);
    if(!body){body=await gzip(data,{level:9});compressed.set(key,body);}
    headers['Content-Encoding']='gzip';headers['Content-Length']=body.length;
    if(notFound||(data.length-body.length)/data.length>.1||relative==='index.html'){res.writeHead(notFound?404:200,headers);res.end(req.method==='HEAD'?undefined:body);return;}
    delete headers['Content-Encoding'];
  }
  if(!notFound&&(relative.startsWith('models/v/')||relative.startsWith('images/')||relative==='favicon.svg'))headers['Cache-Control']='public, max-age=31536000, immutable';
  headers['Content-Length']=data.length;
  res.writeHead(notFound?404:200,headers);res.end(req.method==='HEAD'?undefined:data);
 }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`${built?'Production':'Source'} preview: http://127.0.0.1:${port}`));
