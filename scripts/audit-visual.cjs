/** Audit the rendered page for accessibility and polish issues that are measurable rather than
 * subjective: text contrast, font resolution, overflow, tap-target size, focus ring presence and
 * layout shifts. Usage: node scripts/audit-visual.cjs [label]
 * Env: TEST_URL (default http://127.0.0.1:4173), PLAYWRIGHT_MODULE
 */
const { launch } = require('./browser.cjs');
const fs = require('node:fs');
const base = process.env.TEST_URL || 'http://127.0.0.1:4173';
const label = process.argv[2] || 'visual';

(async () => {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const shifts = [];
  await page.addInitScript(() => {
    window.__cls = 0;
    try {
      new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value; }).observe({ type: 'layout-shift', buffered: true });
    } catch {}
  });
  await page.goto(base, { waitUntil: 'load' });
  // The stylesheet is inlined by the build; wait until the browser has actually applied it
  // before measuring, so the report describes the final rendering rather than a fallback.
  await page.waitForFunction(() => [...document.styleSheets].some(sheet => { try { return sheet.cssRules.length > 100; } catch { return false; } }), {}, { timeout: 10000 });
  await page.waitForTimeout(600);
  // Scroll the whole page so lazy posters are requested before images are checked.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise(resolve => setTimeout(resolve, 60)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(900);

  const audit = await page.evaluate(() => {
    const parse = value => {
      const match = String(value).match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    };
    const luminance = ({ r, g, b }) => {
      const channel = value => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const blend = (front, back) => front.a >= 1 ? front : { r: front.r * front.a + back.r * (1 - front.a), g: front.g * front.a + back.g * (1 - front.a), b: front.b * front.a + back.b * (1 - front.a), a: 1 };
    const ratio = (a, b) => { const la = luminance(a), lb = luminance(b); return +(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05))).toFixed(2); };
    const background = element => {
      let node = element, stack = [];
      while (node && node !== document.documentElement) {
        const style = getComputedStyle(node);
        const image = style.backgroundImage;
        // A gradient with an opaque stop is a surface of its own: it either supplies the
        // backdrop, or (when every stop is translucent) it only darkens whatever is behind it,
        // in which case the walk continues to the surface underneath.
        if (image && image !== 'none' && image.includes('gradient')) {
          const stops = [...image.matchAll(/rgba?\(([^)]+)\)/g)].map(match => parse(`rgba(${match[1]})`)).filter(Boolean);
          const opaque = stops.find(stop => stop.a >= 0.9);
          if (opaque) { stack.push(opaque); break; }
        }
        const colour = parse(style.backgroundColor);
        if (colour && colour.a > 0) { stack.push(colour); if (colour.a >= 1) break; }
        node = node.parentElement;
      }
      let result = { r: 255, g: 255, b: 255, a: 1 };
      for (const layer of stack.reverse()) result = blend({ ...layer, a: layer.a }, result);
      return result;
    };
    // Decorative watermarks and oversized numerals are marks, not reading text.
    const decorative = element => Boolean(element.closest('.exhibit-watermark, .story-number, [aria-hidden="true"]'));
    const textNodes = [];
    const walk = element => {
      for (const child of element.children) {
        if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(child.tagName)) continue;
        const style = getComputedStyle(child);
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.15) continue;
        const own = [...child.childNodes].filter(node => node.nodeType === 3 && node.textContent.trim().length > 1);
        if (own.length && !decorative(child)) {
          const size = parseFloat(style.fontSize);
          const weight = Number(style.fontWeight) || 400;
          const colour = parse(style.color);
          const back = background(child);
          if (colour) {
            const front = blend(colour, back);
            const contrast = ratio(front, back);
            const large = size >= 24 || (size >= 18.66 && weight >= 700);
            textNodes.push({
              selector: `${child.tagName.toLowerCase()}${child.className && typeof child.className === 'string' ? '.' + child.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`,
              sample: own.map(node => node.textContent.trim()).join(' ').slice(0, 28),
              fontSize: +size.toFixed(1), fontWeight: weight, contrast,
              color: `rgb(${Math.round(front.r)},${Math.round(front.g)},${Math.round(front.b)})`,
              background: `rgb(${Math.round(back.r)},${Math.round(back.g)},${Math.round(back.b)})`,
              required: large ? 3 : 4.5,
              passes: contrast >= (large ? 3 : 4.5),
            });
          }
        }
        walk(child);
      }
    };
    walk(document.body);

    const interactives = [...document.querySelectorAll('button, a, summary, [role="tab"]')].map(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        selector: `${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? '.' + element.className.trim().split(/\s+/)[0] : ''}`,
        text: (element.textContent || '').trim().slice(0, 20),
        width: Math.round(rect.width), height: Math.round(rect.height),
        visible: rect.width > 0 && rect.height > 0,
        small: rect.width > 0 && rect.height > 0 && (rect.height < 24 || rect.width < 24),
        cursor: style.cursor,
      };
    }).filter(entry => entry.visible);

    const fonts = [...new Set([...document.querySelectorAll('h1,h2,h3,.brand strong,.chapter-panel h3')].map(element => getComputedStyle(element).fontFamily))];
    const overflow = document.documentElement.scrollWidth - window.innerWidth;
    const images = [...document.images].map(image => ({ src: image.currentSrc.split('/').pop(), loaded: image.complete && image.naturalWidth > 0, alt: image.hasAttribute('alt'), width: image.naturalWidth, height: image.naturalHeight }));
    return {
      contrastFailures: textNodes.filter(node => !node.passes).sort((a, b) => a.contrast - b.contrast),
      contrastChecked: textNodes.length,
      worstContrast: textNodes.sort((a, b) => a.contrast - b.contrast).slice(0, 12),
      smallTargets: interactives.filter(entry => entry.small),
      headingFonts: fonts,
      horizontalOverflow: overflow,
      brokenImages: images.filter(entry => !entry.loaded),
      missingAlt: images.filter(entry => !entry.alt),
      imageCount: images.length,
    };
  });

  audit.cumulativeLayoutShift = await page.evaluate(() => +Number(window.__cls || 0).toFixed(4));
  audit.viewport = await page.viewportSize();
  console.log(JSON.stringify(audit, null, 2));
  fs.writeFileSync(`test-results/visual-audit-${label}.json`, JSON.stringify(audit, null, 2));
  await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
