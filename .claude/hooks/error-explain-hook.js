#!/usr/bin/env node
/**
 * error-explain-hook.js — Bash/PowerShell の失敗時に、やさしい日本語の説明を利用者に表示する
 * （PostToolUseFailure・SDD C-07・SRS FR-HOOK-001〜005）
 *
 * 既定は何もしない。有効化は `hint on`（利用者ホームの設定）か環境変数 TAISUN_ERROR_EXPLAIN=1。
 * 出力は systemMessage（利用者向け）が基本で、Claude 向けの1行メモは設定したときだけ。
 *
 * 安全設計: どこで失敗しても無出力・exit 0（fail-open）。入力は評価・実行しない。
 * エラー原文は表示も保存もしない（連発抑止の状態ファイルには説明IDだけを書く）。
 */

'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const EXPLAIN_DIR = path.join(__dirname, '..', 'skills', 'guide', 'explain');
const { LIMITS, isExplainEnabled, readConfig } = require(path.join(EXPLAIN_DIR, 'constants'));
const { loadCatalog } = require(path.join(EXPLAIN_DIR, 'catalog'));
const { matchError } = require(path.join(EXPLAIN_DIR, 'matcher'));
const { formatHookMessage, formatAdditionalContext } = require(path.join(EXPLAIN_DIR, 'format'));
const { readStdinLimited } = require(path.join(EXPLAIN_DIR, 'cli'));

const TOOLS = new Set(['Bash', 'PowerShell']);
const STATE_DIR = 'taisun-explain';
const SILENT = Object.freeze({ exitCode: 0, stdout: '' });

function parseEvent(buf) {
  try {
    const data = JSON.parse(buf.toString('utf8'));
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch (_) {
    return null;
  }
}

function sessionKey(sessionId) {
  if (typeof sessionId !== 'string') return '';
  return Array.from(sessionId).filter((ch) => /[A-Za-z0-9]/.test(ch)).join('').slice(0, 64);
}

/**
 * 同じ session で同じ説明を表示済みなら true。状態を読めない・書けないときは false（表示側に倒す）
 * @param {string} sessionId
 * @param {string} id 説明ID
 * @param {string} tmpDir OS の一時ディレクトリ
 */
function alreadyShown(sessionId, id, tmpDir) {
  const key = sessionKey(sessionId);
  if (key === '') return false;
  const dir = path.join(tmpDir, STATE_DIR);
  const file = path.join(dir, `${key}.json`);
  let shown = [];
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    const fresh = Date.now() - Number(state.updatedAt) <= LIMITS.DEDUP_TTL_MS;
    if (fresh && Array.isArray(state.shown)) shown = state.shown;
  } catch (_) {
    shown = [];
  }
  if (shown.includes(id)) return true;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ updatedAt: Date.now(), shown: [...shown, id] }));
    fs.renameSync(tmp, file);
  } catch (_) {
    // 書けなくても表示する（FR-HOOK-004 例外）
  }
  return false;
}

function buildOutput(entry, homeDir) {
  const out = { systemMessage: formatHookMessage(entry) };
  if (readConfig(homeDir).additionalContext) {
    out.hookSpecificOutput = { hookEventName: 'PostToolUseFailure', additionalContext: formatAdditionalContext(entry) };
  }
  return { exitCode: 0, stdout: JSON.stringify(out) };
}

async function handle(opts) {
  const timeoutMs = opts.stdinTimeoutMs || LIMITS.STDIN_TIMEOUT_MS;
  const event = parseEvent(await readStdinLimited(opts.stdin, { maxBytes: LIMITS.STDIN_MAX_BYTES, timeoutMs }));
  if (!event || !isExplainEnabled({ env: opts.env, homeDir: opts.homeDir })) return SILENT;
  if (!TOOLS.has(event.tool_name) || event.is_interrupt === true || typeof event.error !== 'string') return SILENT;
  const catalog = loadCatalog(opts.catalogPath || path.join(EXPLAIN_DIR, 'error-catalog.json'));
  const result = matchError(catalog.entries, event.error);
  if (!result.matched || result.entry.hook !== true) return SILENT;
  if (alreadyShown(event.session_id, result.entry.id, opts.tmpDir)) return SILENT;
  return buildOutput(result.entry, opts.homeDir);
}

/**
 * hook 本体（テストからは in-process で呼ぶ・SDD §1 テスト容易性）
 * @param {{stdin: object, env?: object, homeDir?: string, tmpDir?: string, catalogPath?: string, stdinTimeoutMs?: number}} options
 * @returns {Promise<{exitCode: 0, stdout: string}>}
 */
async function run(options) {
  const opts = Object.assign({ env: {} }, options);
  if (opts.homeDir === undefined) opts.homeDir = os.homedir();
  if (opts.tmpDir === undefined) opts.tmpDir = os.tmpdir();
  try {
    return await handle(opts);
  } catch (_) {
    return SILENT;
  }
}

module.exports = { run };

if (require.main === module) {
  // 書き込み先が先に閉じても（EPIPE）例外にしない（fail-open）
  process.stdout.on('error', () => {});
  run({ stdin: process.stdin, env: process.env })
    .then((r) => { if (r.stdout) process.stdout.write(r.stdout); })
    .catch(() => {})
    .finally(() => {
      process.exitCode = 0;
      process.stdin.destroy();
    });
}
