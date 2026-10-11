/** Page performance and quality benchmark.
 * Loads the real site in a real browser, records paint/model timings, transferred bytes
 * and renderer state, and saves exhibit screenshots for visual comparison.
 * Usage: node scripts/bench-page.cjs [label]
 * Env: TEST_URL (default http://127.0.0.1:4173), PLAYWRIGHT_MODULE, BENCH_LABEL
 * Output: test-results/bench-<label>.json plus exhibit screenshots.
 */
const { launch } = require('./browser.cjs');
const fs=require('node:fs');
const path=require('node:path');
fs.mkdirSync('test-results',{recursive:true});
const base=process.env.TEST_URL||'http://127.0.0.1:4173';
const label=(process.argv[2]||process.env.BENCH_LABEL||'current').replace(/[^\w.-]/g,'_');
const THROTTLE={offline:false,latency:100,downloadThroughput:5*1024*1024/8,uploadThroughput:1024*1024/8};

async function throttle(page,on){
  const client=await page.context().newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.setCacheDisabled',{cacheDisabled:true});
  if(on)await client.send('Network.emulateNetworkConditions',THROTTLE);
  return client;
}

(async()=>{
  const browser=await launch();
  const report={label,url:base,throttle:'5 Mbps, 100 ms RTT, cache disabled',generatedAt:new Date().toISOString()};

  // --- 1. Cold first load under throttling: how fast can a visitor interact? ---
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1,reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  // Instrument WebGL before any application script runs so real draw cost is measurable.
  await page.addInitScript(()=>{
    window.__glStats={draws:0,frames:0,drawMs:0,frameGaps:[],attribs:[],indexType:null,indexCount:0,textureBytes:0,textures:[]};
    const realRaf=window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame=callback=>realRaf(time=>{const stats=window.__glStats;stats.frames++;stats.frameGaps.push(time);window.__glStats.lastDraw=0;callback(time);});
    const proto=HTMLCanvasElement.prototype;const realGet=proto.getContext;
    proto.getContext=function(type,...args){
      const context=realGet.call(this,type,...args);
      if(context&&(type==='webgl2'||type==='webgl')&&!context.__instrumented){
        context.__instrumented=true;
        const stats=window.__glStats;
        const realDrawElements=context.drawElements.bind(context);
        context.drawElements=(mode,count,kind,offset)=>{
          const start=performance.now();realDrawElements(mode,count,kind,offset);
          const spent=performance.now()-start;
          stats.draws++;stats.drawMs+=spent;stats.lastDraw=spent;stats.indexCount=count;stats.indexType=kind===context.UNSIGNED_INT?'u32':'u16';
        };
        const realTexImage2D=context.texImage2D.bind(context);
        context.texImage2D=(...texArgs)=>{
          // Overloads: (target, level, iformat, w, h, border, format, type, source) or (target, level, iformat, format, type, source).
          const width=typeof texArgs[3]==='number'?texArgs[3]:texArgs[5]?.width;
          const height=typeof texArgs[4]==='number'?texArgs[4]:texArgs[5]?.height;
          const start=performance.now();realTexImage2D(...texArgs);
          const spent=performance.now()-start;
          if(typeof width==='number'&&typeof height==='number'&&width>1){stats.textureBytes+=width*height*4;(stats.textures=stats.textures||[]).push(`${width}x${height} upload ${spent.toFixed(1)}ms`);}
        };
        const realVertexAttribPointer=context.vertexAttribPointer.bind(context);
        context.vertexAttribPointer=(index,size,kind,normalized,stride,offset)=>{stats.attribs[index]=`${size}${kind===context.FLOAT?'f':kind===context.SHORT?'s16':kind===context.BYTE?'s8':'?'}${normalized?'n':''}stride${stride}`;return realVertexAttribPointer(index,size,kind,normalized,stride,offset);};
        const realBufferData=context.bufferData.bind(context);
        context.bufferData=(target,data,usage)=>{
          const bytes=data?.byteLength??0;
          stats.bufferBytes=stats.bufferBytes||[];
          stats.bufferBytes.push({target:target===context.ELEMENT_ARRAY_BUFFER?'index':'vertex',bytes});
          return realBufferData(target,data,usage);
        };
      }
      return context;
    };
  });
  await throttle(page,true);
  const started=Date.now();
  await page.goto(base,{waitUntil:'domcontentloaded'});
  const firstPaint=await page.evaluate(()=>new Promise(resolve=>{
    const paint=performance.getEntriesByType('paint').map(p=>({name:p.name,startTime:Math.round(p.startTime)}));
    resolve({paint,navigation:Math.round(performance.getEntriesByType('navigation')[0]?.responseEnd||0)});
  }));
  const lcp=new Promise(resolve=>{
    page.evaluate(()=>new Promise(done=>{
      let value=0;
      try{new PerformanceObserver(list=>{for(const e of list.getEntries())value=Math.round(e.startTime);}).observe({type:'largest-contentful-paint',buffered:true});}catch{}
      setTimeout(()=>done(value),1);
    })).then(resolve);
  });
  await page.locator('#model-viewer.is-ready').waitFor({timeout:60000});
  const interactive=Date.now()-started;
  const firstInteractiveMs=await page.evaluate(()=>Math.round(performance.getEntriesByName('model-ready:jiangger')[0]?.startTime||0));
  const lcpValue=await lcp;
  await page.locator('#exhibit').screenshot({path:`test-results/bench-${label}-preview.png`});
  // Detail tier: wait for the asynchronous upgrade to finish.
  await page.waitForFunction(()=>document.querySelector('#model-viewer').dataset.quality==='detail',{},{timeout:120000});
  const detailReadyMs=await page.evaluate(()=>Math.round(performance.getEntriesByName('model-detail-ready:jiangger')[0]?.startTime||0));
  await page.waitForTimeout(400);
  await page.locator('#exhibit').screenshot({path:`test-results/bench-${label}-detail.png`});

  // --- 2. Transferred bytes for the whole visit ---
  const transfers=await page.evaluate(()=>performance.getEntriesByType('resource').map(e=>({name:new URL(e.name).pathname,transfer:e.transferSize,encoded:e.encodedBodySize,decoded:e.decodedBodySize,duration:Math.round(e.duration),type:e.initiatorType})));
  const byGroup=(list)=>list.reduce((acc,e)=>{
    const key=e.name.startsWith('/models/v/')?(e.name.includes('-preview.')?'model:preview':'model:detail'):e.name.startsWith('/images/')?'images':e.name.startsWith('/src/')?'js':e.name==='/style.css'?'css':e.name==='/'||e.name==='/index.html'?'html':'other';
    acc[key]=acc[key]||{files:0,transfer:0,decoded:0};acc[key].files++;acc[key].transfer+=e.transfer;acc[key].decoded+=e.decoded;return acc;},{});
  report.firstLoad={firstInteractiveMs,detailReadyMs,wallClockInteractiveMs:interactive,paint:firstPaint,largestContentfulPaintMs:lcpValue,transferByGroup:byGroup(transfers),largestTransfers:transfers.filter(e=>e.transfer>20000).sort((a,b)=>b.transfer-a.transfer).map(e=>`${e.name} ${(e.transfer/1024).toFixed(0)} KiB`)};

  // --- 3. Renderer cost: frame intervals while the model spins at the real pixel ratio. ---
  await page.locator('#rotate-model').click(); // start continuous rendering for a measurable load
  const renderer=await page.evaluate(async()=>{
    const canvas=document.querySelector('#model-canvas');
    const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');
    const stats=window.__glStats;
    const drawsBefore=stats.draws;
    const intervals=await new Promise(resolve=>{
      const samples=[];let last=0,count=0;
      const step=time=>{
        if(last)samples.push(time-last);
        last=time;count++;
        if(count<120)requestAnimationFrame(step);else resolve(samples.slice(3));
      };
      requestAnimationFrame(step);
    });
    const sorted=[...intervals].sort((a,b)=>a-b);
    const at=p=>+sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))].toFixed(2);
    const mean=intervals.reduce((a,b)=>a+b,0)/intervals.length;
    return {draws:stats.draws-drawsBefore,sampledFrames:intervals.length,
      frameMs:{mean:+mean.toFixed(2),min:+sorted[0].toFixed(2),median:at(.5),p95:at(.95),max:+sorted.at(-1).toFixed(2)},
      fpsFromMean:+(1000/mean).toFixed(1),
      indexType:stats.indexType,indexCount:stats.indexCount,attributes:stats.attribs.filter(Boolean),textureUploads:stats.textures,
      bufferBytes:(stats.bufferBytes||[]).reduce((total,entry)=>(total[entry.target]=(total[entry.target]||0)+entry.bytes,total),{}),
      canvasWidth:canvas.width,canvasHeight:canvas.height,cssWidth:canvas.clientWidth,devicePixelRatio:devicePixelRatio,
      pixelsPerFrame:canvas.width*canvas.height,verticesPerFrame:stats.indexCount,
      gl:{renderer:(()=>{const d=gl.getExtension('WEBGL_debug_renderer_info');return d?gl.getParameter(d.UNMASKED_RENDERER_WEBGL):'unknown';})(),maxTextureSize:gl.getParameter(gl.MAX_TEXTURE_SIZE)}};
  });
  report.renderer=renderer;

  // --- 3b. Synchronised GPU cost: finish() after each draw makes the real rasterization visible. ---
  report.renderCost=await page.evaluate(async()=>{
    const canvas=document.querySelector('#model-canvas');
    const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');
    const raf=window.requestAnimationFrame.bind(window);
    const times=[];
    for(let i=0;i<80;i++){
      await new Promise(resolve=>raf(resolve));
      const start=performance.now();gl.finish();times.push(performance.now()-start);
    }
    const sorted=[...times].sort((a,b)=>a-b);
    const mean=times.reduce((a,b)=>a+b,0)/times.length;
    return {samples:times.length,gpuSyncMs:{mean:+mean.toFixed(2),median:+sorted[Math.floor(sorted.length/2)].toFixed(2),p95:+sorted[Math.floor(sorted.length*.95)].toFixed(2),max:+sorted.at(-1).toFixed(2)}};
  });

  // --- 4. Long tasks during the visit (main-thread blocking) ---
  report.longTasks=await page.evaluate(()=>new Promise(resolve=>{
    const tasks=[];try{new PerformanceObserver(list=>{for(const e of list.getEntries())tasks.push(Math.round(e.duration));}).observe({type:'longtask',buffered:true});}catch{}
    setTimeout(()=>resolve({count:tasks.length,totalMs:tasks.reduce((a,b)=>a+b,0),worstMs:Math.max(0,...tasks)}),50);
  }));

  // --- 5. Warm cache reload: repeat visits must not re-transfer anything. ---
  const warm=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1,reducedMotion:'reduce'});
  await warm.goto(base);await warm.waitForFunction(()=>document.querySelector('#model-viewer').dataset.quality==='detail',{},{timeout:60000});
  const warmStart=Date.now();await warm.reload({waitUntil:'domcontentloaded'});
  await warm.locator('#model-viewer.is-ready').waitFor({timeout:60000});
  const warmInteractiveMs=await warm.evaluate(()=>Math.round(performance.getEntriesByName('model-ready:jiangger')[0]?.startTime||0));
  const warmTransfers=await warm.evaluate(()=>performance.getEntriesByType('resource').map(e=>({name:new URL(e.name).pathname,transfer:e.transferSize})));
  report.warmCache={wallClockMs:Date.now()-warmStart,firstInteractiveMs:warmInteractiveMs,cachedFiles:warmTransfers.filter(e=>e.transfer===0).length,totalFiles:warmTransfers.length,revalidated:warmTransfers.filter(e=>e.transfer>0&&e.transfer<2000).map(e=>e.name)};

  // --- 6. Mobile viewport: same measurement, 4x CPU slowdown. ---
  const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  await throttle(mobile,true);
  await mobile.goto(base,{waitUntil:'domcontentloaded'});
  await mobile.locator('#model-viewer.is-ready').waitFor({timeout:60000});
  report.mobile={firstInteractiveMs:await mobile.evaluate(()=>Math.round(performance.getEntriesByName('model-ready:jiangger')[0]?.startTime||0)),canvas:await mobile.evaluate(()=>{const c=document.querySelector('#model-canvas');return {width:c.width,height:c.height,css:c.clientWidth,ratio:devicePixelRatio};})};
  await mobile.locator('#exhibit').screenshot({path:`test-results/bench-${label}-mobile.png`});

  report.errors=errors;
  fs.writeFileSync(path.join('test-results',`bench-${label}.json`),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
