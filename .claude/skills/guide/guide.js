#!/usr/bin/env node
/**
 * guide.js — /guide の本体（SDD C-09・I/F は SDD §5）
 *
 *   node guide.js [--menu]          分野メニュー
 *   node guide.js "<文>"            エラー説明 → ヒント案内 → 未収録案内 → スキル推薦 の順に判定
 *   node guide.js --file <パス>     代替方式（SRS §12.2）。.taisun-inbox の guide-*.txt は読込直後に削除
 *
 * エラー説明エンジンも同じスキル内の explain/ を使い、スキルディレクトリ内で完結する（ADR-003）。
 * 入力は評価・実行しない。存在確認は fs だけで行う（SEC-004）。
 */

'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { LIMITS } = require('./explain/constants');
const { loadCatalog } = require('./explain/catalog');
const { matchError } = require('./explain/matcher');
const { formatTerminal } = require('./explain/format');
const { decodeBuffer, readFileLimited } = require('./explain/cli');
const {
  GUIDE, installHint, hintGuide,
} = require('./explain/messages');

const ERROR_CATALOG_PATH = path.join(__dirname, 'explain', 'error-catalog.json');
const GUIDE_CATALOG_PATH = path.join(__dirname, 'guide-catalog.json');
const CLI_PATH = path.join(__dirname, 'explain', 'cli.js');
const INBOX_NAME = '.taisun-inbox';
const INBOX_FILE = /^guide-[A-Za-z0-9_-]{1,80}\.txt$/;
const HINT_WORD = 'ヒント';
const ERROR_WORDS = ['error', 'err!', 'exception', 'exit code', 'エラー', '失敗しました'];
const UPPER_ID = /(?<![A-Za-z0-9_])[A-Z][A-Z0-9_]{2,}(?![A-Za-z0-9_])/;
const MAX_RESULTS = 3;

function result(exitCode, stdout) {
  return { exitCode, stdout, stderr: '' };
}

/**
 * 「エラーらしさ」（SRS FR-GUIDE-006 例外節）
 * @param {string} text
 * @returns {boolean}
 */
function isErrorLike(text) {
  const lower = text.toLowerCase();
  if (!ERROR_WORDS.some((w) => lower.includes(w))) return false;
  return text.includes('\n') || UPPER_ID.test(text) || text.includes('Error:') || text.includes('ERR!');
}

function normalizeQuery(text) {
  return text.slice(0, LIMITS.GUIDE_QUERY_MAX).normalize('NFKC').toLowerCase();
}

function loadGuideCatalog() {
  try {
    const data = JSON.parse(fs.readFileSync(GUIDE_CATALOG_PATH, 'utf8'));
    return Array.isArray(data.entries) && Array.isArray(data.categories) ? data : null;
  } catch (_) {
    return null;
  }
}

function menuLines(catalog) {
  return [GUIDE.MENU_HEAD, ...catalog.categories.map((c) => `・${c.label}（例: ${c.example}）`)];
}

function isInstalled(name, ctx) {
  const file = (base) => path.join(base, '.claude', 'skills', name, 'SKILL.md');
  return fs.existsSync(file(ctx.homeDir)) || fs.existsSync(file(ctx.projectDir));
}

function recommendLines(picked, ctx) {
  const lines = [GUIDE.RECOMMEND_HEAD];
  picked.forEach((e, i) => {
    // ホームが分からないときは未導入の判定をしない（FR-GUIDE-004 例外）
    const missing = e.kind === 'skill' && ctx.homeDir && !isInstalled(e.name, ctx);
    lines.push(`${i + 1}. /${e.name} — ${e.summary}${missing ? GUIDE.NOT_INSTALLED : ''}`, `   例: ${e.example}`);
    if (missing) lines.push(`   ${installHint(ctx.platform)}`);
  });
  return lines;
}

const ASCII_WORD = /^[a-z0-9_]+$/;
const ASCII_WORD_CHAR = /[a-z0-9_]/;

// 英字だけのキーワードは単語の区切りで照合する（「help」の中の「lp」に当たらないように）。
// 日本語は単語の区切りが無いので部分一致
function hasKeyword(query, keyword) {
  const kw = keyword.normalize('NFKC').toLowerCase();
  if (!ASCII_WORD.test(kw)) return query.includes(kw);
  for (let i = query.indexOf(kw); i !== -1; i = query.indexOf(kw, i + 1)) {
    const before = query[i - 1] || '';
    const after = query[i + kw.length] || '';
    if (!ASCII_WORD_CHAR.test(before) && !ASCII_WORD_CHAR.test(after)) return true;
  }
  return false;
}

