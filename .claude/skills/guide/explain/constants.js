/**
 * constants.js — /guide とエラー説明エンジンの上限値・禁止表現・専門用語の唯一の定義
 *
 * 正本: docs/SRS.md §9（上限値）・§11 SEC-003（禁止表現）、SDD C-05。
 * ここ以外に上限値や禁止表現を書かない（SSOT-DSN-001）。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LIMITS = Object.freeze({
  TITLE_MAX: 40,
  WHAT_MAX: 80,
  STEP_MAX: 80,
  STEPS_MIN: 1,
  STEPS_MAX: 3,
  TERMS_MAX: 3,
  TERM_DESC_MAX: 40,
  PRIORITY_MIN: 1,
  PRIORITY_MAX: 100,
  SYSTEM_MESSAGE_MAX: 600,
  ADDITIONAL_CONTEXT_MAX: 200,
  GUIDE_OUTPUT_MAX: 1200,
  GUIDE_QUERY_MAX: 500,
  INPUT_MAX: 20000,
  HEAD_TAIL: 10000,
  STDIN_MAX_BYTES: 1024 * 1024,
  STDIN_TIMEOUT_MS: 2000,
  INBOX_ID_MAX: 80,
  DEDUP_TTL_MS: 24 * 60 * 60 * 1000,
  INBOX_TTL_MS: 60 * 60 * 1000,
});

const ID_PATTERN = /^[A-Z]+(-[A-Z0-9]+)+$/;

const PLATFORMS = Object.freeze(['win', 'mac', 'linux']);

// 文体の機械判定（SRS §9）
const WHAT_ENDINGS = Object.freeze(['です。', 'ます。']);
const STEP_ENDINGS = Object.freeze(['ください。', 'ます。', 'です。']);

// SEC-003 の禁止表現。全て i フラグ付き・g フラグなし（lastIndex 問題回避・C-BAN-102）
const DENYLIST = Object.freeze([
  // 設定の緩め過ぎ
  /\bUnrestricted\b/i,
  /\bBypass\b/i,
  /strict-ssl\s*(=\s*)?false/i,
  /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*0/i,
  // 削除・強制
  /\brm\s+-\w*[rf]/i,
  /\bdel\s+\/s\b/i,
  /Remove-Item\b[^\n]*-Recurse/i,
  /push\s+(-f|--force)\b/i,
  // 管理者権限・レジストリ
  /\bsudo\b/i,
  /管理者として実行/i,
  /\bHKLM\b/i,
  /\bregedit\b/i,
  /New-ItemProperty/i,
  /\breg\s+add\b/i,
  // セキュリティソフトの無効化・除外
  /Set-MpPreference/i,
  /Add-MpPreference/i,
  /Defender\s*を無効/i,
  /ウイルス対策を切る/i,
  // 権限の全開放
  /icacls\b[^\n]*Everyone/i,
  /\btakeown\b/i,
  /chmod\s+(-R\s+)?777/i,
  // 範囲の広い設定変更
  /-Scope\s+LocalMachine/i,
  // リモートスクリプトの実行
  /\biex\b/i,
  /Invoke-Expression/i,
  /\|\s*sh\b/i,
  /\|\s*bash\b/i,
  // 取り返しのつかない git / 削除
  /git\s+reset\s+--hard/i,
  /git\s+clean\s+-\w*f/i,
  /\brd\s+\/s\b/i,
  /\brmdir\s+\/s\b/i,
]);

// 過剰検知の正当な例外（C-SEC-007: 見逃しゼロ優先のうえで明示的に許可する表現）
const DENY_ALLOWLIST = Object.freeze([
  /npm(\.cmd)?\s+cache\s+clean\s+--force/i,
]);

// what/steps に出たら terms で説明が必要な専門用語（SDD C-05・REV-R1-T021）
const JARGON = Object.freeze([
  'PATH', '環境変数', '実行ポリシー', 'モジュール', '権限', 'プロキシ',
  '証明書', 'リポジトリ', '依存関係', 'ポート', '改行コード', 'キャッシュ',
]);

/**
 * 許可リストの表現を取り除いたうえで、禁止表現を含むかを判定する
 * @param {string} text
 * @returns {boolean}
 */
function isDenied(text) {
  if (typeof text !== 'string') return false;
  let rest = text;
  for (const allow of DENY_ALLOWLIST) {
    rest = rest.split(allow).join(' ');
  }
  return DENYLIST.some((re) => re.test(rest));
}

// ---- 利用者ごとの設定（C-12・FR-CFG-001/002）。読込/書込はここに集約する（SSOT-DSN-004）----

const ENV_FLAG = 'TAISUN_ERROR_EXPLAIN';

/**
 * 設定ファイルのパス（<ホーム>/.claude/taisun/error-explain.json・リポジトリ外）
 * @param {string} homeDir
 * @returns {string}
 */
function configPath(homeDir) {
  return path.join(homeDir, '.claude', 'taisun', 'error-explain.json');
}

function readRawConfig(homeDir) {
  if (typeof homeDir !== 'string' || homeDir.length === 0) return null;
  try {
    const data = JSON.parse(fs.readFileSync(configPath(homeDir), 'utf8'));
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch (_) {
    return null;
  }
}

/**
 * 設定を読む。無い・壊れている場合は既定値（どちらも false）
 * @param {string} homeDir
 * @returns {{enabled: boolean, additionalContext: boolean}}
 */
function readConfig(homeDir) {
  const raw = readRawConfig(homeDir) || {};
  return {
    enabled: raw.enabled === true,
    additionalContext: raw.additionalContext === true,
  };
}

/**
 * hook を有効にするか（環境変数 1/0 > 設定ファイルの enabled > off）
 * @param {{env: object, homeDir: string}} opts
 * @returns {boolean}
 */
function isExplainEnabled({ env, homeDir }) {
  const flag = env ? env[ENV_FLAG] : undefined;
  if (flag === '1') return true;
  if (flag === '0') return false;
  return readConfig(homeDir).enabled;
}

/**
 * 設定を更新する。既存の他キーは残し、フォルダは作り、一時ファイルから置き換える。
 * 失敗時は例外を投げる（呼び出し側が exit 3 にする）
 * @param {string} homeDir
 * @param {object} patch
 */
function writeConfig(homeDir, patch) {
  if (typeof homeDir !== 'string' || homeDir.length === 0) {
    throw Object.assign(new Error('home directory is unknown'), { code: 'ENOHOME' });
  }
  const file = configPath(homeDir);
  const next = Object.assign({}, readRawConfig(homeDir) || {}, patch);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

module.exports = {
  configPath,
  readConfig,
  isExplainEnabled,
  writeConfig,
  LIMITS,
  ID_PATTERN,
  PLATFORMS,
  WHAT_ENDINGS,
  STEP_ENDINGS,
  DENYLIST,
  DENY_ALLOWLIST,
  JARGON,
  isDenied,
};
