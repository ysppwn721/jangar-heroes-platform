import { heroes } from './heroes.js';
import { initOffline, isDemoMode, onDemoModeChange } from './offline.js';
import { initSearch, initReadingProgress } from './search-ui.js';

const $ = (selector) => document.querySelector(selector);
// Public assets resolve from the page, so GitHub Pages repository subpaths work too.
const publicAsset = (path) => new URL(`./${path}`, document.baseURI).href;
let selectedHero = heroes[0];
let filter = 'all';
let saved = new Set();
let storageAvailable = true;
try {
  const stored = JSON.parse(localStorage.getItem('jangar-saved') || '[]');
  if (Array.isArray(stored)) saved = new Set(stored.filter(id => heroes.some(h => h.id === id)));
} catch { storageAvailable = false; }
let toastTimer;
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2500);
}
/* Card posters compete with the 3D model for a slow connection, and every one of them sits
 * below the fold. Decoding is only started when a card approaches the viewport, so the
 * first model download keeps the whole link budget. Data URLs keep the markup valid and
 * the aspect ratio reserved until the real file arrives. */
const posterObserver = 'IntersectionObserver' in window ? new IntersectionObserver((entries, observer) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const image = entry.target;
    if (image.dataset.poster) image.src = image.dataset.poster;
    observer.unobserve(image);
  }
}, { rootMargin: '400px 0px' }) : null;
function deferPoster(image, source) {
  image.dataset.poster = source;
  if (posterObserver) posterObserver.observe(image);
  else image.src = source;
}
function updateCount() { $('#saved-count').textContent = String(saved.size).padStart(2, '0'); }
function saveHero(hero) {
  const wasSaved = saved.has(hero.id);
  if (wasSaved) saved.delete(hero.id); else saved.add(hero.id);
  try { localStorage.setItem('jangar-saved', JSON.stringify([...saved])); }
  catch { storageAvailable = false; }
  renderCards();
  toast(`${wasSaved ? '已取消收藏' : '已收藏'} · ${hero.name}${storageAvailable ? '' : '（仅本次浏览有效）'}`);
}
function renderCards() {
  const visibleHeroes = heroes.filter(h => filter === 'all' || (filter === 'saved' ? saved.has(h.id) : h.type === filter));
  $('#heroes-grid').replaceChildren(...visibleHeroes.map(hero => {
    const card = document.createElement('article');
    card.className = 'hero-card';
    card.dataset.hero = hero.id;
    card.innerHTML = `<div class="card-visual"><button class="card-open" aria-label="了解${hero.name}"><span class="card-index">${String(hero.id).padStart(2,'0')} / XII</span><img class="card-poster" alt="${hero.name}文创形象" decoding="async" loading="lazy" width="400" height="520" /></button><button class="save-button" aria-label="${saved.has(hero.id) ? '取消收藏' : '收藏'}${hero.name}" aria-pressed="${saved.has(hero.id)}"><svg viewBox="0 0 16 20" aria-hidden="true"><path d="M3 2h10v16l-5-4-5 4Z"/></svg></button>${hero.type === 'hidden' ? '<span class="card-tag">特别典藏</span>' : ''}</div><div class="card-info"><div><h3>${hero.name}</h3><p>${hero.title.replaceAll('/', ' · ')}</p></div><button class="card-arrow" aria-label="查看${hero.name}的3D模型">↗</button></div>`;
    deferPoster(card.querySelector('.card-poster'), publicAsset(hero.poster));
    card.querySelector('.card-open').addEventListener('click', () => showHero(hero));
    card.querySelector('.save-button').addEventListener('click', () => saveHero(hero));
    card.querySelector('.card-arrow').addEventListener('click', () => selectHero(hero));
    return card;
  }));
  $('#empty-collection').hidden = visibleHeroes.length > 0;
  updateCount();
}
const dialog = $('#hero-dialog');
let dialogHero = heroes[0];
function showHero(hero) {
  dialogHero = hero;
  $('#dialog-index').textContent = `THE HEROES / ${String(hero.id).padStart(2, '0')}`;
  $('#dialog-name').textContent = hero.name;
  $('#dialog-title').textContent = hero.title.replaceAll('/', ' · ');
  $('#dialog-description').textContent = hero.description;
  $('#dialog-poster').src = publicAsset(hero.poster);
  $('#dialog-poster').alt = `${hero.name}文创形象`;
  $('#dialog-features').replaceChildren(...hero.features.slice(0,4).map(text => {
    const li = document.createElement('li'); li.textContent = text; return li;
  }));
  dialog.showModal();
}
$('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  const rect = dialog.getBoundingClientRect();
  if(event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
$('#dialog-view').addEventListener('click', () => { dialog.close(); selectHero(dialogHero); });
document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter;
  document.querySelectorAll('.filter').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
  renderCards();
}));
$('#random-hero').addEventListener('click', () => {
  const candidates = heroes.filter(h => h.id !== selectedHero.id);
  showHero(candidates[Math.floor(Math.random() * candidates.length)]);
});
const menu = $('.menu-button');
function closeMenu() { $('#navigation').classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); menu.setAttribute('aria-label','展开导航'); }
menu.addEventListener('click', () => {
  const isOpen = $('#navigation').classList.toggle('open');
  menu.setAttribute('aria-expanded', String(isOpen)); menu.setAttribute('aria-label',isOpen ? '收起导航' : '展开导航');
});
document.querySelectorAll('#navigation a').forEach(link => link.addEventListener('click', closeMenu));
document.addEventListener('click', event => { if (!event.target.closest('.site-header')) closeMenu(); });
new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    document.querySelectorAll('#navigation a').forEach(link => link.classList.toggle('active', link.hash === `#${entry.target.id}`));
  }
}, { rootMargin: '-15% 0px -55% 0px' }).observe($('#home'));
const navObserver = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) document.querySelectorAll('#navigation a').forEach(link => link.classList.toggle('active', link.hash === `#${entry.target.id}`));
}, {rootMargin:'-10% 0px -55% 0px'});
['heroes','epic','stories','craft','discover'].forEach(id => navObserver.observe($(`#${id}`)));
let expanded = false;
let expandedFocus;
function setExpanded(value) {
  expanded = value;
  const exhibit = $('#exhibit');
  exhibit.classList.toggle('expanded', expanded);
  document.body.classList.toggle('viewer-expanded', expanded);
  $('#expand-view').setAttribute('aria-label', expanded ? '退出放大展厅' : '放大展厅');
  $('#expand-view').textContent = expanded ? '×' : '⛶';
  if (expanded) {
    expandedFocus = document.activeElement;
    exhibit.setAttribute('role','dialog'); exhibit.setAttribute('aria-modal','true'); exhibit.setAttribute('aria-label','英雄全屏展厅');
    // Make all content outside the exhibit inert, including sibling branches in main.
    let current = exhibit;
    while(current.parentElement && current.parentElement !== document.body) {
      for(const sibling of current.parentElement.children) if(sibling !== current && !sibling.inert) { sibling.inert=true; sibling.dataset.exhibitInert='true'; }
      current=current.parentElement;
    }
    for(const sibling of document.body.children) if(sibling !== current && !['SCRIPT','STYLE'].includes(sibling.tagName) && !sibling.inert) { sibling.inert=true;sibling.dataset.exhibitInert='true'; }
    $('#expand-view').focus();
  } else {
    document.querySelectorAll('[data-exhibit-inert]').forEach(el=>{el.inert=false;delete el.dataset.exhibitInert;});
    exhibit.removeAttribute('role'); exhibit.removeAttribute('aria-modal'); exhibit.removeAttribute('aria-label');
    expandedFocus?.focus();
  }
}
$('#expand-view').addEventListener('click', () => setExpanded(!expanded));
document.addEventListener('keydown', event => {
  if(event.key === 'Escape'){ if(expanded)setExpanded(false);closeMenu(); }
  if(expanded && event.key === 'Tab') {
    const focusable = [...$('#exhibit').querySelectorAll('button:not([hidden]):not(:disabled), canvas[tabindex]')];
    const first = focusable[0], last = focusable.at(-1);
    if(event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if(!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
$('#year').textContent = new Date().getFullYear();
renderCards();
// 离线能力（Service Worker + 离线状态条 + 省流量模式开关）：不阻塞首屏，注册在 load 之后
initOffline();
// 关掉省流量模式后，如果观众正看着某个模型，就把精细档补上（不必退出重进 3D 展厅）
onDemoModeChange(on => { if (!on) viewer?.upgrade?.(); });
/* 站内搜索与阅读进度（方案 A：内容定位）。
 * 搜索命中英雄时，直接把那一尊送进 3D 展厅 —— 这比"滚到卡片区自己找"少一步。
 * 注意 selectHero 的 changed 判断会让"当前那尊"不重新加载模型。 */
initSearch({
  onHeroSelect(slug) {
    const hero = heroes.find(candidate => candidate.slug === slug);
    if (hero) selectHero(hero);
  },
});
initReadingProgress();

// The first frame is a poster; the local WebGL module replaces it with real geometry.
let viewer;
let viewerPromise;
async function getViewer() {
  if (!viewerPromise) viewerPromise = import('./viewer.js').then(module => {
    viewer = module.createViewer({
      canvas: $('#model-canvas'), container: $('#model-viewer'),
      // 省流量模式："只看轻量模型"。现场演示若网络不稳，开它就不会卡在精细档下载上。
      demoMode: isDemoMode,
      onProgress(progress) { $('#model-progress span').style.width = `${progress}%`; },
      onStatus(message, failed = false) {
        $('#load-status').textContent = message; $('#retry-model').hidden = !failed;
        if(failed) { $('#rotate-model').disabled = true; $('#reset-model').disabled = true; }
      },
      onReady() { $('#model-viewer').classList.add('is-ready'); $('#model-progress span').style.width = '0'; $('#rotate-model').disabled = false; $('#reset-model').disabled = false; },
      onQuality(quality) {
        $('#model-viewer').dataset.quality = quality;
        const button=$('#detail-model');
        button.hidden = quality==='detail'||quality==='initial';
        button.disabled = quality==='loading';
        button.textContent = quality==='loading' ? '细节加载中…' : '查看精细模型';
      },
      onRotation(value) { $('#rotate-model').setAttribute('aria-pressed', String(value)); $('#rotate-model').setAttribute('aria-label',value ? '暂停自动旋转':'开启自动旋转'); $('#rotate-model').textContent = value ? 'Ⅱ' : '▷'; },
    });
    return viewer;
  }).catch(error => { viewerPromise = null; throw error; });
  return viewerPromise;
}
let selectionVersion = 0;
async function loadSelected() {
  const version = ++selectionVersion;
  $('#retry-model').hidden = true;
  $('#load-status').textContent = '正在加载 360° 模型';
  $('#rotate-model').disabled = true; $('#reset-model').disabled = true;
  try {
    const engine = await getViewer();
    if(version !== selectionVersion) return;
    await engine.load(selectedHero.slug);
  } catch(error) {
    if(version !== selectionVersion) return;
    console.warn('3D unavailable; displaying the character poster.', error);
    $('#load-status').textContent = '当前展示英雄图片 · 3D 暂不可用';
    $('#retry-model').hidden = false;
  }
}
function selectHero(hero) {
  const changed = selectedHero.id !== hero.id;
  selectedHero = hero;
  $('#model-name').textContent = hero.name;
  $('#model-title').textContent = hero.title.replaceAll('/', ' · ');
  $('#model-number').textContent = `${String(hero.id).padStart(2,'0')} / 12`;
  $('#model-viewer').setAttribute('aria-label',`${hero.name}三维模型，拖动旋转，双指缩放`);
  if(changed) {
    $('#model-viewer').classList.remove('is-ready');
    $('#model-poster').src = publicAsset(hero.poster);
    $('#model-poster').alt = `${hero.name}文创形象`;
    loadSelected();
  }
  $('#home').scrollIntoView({behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
}
$('#detail-model').addEventListener('click',()=>viewer?.upgrade());
$('#retry-model').addEventListener('click',loadSelected);
$('#rotate-model').addEventListener('click',() => { if(viewer) viewer.toggleRotation(); else toast('3D 准备就绪后，即可旋转查看'); });
$('#reset-model').addEventListener('click',() => { if(viewer) viewer.reset(); else toast('当前展示英雄图片'); });
// Start immediately; do not wait for below-the-fold images or window.load.
loadSelected();
// Accessible thematic reading tabs: keyboard arrows, Home and End move focus.
const chapterTabs = [...document.querySelectorAll('.chapter-tab')];
function activateChapter(index, focus = false) {
  chapterTabs.forEach((tab, i) => {
    const active = i === index;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
  });
  if (focus) chapterTabs[index].focus();
}
chapterTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateChapter(index));
  tab.addEventListener('keydown', event => {
    let target;
    if (['ArrowDown', 'ArrowRight'].includes(event.key)) target = (index + 1) % chapterTabs.length;
    if (['ArrowUp', 'ArrowLeft'].includes(event.key)) target = (index - 1 + chapterTabs.length) % chapterTabs.length;
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = chapterTabs.length - 1;
    if (target !== undefined) { event.preventDefault(); activateChapter(target, true); }
  });
});
document.querySelectorAll('[data-explore-hero]').forEach(button => button.addEventListener('click', () => {
  const hero = heroes.find(item => item.id === Number(button.dataset.exploreHero));
  if (hero) selectHero(hero);
}));

/* ---------- 版本对照阅读器（方案 7） ----------
   交互刻意只做"切换突出"：两栏**始终同时在屏幕上** ——
   对照阅读器的价值就在于左右两边能一眼比较，把另一栏藏起来就失去意义了。
   所以这里只调透明度与边框，不做 hidden / display 切换。 */
const versionTabs = [...document.querySelectorAll('.version-tab')];
const versionPanels = [...document.querySelectorAll('.version-card')];
function activateVersion(index, focus = false) {
  versionTabs.forEach((tab, i) => {
    const active = i === index;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  versionPanels.forEach((panel, i) => panel.classList.toggle('dimmed', i !== index));
  if (focus && versionTabs[index]) versionTabs[index].focus();
}
versionTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => activateVersion(index));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'ArrowLeft' ? (index - 1 + versionTabs.length) % versionTabs.length
      : event.key === 'ArrowRight' ? (index + 1) % versionTabs.length
        : event.key === 'Home' ? 0 : versionTabs.length - 1;
    activateVersion(next, true);
  });
});
if (versionTabs.length) activateVersion(0);
// 座次表里能对上图鉴的英雄：点一下直接去 3D 展厅看这一尊
document.querySelectorAll('.version-list li[data-hero]').forEach(item => {
  item.classList.add('is-linked');
  item.tabIndex = 0;
  item.setAttribute('role', 'button');
  const name = item.querySelector('b')?.textContent || '';
  item.setAttribute('aria-label', `在展厅里查看${name.split('·').pop()}`);
  const go = () => {
    const hero = heroes.find(candidate => candidate.slug === item.dataset.hero);
    if (hero) selectHero(hero);
  };
  item.addEventListener('click', go);
  item.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(); }
  });
});

