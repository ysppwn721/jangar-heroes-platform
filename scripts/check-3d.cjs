const { launch } = require('./browser.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.TEST_URL || 'http://127.0.0.1:4174/jiangger-blindbox-website/';
const slugs = ['jiangger','harinidun','alatancheji','hongguer','saber','mingyan','sanala','guzangongbu','harijilagen','hejilagen','naqinshanghuer','sailihantabage'];
fs.mkdirSync('test-results', {recursive:true});
(async () => {
  const browser = await launch();
  const page = await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1,reducedMotion:'reduce'});
  const errors=[],failed=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('requestfailed',r=>{if(!r.failure()?.errorText.includes('ERR_ABORTED'))failed.push(r.url());});
  page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).origin!==new URL(base).origin)external.push(r.url());});
  await page.goto(base,{waitUntil:'networkidle'});
  await page.locator('#model-viewer.is-ready').waitFor({timeout:15000});
  assert.equal(await page.locator('#model-poster').evaluate(el=>getComputedStyle(el).opacity),'0');
  assert.equal(await page.locator('#model-canvas').evaluate(el=>getComputedStyle(el).opacity),'1');
  const front=await page.locator('#model-canvas').screenshot();
  await page.locator('#exhibit').screenshot({path:'test-results/real-model-front.png'});
  // Actual pointer input turns geometry; the static poster remains hidden.
  const box=await page.locator('#model-canvas').boundingBox();
  await page.mouse.move(box.x+box.width*.7,box.y+box.height*.5);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.7-195,box.y+box.height*.5,{steps:14});await page.mouse.up();
  await page.screenshot({path:'test-results/real-model-side-page.png'});
  const side=await page.locator('#model-canvas').screenshot();assert(!front.equals(side),'Drag must change the actual rendered model');
  await page.mouse.move(box.x+box.width*.7,box.y+box.height*.5);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.7-195,box.y+box.height*.5,{steps:14});await page.mouse.up();
  await page.locator('#exhibit').screenshot({path:'test-results/real-model-back.png'});
  const back=await page.locator('#model-canvas').screenshot();assert(!back.equals(side)&&!back.equals(front));
  await page.locator('#reset-model').click();await page.locator('#model-canvas').focus();await page.keyboard.press('+');
  const zoomed=await page.locator('#model-canvas').screenshot();assert(!zoomed.equals(front));
  await page.locator('#rotate-model').click();assert.equal(await page.locator('#rotate-model').getAttribute('aria-pressed'),'true');
  const auto1=await page.locator('#model-canvas').screenshot();await page.waitForTimeout(250);const auto2=await page.locator('#model-canvas').screenshot();assert(!auto1.equals(auto2));
  await page.locator('#rotate-model').click();await page.locator('#reset-model').click();
  const initialTiming=await page.evaluate(()=>performance.getEntriesByName('model-ready:jiangger')[0]?.startTime);
  // A second isolated canvas exposes read-only renderer state for lifecycle assertions.
  await page.route('**/test-harness.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>html,body{margin:0;background:#172f2b}#stage{width:600px;height:600px}canvas{width:100%;height:100%;touch-action:none}</style><div id="stage"><canvas id="canvas" tabindex="0"></canvas></div>'}));
  await page.goto(new URL('./test-harness.html',base).href);
  await page.evaluate(async()=>{
    const {createViewer}=await import('./src/viewer.js');
    window.readyCount=0;window.viewerErrors=[];
    window.exhibit=createViewer({canvas:document.querySelector('canvas'),container:document.querySelector('#stage'),onProgress(){},onStatus(message,failed){if(failed)viewerErrors.push(message);},onReady(){readyCount++;},onRotation(){}});
  });
  const state=()=>page.evaluate(()=>exhibit.getState());
  const models=[];
  for(const slug of slugs){
    await page.evaluate(async slug=>{await exhibit.load(slug);await exhibit.upgrade();},slug);
    const data=await state();assert.equal(data.slug,slug);assert(data.triangles>20000);assert(data.cacheSize<=3);assert(data.drawCount>0);models.push(data);
    await page.locator('#stage').screenshot({path:`test-results/model-${slug}.png`});
  }
  // Simultaneous selection requests must not allow an older model to win.
  await page.evaluate(async()=>{await Promise.all([exhibit.load('harinidun'),exhibit.load('hongguer'),exhibit.load('jiangger')]);});
  assert.equal((await state()).slug,'jiangger');
  await page.evaluate(()=>exhibit.upgrade());
  const cacheBefore=(await state()).loadDuration;await page.evaluate(()=>exhibit.load('jiangger'));assert.equal((await state()).loadDuration,cacheBefore);
  // Drive a full revolution with keyboard input, and verify GPU frames are actually drawn.
  await page.locator('canvas').focus();const initial=await state();
  for(let i=0;i<36;i++)await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(60);const full=await state();assert(full.yaw-initial.yaw>Math.PI*2);assert(full.drawCount>initial.drawCount);
  await page.keyboard.press('0');assert(Math.abs((await state()).yaw)<.001);
  await page.mouse.move(300,300);const oldDistance=(await state()).distance;await page.mouse.wheel(0,-200);await page.waitForTimeout(100);assert((await state()).distance<oldDistance);
  await page.evaluate(()=>exhibit.reset());
  // Idle gallery does not continue issuing draw calls.
  const idle1=(await state()).drawCount;await page.waitForTimeout(180);const idle2=(await state()).drawCount;assert(idle2-idle1<=1);
  // Touch drag and pinch are tested through pointer events with touch pointerType.
  const dispatch=(type,event)=>page.locator('canvas').dispatchEvent(type,event);
  // Native pointer capture requires real active pointer IDs; use CDP touch input.
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:230,y:280,id:0},{x:370,y:280,id:1}]});
  const prePinch=(await state()).distance;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:190,y:280,id:0},{x:410,y:280,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert((await state()).distance<prePinch);
  // Simulated context loss must restore the real model, not only the poster.
  const contextLoss=await page.evaluate(()=>{
    const gl=document.querySelector('canvas').getContext('webgl2')||document.querySelector('canvas').getContext('webgl');
    window.lossExtension=gl.getExtension('WEBGL_lose_context');if(!lossExtension)return false;lossExtension.loseContext();return true;
  });
  if(contextLoss){await page.waitForFunction(()=>exhibit.getState().lost);const count=await page.evaluate(()=>readyCount);await page.evaluate(()=>lossExtension.restoreContext());await page.waitForFunction(count=>readyCount>count,count,{timeout:10000});assert.equal((await state()).lost,false);}
  assert.deepEqual(await page.evaluate(()=>viewerErrors.filter(x=>!x.includes('图形环境恢复中'))),[]);
  await page.evaluate(()=>exhibit.dispose());
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert.deepEqual(external,[]);
  const report={passed:true,initialReadyMs:Math.round(initialTiming),models:models.map(({slug,triangles,loadDuration})=>({slug,triangles,loadMs:Math.round(loadDuration)})),checks:['Real visible canvas with hidden poster','Pointer drag changes rendering','Front, side and back views','Keyboard zoom and reset','Automatic rotation changes pixels','All 12 actual models render','Stale requests cannot win','LRU cache at most 3 models','More than 360 degrees of rotation','Wheel zoom','Idle rendering stops','Two-finger touch pinch','WebGL context restored','Zero external requests','Zero uncaught browser errors']};
  fs.writeFileSync('test-results/3d-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
