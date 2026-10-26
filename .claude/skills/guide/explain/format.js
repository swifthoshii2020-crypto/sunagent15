/**
 * format.js — 説明結果の整形（SDD C-04）
 *
 * 端末向け3部構成・JSON（1行）・hook 向け systemMessage / additionalContext を作る。
 * 出力はカタログの文言だけで組み立て、エラー原文は受け取らない・再掲しない（NFR-SEC-001）。
 */

'use strict';

const { LIMITS } = require('./constants');
const {
  HEADINGS, NOT_FOUND, NOT_FOUND_STEPS, CONTEXT_NOTE, closingLine,
} = require('./messages');

function numbered(steps) {
  return steps.map((step, i) => `  ${i + 1}. ${step}`);
}

function termsLine(terms) {
  if (!Array.isArray(terms) || terms.length === 0) return [];
  return [`${HEADINGS.TERMS}${terms.map((t) => `${t.term}＝${t.desc}`).join(' ／ ')}`];
}

function unmatchedLines() {
  return [`${HEADINGS.WHAT}${NOT_FOUND}`, HEADINGS.STEPS, ...numbered(NOT_FOUND_STEPS)];
}

/**
 * 端末向けの説明（FR-EXPL-001 / FR-EXPL-003）
 * @param {{matched: boolean, entry?: object}} result matcher.matchError の戻り値
 * @returns {string}
 */
function formatTerminal(result) {
  if (!result || !result.matched) return unmatchedLines().join('\n');
  const { entry } = result;
  const lines = [`${HEADINGS.WHAT}${entry.what}`, HEADINGS.STEPS, ...numbered(entry.steps)];
  if (typeof entry.command === 'string' && entry.command.length > 0) lines.push(`${HEADINGS.COMMAND}${entry.command}`);
  lines.push(...termsLine(entry.terms), closingLine(entry.id));
  return lines.join('\n');
}

/**
 * JSON 1行（FR-EXPL-005）
 * @returns {string}
 */
function formatJson(result) {
  if (!result || !result.matched) {
    return JSON.stringify({ matched: false, id: null, what: NOT_FOUND, steps: NOT_FOUND_STEPS, terms: [] });
  }
  const { entry } = result;
  return JSON.stringify({
    matched: true,
    id: entry.id,
    what: entry.what,
    steps: entry.steps,
    terms: Array.isArray(entry.terms) ? entry.terms : [],
  });
}

// UTF-16 の長さが max 以下になるよう、サロゲートペアを分断せずに切る
function truncateUnits(text, max) {
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/**
 * hook 向けの systemMessage（FR-HOOK-001）。hook_steps を使い、上限を超えるときは用語を省き、
 * それでも超えるときは本文を切って締めの1行（説明ID）を残す（NFR-PERF-003）
 * @param {object} entry hook: true のエントリ
 * @returns {string}
 */
function formatHookMessage(entry) {
  const body = [`${HEADINGS.WHAT}${entry.what}`, HEADINGS.STEPS, ...numbered(entry.hook_steps || [])].join('\n');
  const closing = closingLine(entry.id);
  const full = [body, ...termsLine(entry.terms), closing].join('\n');
  if (full.length <= LIMITS.SYSTEM_MESSAGE_MAX) return full;
  const room = LIMITS.SYSTEM_MESSAGE_MAX - closing.length - 1;
  return `${truncateUnits(body, room)}\n${closing}`;
}

/**
 * Claude 向けの1行メモ（FR-HOOK-005・200字以内）
 * @returns {string}
 */
function formatAdditionalContext(entry) {
  return `${CONTEXT_NOTE}${entry.id}`.slice(0, LIMITS.ADDITIONAL_CONTEXT_MAX);
}

module.exports = {
  formatTerminal,
  formatJson,
  formatHookMessage,
  formatAdditionalContext,
};