const questions = [
  { title: '史诗中的理想家园叫什么？', options: ['宝木巴', '江格尔齐', '洪古尔'], correct: 0, explanation: '宝木巴是《江格尔》中承载和平与美好生活向往的理想家园。英雄们的行动，与守护这个家园紧密相连。' },
  { title: '“江格尔齐”指的是谁？', options: ['文创角色的设计者', '《江格尔》的演唱者', '史诗中的一匹骏马'], correct: 1, explanation: '“江格尔齐”是《江格尔》演唱者的称呼。他们通过吟诵与演唱，让史诗在口头传承中延续。' },
  { title: '怎样理解展馆里的“十二英雄”？', options: ['史诗一共只有十二个人物', '史诗的十二个固定章回', '本项目选取的文创角色群像'], correct: 2, explanation: '十二英雄是本项目的展示组织方式。史诗拥有丰富的人物与不同传承版本，文创图鉴不能替代完整的史诗。' },
];
let questionIndex = 0, correctAnswers = 0, answered = false, completed = false;
function showQuestion() {
  const question = questions[questionIndex];
  answered = false; completed = false;
  $('#quiz-progress').textContent = `${String(questionIndex + 1).padStart(2, '0')} / 03`;
  $('#quiz-question').textContent = question.title;
  $('#quiz-feedback').textContent = '';
  $('#quiz-next').hidden = true;
  $('#quiz-options').replaceChildren(...question.options.map((label, index) => {
    const button = document.createElement('button');
    button.className = 'quiz-option';
    button.innerHTML = `<span aria-hidden="true">${String.fromCharCode(65 + index)}</span>${label}`;
    button.addEventListener('click', () => {
      if (answered) return;
      answered = true;
      const isCorrect = index === question.correct;
      if (isCorrect) correctAnswers++;
      [...$('#quiz-options').children].forEach((option, i) => {
        option.disabled = true;
        if (i === question.correct) { option.classList.add('correct'); option.insertAdjacentHTML('beforeend', '<b>正确答案 ✓</b>'); }
        else if (i === index) { option.classList.add('incorrect'); option.insertAdjacentHTML('beforeend', '<b>再记一下</b>'); }
      });
      $('#quiz-feedback').textContent = `${isCorrect ? '答对了。' : '这次还差一点。'}${question.explanation}`;
      $('#quiz-next').textContent = questionIndex === questions.length - 1 ? '查看结果 →' : '下一题 →';
      $('#quiz-next').hidden = false;
    });
    return button;
  }));
}
$('#quiz-next').addEventListener('click', () => {
  if (completed) { questionIndex = 0; correctAnswers = 0; showQuestion(); $('#quiz-options button').focus(); return; }
  if (!answered) return;
  if (questionIndex < questions.length - 1) { questionIndex++; showQuestion(); $('#quiz-options button').focus(); }
  else {
    completed = true;
    $('#quiz-progress').textContent = '旅程完成';
    $('#quiz-question').textContent = '带着新的理解，再看一次英雄。';
    $('#quiz-options').innerHTML = `<div class="quiz-result"><div class="quiz-score">${correctAnswers}<small> / 3</small></div><p>${correctAnswers === 3 ? '三道题全部答对！你已经认识了宝木巴、江格尔齐与本馆的文创群像。' : '这次相遇又多了一点收获。回到史诗长卷和传唱介绍，可以再找找答案。'}</p></div>`;
    $('#quiz-feedback').textContent = `旅程完成，共答对 ${correctAnswers} 题。`;
    $('#quiz-next').textContent = '再走一遍 ↺';
    $('#quiz-next').focus();
  }
});
showQuestion();
