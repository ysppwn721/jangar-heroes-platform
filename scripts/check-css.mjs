/** Guard the CSS build: the whitespace minifier must not change how the stylesheet parses or
 * what it selects. Compares the source and the minified output rule by rule.
 * Usage: node scripts/check-css.mjs
 */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { minifyCss } from './minify.mjs';

const source = await fs.readFile('style.css', 'utf8');

/** Reduces a stylesheet to a token stream with every insignificant difference removed: comments,
 * whitespace runs, and the space that is optional around punctuation. Two stylesheets with the
 * same stream parse to the same thing, so this compares meaning rather than formatting. */
function tokenize(css) {
  const tokens = [];
  let index = 0;
  const length = css.length;
  const isSpace = character => ' \t\n\r\f'.includes(character);
  while (index < length) {
    const character = css[index];
    if (character === '/' && css[index + 1] === '*') {
      const end = css.indexOf('*/', index + 2);
      index = end === -1 ? length : end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      let end = index + 1;
      while (end < length) {
        if (css[end] === '\\') { end += 2; continue; }
        if (css[end] === character) { end++; break; }
        end++;
      }
      tokens.push(css.slice(index, end));
      index = end;
      continue;
    }
    if (isSpace(character)) {
      let end = index;
      while (end < length && isSpace(css[end])) end++;
      const previous = tokens.at(-1) ?? '';
      const next = css[end] ?? '';
      // Mirror the minifier's rule so this comparison is about meaning, not spacing choice:
      // a space that separates a descendant selector is meaningful and must be present in both.
      const significant = (before, after) => {
        if (!before || !after) return false;
        const ident = character => /[\w-]/.test(character);
        if (before === ')' && ident(after)) return true;
        if (!ident(before) && before !== ')' && before !== ']' && before !== '*') return false;
        return ident(after) || '.#[:*('.includes(after);
      };
      if (significant(previous.at(-1) ?? '', next)) tokens.push(' ');
      index = end;
      continue;
    }
    if (character === ';') {
      let lookahead = index + 1;
      while (lookahead < length && isSpace(css[lookahead])) lookahead++;
      if (css[lookahead] === '}') { index++; continue; }
    }
    tokens.push(character);
    index++;
  }
  return tokens.join('');
}

const sourceStream = tokenize(source);
const minified = minifyCss(source);
const minifiedStream = tokenize(minified);
assert.equal(minifiedStream, sourceStream, 'minified CSS no longer means the same thing as the source');

// The critical and polish blocks are extracted by the build; keep their markers intact.
const critical = /\/\*#critical-start\*\/([\s\S]*?)\/\*#critical-end\*\//.exec(source);
const polish = /\/\*#polish-start\*\/([\s\S]*?)\/\*#polish-end\*\//.exec(source);
assert(critical, 'style.css must keep the critical block markers used by the build');
assert(polish, 'style.css must keep the polish block markers');

// Selectors that appear in both blocks must not disagree about a property's value, because the
// critical block is inlined ahead of the deferred one and a mismatch would repaint the first
// viewport. Redundant repeats are fine; conflicting values are not.
const declared = text => {
  const map = new Map();
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim().replace(/\s+/g, ' ');
    const properties = new Map();
    for (const declaration of match[2].split(';')) {
      const colon = declaration.indexOf(':');
      if (colon === -1) continue;
      properties.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
    }
    map.set(selector, properties);
  }
  return map;
};
const criticalRules = declared(critical[1]);
const polishRules = declared(polish[1]);
const conflicts = [];
for (const [selector, properties] of criticalRules) {
  const deferred = polishRules.get(selector);
  if (!deferred) continue;
  for (const [property, value] of properties) {
    const other = deferred.get(property);
    if (other !== undefined && other !== value) conflicts.push(`${selector} { ${property}: ${value} vs ${other} }`);
  }
}
assert.deepEqual(conflicts, [], `critical and polish blocks disagree on: ${conflicts.join('; ')}`);

const savings = (1 - minified.length / source.length) * 100;
console.log(`CSS verified: identical meaning after minification, ${source.length} -> ${minified.length} bytes (-${savings.toFixed(1)}%), ${criticalRules.size} critical selectors, ${polishRules.size} polish selectors, no conflicting declarations.`);