function recommend(text, catalog, ctx) {
  const query = normalizeQuery(text);
  const scored = catalog.entries
    .map((e, order) => ({ e, order, score: e.keywords.filter((k) => hasKeyword(query, k)).length }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, MAX_RESULTS);
  if (scored.length === 0) return [GUIDE.NO_MATCH, ...menuLines(catalog)];
  return recommendLines(scored.map((s) => s.e), ctx);
}

// 判定順: エラー説明 → ヒント案内 → 未収録案内 → スキル推薦（SDD §2.1・REV-R3-007）
function respond(text, ctx) {
  const catalog = loadGuideCatalog();
  if (text.trim() === '') return catalog ? menuLines(catalog).join('\n') : GUIDE.CATALOG_BROKEN;
  const explained = matchError(loadCatalog(ERROR_CATALOG_PATH).entries, text);
  if (explained.matched) return formatTerminal(explained);
  if (text.includes(HINT_WORD)) return hintGuide(CLI_PATH);
  if (isErrorLike(text)) return formatTerminal({ matched: false });
  if (!catalog) return GUIDE.CATALOG_BROKEN;
  return recommend(text, catalog, ctx).join('\n');
}

// UTF-16 の長さが max 以下になるよう、サロゲートペアを分断せずに切る（NFR-PERF-003）
function truncateUnits(text, max) {
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

/**
 * 代替方式の一時ファイルなら実体パスを返す（SRS §12.2 の削除判定）。対象外なら null
 * @param {string} file --file に渡されたパス
 * @param {string} platform
 */
function inboxFileToDelete(file, platform) {
  const real = fs.realpathSync(file);
  const dirName = path.basename(path.dirname(real));
  const sameDir = platform === 'win32' ? dirName.toLowerCase() === INBOX_NAME : dirName === INBOX_NAME;
  if (!sameDir || !INBOX_FILE.test(path.basename(real))) return null;
  return fs.lstatSync(real).isFile() ? real : null;
}

// 1時間以上前の guide-*.txt と、空になったフォルダを消す。失敗は無視する（出力に影響させない）
function cleanupInbox(dirs) {
  for (const dir of new Set(dirs.filter(Boolean))) {
    try {
      // リンクのフォルダはたどらない（リンク先のファイルを消さないため）
      const self = fs.lstatSync(dir);
      if (!self.isDirectory() || self.isSymbolicLink()) continue;
      for (const name of fs.readdirSync(dir).filter((n) => INBOX_FILE.test(n))) {
        const file = path.join(dir, name);
        const st = fs.lstatSync(file);
        if (st.isFile() && Date.now() - st.mtimeMs >= LIMITS.INBOX_TTL_MS) fs.rmSync(file, { force: true });
      }
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch (_) {
      // 掃除の失敗は無視する（SRS §12.2）
    }
  }
}

function readInboxInput(file, ctx) {
  const text = decodeBuffer(readFileLimited(file));
  let parent = null;
  try {
    const target = inboxFileToDelete(file, ctx.platform);
    if (target) {
      fs.rmSync(target, { force: true });
      parent = path.dirname(target);
    }
  } catch (_) {
    // 削除できなくても読んだ内容で続ける（残りは次回起動時の掃除で消える）
  }
  return { text, parent };
}

function context(opts) {
  const env = opts.env || {};
  const projectDir = opts.projectDir || env.CLAUDE_PROJECT_DIR || process.cwd();
  return {
    homeDir: opts.homeDir !== undefined ? opts.homeDir : os.homedir(),
    projectDir,
    inboxDir: opts.inboxDir || path.join(projectDir, INBOX_NAME),
    platform: opts.platform || process.platform,
  };
}

/**
 * /guide 本体（テストからは in-process で呼ぶ・SDD §1 テスト容易性）
 * @param {{argv: string[], env?: object, homeDir?: string, projectDir?: string, inboxDir?: string, platform?: string}} opts
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>}
 */
async function run(opts) {
  const ctx = context(opts || {});
  const argv = Array.isArray(opts && opts.argv) ? opts.argv : [];
  let text = argv[0] === '--menu' ? '' : argv.join(' ');
  let parent = null;
  if (argv[0] === '--file') {
    try {
      ({ text, parent } = readInboxInput(argv[1], ctx));
    } catch (_) {
      cleanupInbox([ctx.inboxDir]);
      return result(2, `${GUIDE.INPUT_UNREADABLE}\n`);
    }
  }
  cleanupInbox([ctx.inboxDir, parent]);
  return result(0, `${truncateUnits(respond(text, ctx), LIMITS.GUIDE_OUTPUT_MAX)}\n`);
}

// 直接起動より前に export する（cli.js と guide.js が互いを require するため）
module.exports = {
  run,
  isErrorLike,
};

if (require.main === module) {
  run({ argv: process.argv.slice(2), env: process.env }).then((r) => {
    process.stdout.write(r.stdout);
    process.exitCode = r.exitCode;
  });
}
