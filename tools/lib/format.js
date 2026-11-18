"use strict";
// Lua string.format specifiers, in order. A translation must keep them equal:
// a dropped or added %s is the classic way to break an addon with a translation.
const FORMAT = /%(?:%|[-+0#]*\d*(?:\.\d+)?[cdiouxXeEfgGqs])/g;

function specifiers(text) {
  return String(text).match(FORMAT) || [];
}

function formatOk(key, value) {
  const a = specifiers(key);
  const b = specifiers(value);
  if (a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

// Color and texture codes are not string.format holes, but a changed or
// dropped code breaks the panel just as visibly. The author's own locale test
// compares their counts; use the same contract here.
function codeCounts(text) {
  const s = String(text);
  return {
    color: (s.match(/\|c[0-9a-fA-F]{8}/g) || []).length,
    reset: (s.match(/\|r/g) || []).length,
    texture: (s.match(/\|T/g) || []).length,
  };
}

function codesOk(key, value) {
  const a = codeCounts(key);
  const b = codeCounts(value);
  return a.color === b.color && a.reset === b.reset && a.texture === b.texture;
}

module.exports = { specifiers, formatOk, codeCounts, codesOk };
