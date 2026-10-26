/**
 * matcher.js — エラー文の正規化と照合（SDD C-03）
 *
 * 一次キー一致 → 文言一致の順で、priority の小さい順・カタログ記載順に1件だけ返す
 * （FR-EXPL-002）。例外を投げない（不正入力は matched=false・FR-EXPL-003）。
 * NFKC は行わない（エラー文の英字・記号を変えないため・SDD §3）。
 */

'use strict';

const { LIMITS } = require('./constants');
const { matchKind } = require('./catalog');

const RANK_ORDER = Object.freeze({ id: 0, pattern: 1 });

/**
 * 改行を LF に統一し、長文は先頭と末尾だけを改行で区切って残す（SRS §9）
 * @param {string} text
 * @returns {string}
 */
function normalizeInput(text) {
  const lf = text.split('\r\n').join('\n').split('\r').join('\n');
  if (lf.length <= LIMITS.INPUT_MAX) return lf;
  return `${lf.slice(0, LIMITS.HEAD_TAIL)}\n${lf.slice(-LIMITS.HEAD_TAIL)}`;
}

// コンパイル済みでないエントリが混ざっても例外にせず不一致として扱う
function safeMatchKind(compiled, input) {
  try {
    return matchKind(compiled, input);
  } catch (_) {
    return null;
  }
}

function isBetter(candidate, best) {
  if (!best) return true;
  if (candidate.order !== best.order) return candidate.order < best.order;
  return candidate.priority < best.priority;
}

/**
 * エラー文に一致するエントリを1件返す
 * @param {object[]} entries catalog.loadCatalog / compileEntry で得たコンパイル済みエントリ
 * @param {string} text エラー文
 * @returns {{matched: false} | {matched: true, entry: object, rank: 'id'|'pattern'}}
 */
function matchError(entries, text) {
  if (!Array.isArray(entries) || typeof text !== 'string' || text.length === 0) return { matched: false };
  const input = normalizeInput(text);
  let best = null;
  for (const compiled of entries) {
    const rank = safeMatchKind(compiled, input);
    if (rank === null) continue;
    const candidate = { compiled, rank, order: RANK_ORDER[rank], priority: compiled.entry.priority };
    if (isBetter(candidate, best)) best = candidate;
  }
  if (!best) return { matched: false };
  return { matched: true, entry: best.compiled.entry, rank: best.rank };
}

module.exports = {
  normalizeInput,
  matchError,
};
