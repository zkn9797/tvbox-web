'use strict';
// Minimal ES-module -> function transform so TVBox JS spiders/libs (written for QuickJS ESM)
// can run inside a Node vm context without --experimental-vm-modules.

// obfuscated modules write specifiers with JS escapes: '\x61\x73...' -> 'assets://...'
function unJs(s) { return String(s).replace(/\\x([0-9a-fA-F]{2})|\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})|\\(.)/g, (a, x, u1, u2, c) => x ? String.fromCharCode(parseInt(x, 16)) : u1 ? String.fromCodePoint(parseInt(u1, 16)) : u2 ? String.fromCharCode(parseInt(u2, 16)) : c); }
const IMPORT_RE = /^\s*import\s*(?:([\w$\u0080-\uffff]+)\s*,?\s*)?(\{[^}]*\}|\*\s*as\s+[\w$\u0080-\uffff]+)?\s*(?:from)?\s*(["'])([^"']+)\3\s*;?/;

function parseNamed(spec) {
  // "{a, b as c}" -> [[a,a],[b,c]]
  return spec.replace(/[{}]/g, '').split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const m = s.split(/\s+as\s+/); return [m[0].trim(), (m[1] || m[0]).trim()];
  });
}

function transform(src) {
  let code = String(src).replace(/^\uFEFF/, '').replace(/^#!.*\n/, '');
  const imports = [];
  let pre = '';
  // consume leading imports (minified files put them all first), skipping comments
  for (;;) {
    const c = /^(\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*/.exec(code)[0];
    const rest = code.slice(c.length);
    const m = IMPORT_RE.exec(rest);
    if (!m || /^\s*import\s*\(/.test(rest)) break;
    pre += c;
    imports.push({ def: m[1], spec: m[2], url: unJs(m[4]) });
    code = rest.slice(m[0].length);
  }
  // also catch line-start imports later in unminified files
  code = code.replace(/(?<=^|[;}\n])[ \t]*import\s*(?:([\w$\u0080-\uffff]+)\s*,?\s*)?(\{[^}]*\}|\*\s*as\s+[\w$\u0080-\uffff]+)?\s*(?:from)?\s*(["'])([^"']+)\3\s*;?/g, (all, def, spec, q, url) => {
    imports.push({ def, spec, url: unJs(url) }); return '';
  });

  const exportNames = [];
  code = code.replace(/\bexport\s+default\b\s*/g, '__exp.default=');
  code = code.replace(/\bexport\s+(async\s+function\*?|function\*?|class)\s+([\w$\u0080-\uffff]+)/g, (a, kw, name) => { exportNames.push(name); return `${kw} ${name}`; });
  code = code.replace(/\bexport\s+(const|let|var)\s+([\w$\u0080-\uffff]+)/g, (a, kw, name) => { exportNames.push(name); return `${kw} ${name}`; });
  code = code.replace(/\bexport\s*\{([^}]*)\}\s*(?:from\s*(["'])([^"']+)\2)?\s*;?/g, (a, list, q, from) => {
    const pairs = parseNamed('{' + list + '}');
    if (from) return pairs.map(([l, e]) => `__exp[${JSON.stringify(e)}]=__import(${JSON.stringify(unJs(from))})[${JSON.stringify(l)}];`).join('');
    return pairs.map(([l, e]) => `__exp[${JSON.stringify(e)}]=${l};`).join('');
  });

  let head = '';
  imports.forEach((im, i) => {
    const v = `__m${i}`;
    head += `var ${v}=__import(${JSON.stringify(im.url)});`;
    if (im.def) head += `var ${im.def}=(${v}&&${v}.default!==undefined)?${v}.default:${v};`;
    if (im.spec) {
      if (/^\*/.test(im.spec)) head += `var ${im.spec.replace(/^\*\s*as\s+/, '')}=${v};`;
      else parseNamed(im.spec).forEach(([n, a]) => { head += `var ${a}=${v}[${JSON.stringify(n)}];`; });
    }
  });
  const tail = exportNames.map(n => `__exp[${JSON.stringify(n)}]=${n};`).join('');
  // real ES modules are strict (matters for eval scoping in drpy rules); plain UMD/scripts stay sloppy
  const strict = imports.length || exportNames.length || /__exp\.default=|__exp\[/.test(code) ? '"use strict";' : '';
  return `(function(__exp,__import){${strict}${head}\n${pre}${code}\n;${tail}\nreturn __exp;})`;
}

module.exports = { transform };
