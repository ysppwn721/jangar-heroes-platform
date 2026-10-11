/**
 * 站内搜索的界面层 + 阅读进度（方案 A：内容定位）。
 *
 * 交互上的几个有意选择：
 *   ① **对话框而不是常驻搜索框**：14 分钟阅读量的展馆，搜索是"偶尔需要"而非"一直在用"，
 *      常驻输入框会一直占版面。`<dialog>` 还自带 Esc 关闭与焦点管理。
 *   ② **`/` 唤起**：和常见文档站一致，键盘用户不必先找按钮。
 *   ③ **结果里显示分类与摘要**，并让摘要截在命中词附近 ——
 *      否则观众看到三条都以"江格尔是…"开头的摘要，分不清要点哪条。
 *   ④ **英雄结果直接进 3D 展厅**（通过回调交给页面），而不是只滚到卡片区。
 *   ⑤ **搜不到时给出口**：提示可以换个说法，或去问 AI 讲解员 ——
 *      而不是让观众以为"馆里没有这个内容"。
 */

import { searchSite } from './local-search.js';

const $ = selector => document.querySelector(selector);

/** 需要平滑滚动的偏好判断（尊重系统设置） */
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initSearch({ onHeroSelect } = {}) {
  const dialog = $('#search-dialog');
  const input = $('#search-input');
  const list = $('#search-results');
  const empty = $('#search-empty');
  const openButton = $('#search-open');
  if (!dialog || !input || !list) return null;

  let results = [];
  let active = -1;

  /** 打开搜索：预填上次的查询，方便继续找 */
  const open = () => {
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    input.value = '';
    render('');
    input.focus();
  };
  /** 关闭并让焦点回到搜索按钮（键盘用户不必重新 Tab 一圈） */
  const close = () => {
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
    openButton?.focus?.();
  };

  /* 显式处理 Esc，不依赖 `<dialog>` 的原生行为。
   * 实测：原生 Esc 关闭在"输入框刚被填写过"之后会失效
   * （输入框仍持有焦点时按键被它先吃掉），对照组却能关 —— 这种依赖浏览器内部状态的行为不能靠。
   * 自己处理还有两个好处：能 preventDefault 保证一致，关闭后能把焦点还给搜索按钮。 */
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });

  function render(query) {
    const text = String(query || '').trim();
    results = text ? searchSite(text) : [];
    active = results.length ? 0 : -1;
    list.replaceChildren(...results.map((result, index) => row(result, index)));
    list.hidden = results.length === 0;
    // 空态分两种：还没输入、输入了但没找到 —— 给的处理建议不同
    empty.hidden = results.length > 0;
    if (!results.length) {
      empty.textContent = text
        ? `没有找到「${text}」。换个说法试试（比如「射箭」「纹样」「宝木巴」），或到「江格尔齐」讲解员那边直接问一句。`
        : '试试输入英雄名（洪古尔）、纹样（云纹）、或想问的事（怎么去展馆）。';
    }
    syncActive();
  }

  function row(result, index) {
    const item = document.createElement('li');
    item.className = 'search-item';
    item.setAttribute('role', 'option');
    item.id = `search-option-${index}`;
    item.dataset.index = String(index);

    const kind = document.createElement('span');
    kind.className = `search-kind search-kind-${result.kind}`;
    kind.textContent = result.kindLabel;

    const title = document.createElement('span');
    title.className = 'search-item-title';
    title.textContent = result.title;

    const snippet = document.createElement('span');
    snippet.className = 'search-item-snippet';
    snippet.textContent = result.snippet;

    item.append(kind, title, snippet);
    item.addEventListener('mouseenter', () => { active = index; syncActive(); });
    item.addEventListener('click', () => go(result));
    return item;
  }

  function syncActive() {
    [...list.children].forEach((node, index) => {
      const selected = index === active;
      node.classList.toggle('active', selected);
      node.setAttribute('aria-selected', String(selected));
    });
    const current = list.children[active];
    if (current) {
      input.setAttribute('aria-activedescendant', current.id);
      current.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  /** 前往结果：英雄 → 交给页面进 3D 展厅；其它 → 滚到锚点并短暂高亮 */
  function go(result) {
    if (!result) return;
    close();
    if (result.target?.hero && typeof onHeroSelect === 'function') {
      onHeroSelect(result.target.hero);
      return;
    }
    const anchor = result.target?.anchor;
    const node = anchor ? document.getElementById(anchor) : null;
    if (!node) return;
    // 长卷的某一页：先切到那一页，再滚过去
    if (result.target?.chapter !== undefined) {
      document.getElementById(`chapter-tab-${result.target.chapter}`)?.click();
    }
    node.scrollIntoView({ behavior: reduceMotion() ? 'instant' : 'smooth', block: 'start' });
    highlight(node);
  }

  /** 滚动到目标后短暂描边：否则观众会疑惑"跳过来的是哪一块" */
  function highlight(node) {
    node.classList.add('search-target');
    setTimeout(() => node.classList.remove('search-target'), 2200);
  }

  openButton?.addEventListener('click', open);
  $('#search-close')?.addEventListener('click', close);
  input.addEventListener('input', () => render(input.value));

  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (results.length) { active = (active + 1) % results.length; syncActive(); }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length) { active = (active - 1 + results.length) % results.length; syncActive(); }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(results[active]);
    }
  });

  // 点击遮罩关闭（与英雄弹窗一致的行为）
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) {
      close();
    }
  });

  // 快捷键：`/` 唤起；Esc 由 dialog 原生处理
  document.addEventListener('keydown', event => {
    const target = event.target;
    const typing = target instanceof HTMLElement
      && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (event.key === '/' && !typing && !dialog.open) {
      event.preventDefault();
      open();
    }
  });

  return { open, close, render: query => render(query) };
}

/**
 * 阅读进度条。
 * 只做一件事：让观众知道"还剩多少"，长页面最容易中途迷路。
 * 用 rAF 节流 —— 滚动事件里直接改样式会在低端机上掉帧。
 */
export function initReadingProgress() {
  const bar = $('#reading-progress-bar');
  const track = $('#reading-progress');
  if (!bar || !track) return;
  let ticking = false;
  const update = () => {
    ticking = false;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
    bar.style.width = `${(ratio * 100).toFixed(2)}%`;
    track.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    // 未开始滚动时不显示，避免首屏顶部出现一条无意义的线
    track.classList.toggle('is-visible', window.scrollY > 40);
  };
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  }, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  update();
}
