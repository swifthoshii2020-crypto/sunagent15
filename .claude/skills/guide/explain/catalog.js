/**
 * catalog.js — エラーカタログの読込・構造検証・正規表現の事前コンパイル（SDD C-02）
 *
 * 検証関数は実行時（CLI/hook/guide）とテストで共用する（FR-CAT-002・SSOT-D3-001）。
 * 入力から正規表現を組み立てない。正規表現はカタログ固定（C-SEC-103）。
 */

'use strict';

const fs = require('fs');
const {
  LIMITS, ID_PATTERN, PLATFORMS, WHAT_ENDINGS, STEP_ENDINGS, JARGON, isDenied,
} = require('./constants');

const REQUIRED = ['id', 'title', 'priority', 'match', 'what', 'steps', 'platforms', 'evidence', 'fixtures'];

const REGEXP_SPECIALS = new Set('.*+?^${}()|[]\\/'.split(''));

// g フラグを使わずに正規表現の特殊文字をエスケープする（C-BAN-102）
function escapeRegExp(s) {
  return Array.from(s, (ch) => (REGEXP_SPECIALS.has(ch) ? `\\${ch}` : ch)).join('');
}

// 一次キー・match.all の単語境界（SRS §9）。大文字小文字は区別する
function wordBoundary(key) {
  return new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(key)}(?![A-Za-z0-9_])`);
}

function isQuantifierAt(src, i) {
  const ch = src[i];
  return ch === '+' || ch === '*' || (ch === '{' && /\d/.test(src[i + 1] || ''));
}

// 文字クラス [...] の終わりの位置を返す（先頭の ] は文字として扱う）
function skipClass(src, start) {
  let i = start + 1;
  if (src[i] === '^') i += 1;
  if (src[i] === ']') i += 1;
  while (i < src.length && src[i] !== ']') {
    i += src[i] === '\\' ? 2 : 1;
  }
  return i;
}

/**
 * 量指定子を含むグループにさらに量指定子が付く（入れ子量指定子）かを判定する
 * @param {string} src 正規表現のソース
 * @returns {boolean}
 */
function findNestedQuantifier(src) {
  const stack = [];
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === '[') { i = skipClass(src, i); continue; }
    if (ch === '(') { stack.push(false); continue; }
    const top = stack.length - 1;
    if (ch === ')') {
      const inner = stack.pop() === true;
      const quantified = isQuantifierAt(src, i + 1);
      if (inner && quantified) return true;
      if (stack.length > 0) stack[stack.length - 1] = stack[stack.length - 1] || inner || quantified;
      continue;
    }
    const isQuant = isQuantifierAt(src, i) || (ch === '?' && src[i - 1] !== '(');
    if (isQuant && top >= 0) stack[top] = true;
  }
  return false;
}

// エスケープと文字クラスを除いた `.*` の出現数（TC-FR-CAT-002「`.*` 複数使用なし」の検査用）
function countDotStar(src) {
  let count = 0;
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] === '\\') { i += 1; continue; }
    if (src[i] === '[') { i = skipClass(src, i); continue; }
    if (src[i] === '.' && src[i + 1] === '*') count += 1;
  }
  return count;
}

function compilePattern(src) {
  try {
    return new RegExp(src, 'i');
  } catch (_) {
    return null;
  }
}

function asStrings(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v.length > 0) : [];
}

/**
 * エントリの照合用正規表現をコンパイルする（不正なパターンは捨てて不一致扱い）
 * @param {object} entry
 * @returns {{entry: object, ids: RegExp[], patterns: RegExp[], all: RegExp[]}}
 */
function compileEntry(entry) {
  const match = (entry && entry.match) || {};
  return {
    entry,
    ids: asStrings(match.ids).map(wordBoundary),
    patterns: asStrings(match.patterns).map(compilePattern).filter(Boolean),
    all: asStrings(match.all).map(wordBoundary),
  };
}

/**
 * 一致の種類を返す（一次キー一致を優先）
 * @returns {'id'|'pattern'|null}
 */
function matchKind(compiled, text) {
  if (typeof text !== 'string' || !compiled) return null;
  if (!compiled.all.every((re) => re.test(text))) return null;
  if (compiled.ids.some((re) => re.test(text))) return 'id';
  if (compiled.patterns.some((re) => re.test(text))) return 'pattern';
  return null;
}

function entryMatches(compiled, text) {
  return matchKind(compiled, text) !== null;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === 'string' && v.length > 0);
}

function makeReporter(errors, id) {
  return (field, code, message) => errors.push({ id, field, code, message });
}

function checkStyledText(report, field, text, max, endings) {
  if (typeof text !== 'string' || text.length === 0) {
    report(field, 'E_REQUIRED', '空でない文字列が必要です');
    return;
  }
  if (text.length > max) report(field, 'E_LENGTH', `${max}字以内にしてください（${text.length}字）`);
  if (!endings.some((end) => text.endsWith(end))) report(field, 'E_STYLE', `「${endings.join('」「')}」のいずれかで終えてください`);
}

function checkStepList(report, field, steps, countCode) {
  if (!Array.isArray(steps) || steps.length < LIMITS.STEPS_MIN || steps.length > LIMITS.STEPS_MAX) {
    report(field, countCode, `${LIMITS.STEPS_MIN}〜${LIMITS.STEPS_MAX}件にしてください`);
    return;
  }
  steps.forEach((step, i) => checkStyledText(report, `${field}[${i}]`, step, LIMITS.STEP_MAX, STEP_ENDINGS));
}

function checkHeader(entry, report, seen) {
  if (typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id)) report('id', 'E_ID_FORMAT', 'ID は大文字とハイフンの形式にしてください');
  else if (seen.has(entry.id)) report('id', 'E_ID_DUP', 'ID が重複しています');
  else seen.add(entry.id);
  if (entry.title !== undefined && entry.title !== null && (typeof entry.title !== 'string' || entry.title.length === 0)) {
    report('title', 'E_FORMAT', 'title は空でない文字列にしてください');
  } else if (typeof entry.title === 'string' && entry.title.length > LIMITS.TITLE_MAX) {
    report('title', 'E_LENGTH', `${LIMITS.TITLE_MAX}字以内にしてください`);
  }
  const p = entry.priority;
  if (p !== undefined && (!Number.isInteger(p) || p < LIMITS.PRIORITY_MIN || p > LIMITS.PRIORITY_MAX)) {
    report('priority', 'E_PRIORITY', `${LIMITS.PRIORITY_MIN}〜${LIMITS.PRIORITY_MAX}の整数にしてください`);
  }
}

function checkPatternSource(report, src) {
  if (compilePattern(src) === null) report('match.patterns', 'E_REGEX_INVALID', `正規表現として不正です: ${src}`);
  if (findNestedQuantifier(src)) report('match.patterns', 'E_REGEX_NESTED', `入れ子の量指定子は使えません: ${src}`);
  if (countDotStar(src) > 1) report('match.patterns', 'E_REGEX_DOTSTAR', `.* は1回までにしてください: ${src}`);
}

function checkMatch(entry, report) {
  const match = entry.match;
  if (match === undefined || match === null) return;
  if (!isPlainObject(match)) {
    report('match', 'E_FORMAT', 'match はオブジェクトにしてください');
    return;
  }
  const lists = ['ids', 'patterns', 'all'].filter((k) => match[k] !== undefined);
  if (lists.some((k) => !isStringArray(match[k]))) {
    report('match', 'E_MATCH_TYPE', 'ids / patterns / all は空でない文字列の配列にしてください');
    return;
  }
  if (asStrings(match.ids).length + asStrings(match.patterns).length === 0) {
    report('match', 'E_MATCH_EMPTY', 'ids と patterns の合計を1件以上にしてください');
  }
  asStrings(match.patterns).forEach((src) => checkPatternSource(report, src));
}

function checkTerms(entry, report) {
  if (entry.terms === undefined) return;
  if (!Array.isArray(entry.terms) || entry.terms.length > LIMITS.TERMS_MAX) {
    report('terms', 'E_TERMS_COUNT', `0〜${LIMITS.TERMS_MAX}件にしてください`);
    return;
  }
  const body = [entry.what, ...(Array.isArray(entry.steps) ? entry.steps : [])].join('\n');
  entry.terms.forEach((t, i) => {
    const ok = t && typeof t.term === 'string' && t.term.length > 0 && typeof t.desc === 'string';
    if (!ok) { report(`terms[${i}]`, 'E_REQUIRED', 'term と desc が必要です'); return; }
    if (t.desc.length > LIMITS.TERM_DESC_MAX) report(`terms[${i}]`, 'E_LENGTH', `desc は${LIMITS.TERM_DESC_MAX}字以内にしてください`);
    if (!body.includes(t.term)) report(`terms[${i}]`, 'E_TERM_ABSENT', `「${t.term}」が what/steps に出てきません`);
  });
}

function checkJargon(entry, report) {
  const body = [entry.what, ...(Array.isArray(entry.steps) ? entry.steps : [])].filter((s) => typeof s === 'string').join('\n');
  const explained = new Set((Array.isArray(entry.terms) ? entry.terms : []).map((t) => t && t.term));
  JARGON.filter((word) => body.includes(word) && !explained.has(word))
    .forEach((word) => report('terms', 'E_JARGON', `専門用語「${word}」の説明を terms に入れてください`));
}

function checkHookAndCommand(entry, report) {
  if (entry.command !== undefined && (typeof entry.command !== 'string' || /[\r\n]/.test(entry.command))) {
    report('command', 'E_COMMAND', 'command は改行を含まない1行の文字列にしてください');
  }
  if (entry.hook !== undefined && typeof entry.hook !== 'boolean') report('hook', 'E_HOOK', 'hook は true/false にしてください');
  if (entry.hook === true) checkStepList(report, 'hook_steps', entry.hook_steps, 'E_HOOK_STEPS');
}

function checkMeta(entry, report) {
  const platforms = entry.platforms;
  if (platforms !== undefined && (!Array.isArray(platforms) || platforms.length === 0 || platforms.some((p) => !PLATFORMS.includes(p)))) {
    report('platforms', 'E_PLATFORMS', `${PLATFORMS.join(' / ')} から1件以上にしてください`);
  }
  const ev = entry.evidence;
  if (ev !== undefined && ev !== null && (!isStringArray(ev) || ev.length === 0)) report('evidence', 'E_EVIDENCE', 'EV-ID（文字列）を1件以上入れてください');
}

function checkFixtures(entry, report) {
  const fx = entry.fixtures;
  if (fx === undefined || fx === null) return;
  if (!isPlainObject(fx)) {
    report('fixtures', 'E_FORMAT', 'fixtures はオブジェクトにしてください');
    return;
  }
  const positive = asStrings(fx.positive);
  const negative = asStrings(fx.negative);
  if (!isStringArray(fx.positive) || !isStringArray(fx.negative) || positive.length === 0 || negative.length === 0) {
    report('fixtures', 'E_FIXTURES', 'positive と negative を空でない文字列の配列で1件以上ずつ入れてください');
  }
  const compiled = compileEntry(entry);
  positive.filter((text) => !entryMatches(compiled, text))
    .forEach((text) => report('fixtures.positive', 'E_FIXTURE_POS', `自エントリに一致しません: ${text.slice(0, 40)}`));
  negative.filter((text) => entryMatches(compiled, text))
    .forEach((text) => report('fixtures.negative', 'E_FIXTURE_NEG', `自エントリに一致してしまいます: ${text.slice(0, 40)}`));
}

function checkDeny(entry, report) {
  const fields = [
    ['what', [entry.what]],
    ['steps', entry.steps],
    ['hook_steps', entry.hook_steps],
    ['command', [entry.command]],
    ['terms', (Array.isArray(entry.terms) ? entry.terms : []).flatMap((t) => (t ? [t.term, t.desc] : []))],
  ];
  for (const [field, values] of fields) {
    if (Array.isArray(values) && values.some(isDenied)) report(field, 'E_DENY', '危険な操作の表現が含まれています（SEC-003）');
  }
}

function validateEntry(entry, errors, seen) {
  const report = makeReporter(errors, entry && typeof entry.id === 'string' ? entry.id : null);
  if (!entry || typeof entry !== 'object') {
    report('entry', 'E_FORMAT', 'エントリはオブジェクトにしてください');
    return;
  }
  REQUIRED.filter((f) => entry[f] === undefined || entry[f] === null).forEach((f) => report(f, 'E_REQUIRED', `${f} が必要です`));
  checkHeader(entry, report, seen);
  checkMatch(entry, report);
  if (entry.what !== undefined) checkStyledText(report, 'what', entry.what, LIMITS.WHAT_MAX, WHAT_ENDINGS);
  if (entry.steps !== undefined) checkStepList(report, 'steps', entry.steps, 'E_STEPS_COUNT');
  checkHookAndCommand(entry, report);
  checkTerms(entry, report);
  checkJargon(entry, report);
  checkMeta(entry, report);
  checkFixtures(entry, report);
  checkDeny(entry, report);
}

/**
 * カタログ全体を検証する
 * @param {{entries: object[]}} data
 * @returns {{id: string|null, field: string, code: string, message: string}[]}
 */
function validateCatalog(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.entries)) {
    return [{ id: null, field: 'entries', code: 'E_FORMAT', message: '{"entries": [...]} の形にしてください' }];
  }
  const errors = [];
  const seen = new Set();
  data.entries.forEach((entry) => validateEntry(entry, errors, seen));
  return errors;
}

/**
 * カタログファイルを読み、検証済み・コンパイル済みのエントリを返す。
 * 失敗時は entries を空にしてエラーを返す（fail-open かテスト失敗かは呼び出し側が選ぶ）
 * @param {string} filePath
 */
function loadCatalog(filePath) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return { entries: [], errors: [{ id: null, field: 'file', code: 'E_LOAD', message: e.message }] };
  }
  const errors = validateCatalog(data);
  if (errors.length > 0) return { entries: [], errors };
  return { entries: data.entries.map(compileEntry), errors: [] };
}

module.exports = {
  validateCatalog,
  loadCatalog,
  compileEntry,
  entryMatches,
  matchKind,
  findNestedQuantifier,
  countDotStar,
};
