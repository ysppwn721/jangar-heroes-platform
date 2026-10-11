import fs from 'node:fs/promises';
import sharp from 'sharp';
import { heroes } from '../src/heroes.js';
const data = heroes.map(h => ({ image: 'images/hero-' + h.slug + '.jpg' }));
await fs.mkdir('public/images', { recursive: true });
for (const h of data) {
 const filename = h.image.split('/')[1].replace('.jpg','');
 await sharp(h.image).resize({width:500,withoutEnlargement:true}).webp({quality:82}).toFile(`public/images/${filename}.webp`);
 const {data:p,info:{width:w,height:hgt,channels:c}} = await sharp(h.image).resize({height:900,withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const seen=new Uint8Array(w*hgt), q=new Int32Array(w*hgt); let head=0, tail=0;
 const background=(x,y)=>{const i=(y*w+x)*4;const left=(y*w)*4;const right=(y*w+w-1)*4;return (Math.max(p[i],p[i+1],p[i+2])-Math.min(p[i],p[i+1],p[i+2])<9) && Math.min(Math.max(...[0,1,2].map(k=>Math.abs(p[i+k]-p[left+k]))),Math.max(...[0,1,2].map(k=>Math.abs(p[i+k]-p[right+k]))))<8;};
 const add=(x,y)=>{const idx=y*w+x;if(!seen[idx]&&background(x,y)){seen[idx]=1;q[tail++]=idx;}};
 for(let y=0;y<hgt;y++){add(0,y);add(w-1,y);}for(let x=0;x<w;x++){add(x,0);add(x,hgt-1);}
 while(head<tail){const idx=q[head++],x=idx%w,y=(idx/w)|0;if(x>0)add(x-1,y);if(x<w-1)add(x+1,y);if(y>0)add(x,y-1);if(y<hgt-1)add(x,y+1);}
 for(let i=0;i<seen.length;i++)if(seen[i])p[i*4+3]=0;
 await sharp(p,{raw:{width:w,height:hgt,channels:4}}).trim().webp({quality:85}).toFile(`public/images/${filename}-cutout.webp`);
}
for(const name of ['hero-bg','about-center','packaging']) await sharp(`images/${name}.jpg`).resize({width:1400,withoutEnlargement:true}).webp({quality:84}).toFile(`public/images/${name}.webp`);
console.log('Prepared 12 hero thumbnails, 12 transparent posters and 3 editorial images.');

