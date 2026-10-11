const { launch } = require('./browser.cjs');
const assert=require('node:assert/strict');const fs=require('node:fs');
const base=process.env.TEST_URL||'http://127.0.0.1:4174/jiangger-blindbox-website/';
(async()=>{
 const browser=await launch();
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base,{waitUntil:'networkidle'});await page.locator('#model-viewer.is-ready').waitFor();
 assert.equal(await page.locator('.chapter-tab').count(),4);
 await page.locator('#stories').scrollIntoViewIfNeeded();
 await page.locator('#stories').screenshot({path:'test-results/reading-room.png'});
 await page.locator('#chapter-tab-0').focus();await page.keyboard.press('ArrowDown');
 assert.equal(await page.locator('#chapter-tab-1').getAttribute('aria-selected'),'true');
 assert.equal(await page.locator('#chapter-panel-0').isVisible(),false);assert(await page.locator('#chapter-panel-1').isVisible());
 await page.keyboard.press('End');assert.equal(await page.locator('#chapter-tab-3').getAttribute('aria-selected'),'true');await page.keyboard.press('Home');assert(await page.locator('#chapter-panel-0').isVisible());
 for(let i=0;i<4;i++){await page.locator(`#chapter-tab-${i}`).click();assert(await page.locator(`#chapter-panel-${i}`).isVisible());}
 await page.locator('#motifs [data-explore-hero="6"]').click();await page.locator('#model-viewer.is-ready').waitFor();assert.equal(await page.locator('#model-name').innerText(),'明彦');
 // Correct, incorrect, score, and replay paths, including keyboard answers.
 await page.locator('#quiz-options button').nth(0).click();assert((await page.locator('#quiz-feedback').innerText()).includes('答对了'));
 await page.locator('#quiz-next').click();await page.keyboard.press('ArrowDown');
 await page.locator('#quiz-options button').nth(0).click();assert((await page.locator('#quiz-feedback').innerText()).includes('还差一点'));
 assert.equal(await page.locator('.quiz-option.correct').count(),1);assert.equal(await page.locator('.quiz-option.incorrect').count(),1);
 await page.locator('#quiz-next').click();await page.locator('#quiz-options button').nth(2).focus();await page.keyboard.press('Enter');await page.locator('#quiz-next').click();
 assert.equal(await page.locator('.quiz-score').innerText(),'2 / 3');await page.locator('#quiz-next').click();assert.equal(await page.locator('#quiz-progress').innerText(),'01 / 03');
 await page.locator('.visit-notes details').nth(1).locator('summary').click();assert(await page.locator('.visit-notes details').nth(1).evaluate(e=>e.open));
 for(const id of ['living-epic','motifs','discover']){await page.locator('#'+id).scrollIntoViewIfNeeded();await page.locator('#'+id).screenshot({path:'test-results/'+id+'.png'});}
 for(const width of [1440,1024,768,390,360]){
  await page.setViewportSize({width,height:900});await page.evaluate(()=>scrollTo(0,0));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Overflow at ${width}`);
  if(width===390){await page.locator('#stories').scrollIntoViewIfNeeded();await page.locator('#stories').screenshot({path:'test-results/reading-mobile.png'});await page.locator('#discover').scrollIntoViewIfNeeded();await page.locator('#discover').screenshot({path:'test-results/discover-mobile.png'});}
 }
 assert.deepEqual(errors,[]);console.log('Culture content passed: four reading tabs, keyboard navigation, motif-to-model links, correct/incorrect answers, score, replay, FAQ, 360–1440px layouts, zero errors.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
