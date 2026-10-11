/** Minify a text asset for the static build.
 * terser is used when it is present in node_modules (the same package webpack already
 * depends on); otherwise the original text is returned untouched. The build therefore
 * never requires an install, matching the rest of the pipeline.
 */
let terserPromise = null;
async function loadTerser() {
  if (!terserPromise) {
    terserPromise = import('terser')
      .then(module => module.default ?? module)
      .catch(() => null);
  }
  return terserPromise;
}

async function minifyJavaScript(source, filename) {
  const terser = await loadTerser();
  if (!terser) return { code: source, minified: false, note: 'terser unavailable, shipping source' };
  const result = await terser.minify(source, {
    module: true,
    compress: { passes: 2, pure_getters: true, unsafe_arrows: true, ecma: 2021 },
    mangle: { module: true },
    format: { comments: false, ascii_only: false, ecma: 2021 },
  });
  if (!result.code) throw new Error(`terser produced no output for ${filename}`);
  return { code: result.code, minified: true };
}

/** Tokenising CSS minifier. It walks the stylesheet once and removes only whitespace that
 * cannot change meaning. The difficult case is the descendant combinator: `.a .b` and `.a.b`
 * are different selectors, so a space must survive between an identifier and the next compound
 * selector's start. `{ color`, `color : red` and `a > b` do not need theirs.
 */
function minifyCss(source) {
  const isSpace = character => character === ' ' || character === '\t' || character === '\n' || character === '\r' || character === '\f';
  const isIdent = character => /[\w-]/.test(character);
  // A space between these two characters is significant (or at least ambiguous).
  const needsSpace = (previous, next) => {
    if (!previous || !next) return false;
    if (previous === ')' && isIdent(next)) return true;
    if (!isIdent(previous) && previous !== ')' && previous !== ']' && previous !== '*') return false;
    return isIdent(next) || next === '.' || next === '#' || next === '[' || next === ':' || next === '*' || next === '(';
  };
  let out = '';
  let index = 0;
  const length = source.length;
  while (index < length) {
    const character = source[index];
    if (character === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      index = end === -1 ? length : end + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      let end = index + 1;
      while (end < length) {
        if (source[end] === '\\') { end += 2; continue; }
        if (source[end] === character) { end++; break; }
        end++;
      }
      out += source.slice(index, end);
      index = end;
      continue;
    }
    if (isSpace(character)) {
      let end = index;
      while (end < length && isSpace(source[end])) end++;
      if (needsSpace(out.at(-1) ?? '', source[end] ?? '')) out += ' ';
      index = end;
      continue;
    }
    // A block's final semicolon is redundant; drop it without touching the next statement.
    if (character === ';') {
      let lookahead = index + 1;
      while (lookahead < length && isSpace(source[lookahead])) lookahead++;
      if (source[lookahead] === '}') { index++; continue; }
    }
    out += character;
    index++;
  }
  out = out.replace(/^\s+|\s+$/g, '');
  assertBalanced(out);
  return out;
}

/** Fails loudly on unbalanced blocks, which is exactly the failure a whitespace-only minifier
 * can introduce; shipping it silently would break every rule after the mistake. */
function assertBalanced(css) {
  const stack = [];
  let index = 0;
  while (index < css.length) {
    const character = css[index];
    if (character === '"' || character === "'") {
      let end = index + 1;
      while (end < css.length) {
        if (css[end] === '\\') { end += 2; continue; }
        if (css[end] === character) { end++; break; }
        end++;
      }
      index = end;
      continue;
    }
    if (character === '{') stack.push(index);
    else if (character === '}') {
      if (!stack.length) throw new Error(`CSS minifier: unexpected } at offset ${index}`);
      const open = stack.pop();
      const block = css.slice(open + 1, index);
      if (block.trim().startsWith(';')) throw new Error(`CSS minifier: stray ';' after { at offset ${open}`);
    }
    index++;
  }
  if (stack.length) throw new Error(`CSS minifier: unclosed { at offset ${stack[0]}`);
}

export { minifyCss, minifyJavaScript, loadTerser };
