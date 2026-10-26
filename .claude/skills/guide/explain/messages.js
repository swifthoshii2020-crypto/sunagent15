/**
 * messages.js — 利用者向け固定文言の唯一の定義（SDD C-05・SSOT-D3-002）
 */

'use strict';

const HEADINGS = Object.freeze({
  WHAT: '【何が起きた】',
  STEPS: '【次にやること】',
  COMMAND: '【コピー用】',
  TERMS: '【用語】',
});

// FR-EXPL-003: 一致なし
const NOT_FOUND = 'このエラーは説明集にまだ載っていません。';
const NOT_FOUND_STEPS = Object.freeze([
  'エラーの全文を Claude に貼り付けて「やさしく説明して」と頼んでください。',
  '画面の写真ではなく、エラーの文字をコピーして貼り付けてください。',
]);

/**
 * FR-EXPL-001: 固定の締め1行
 * @param {string} id 説明ID
 * @returns {string}
 */
function closingLine(id) {
  return `（説明ID: ${id}）違うときは、この説明IDを添えて Claude に相談してください。`;
}

// FR-HOOK-005: Claude 向けの1行メモ（利用者には表示されない）
const CONTEXT_NOTE = '（TAISUN error-explain）利用者にはこのエラーの説明を表示済みです。説明ID: ';

// cli.js（FR-EXPL-004/006, FR-CFG-002）
const CLI = Object.freeze({
  USAGE: [
    '使い方:',
    '  node cli.js explain "<エラー文>" [--json]',
    '  node cli.js explain --file <ファイル> [--json]',
    '  <命令> | node cli.js explain [--json]',
    '  node cli.js explain --id <説明ID>',
    '  node cli.js guide "<やりたいこと>"',
    '  node cli.js hint on|off',
  ].join('\n'),
  ID_NOT_FOUND: 'その番号の説明はありません。',
  CATALOG_BROKEN: 'エラー説明集を読み込めませんでした（メンテナ向け）: ',
});

/**
 * hint on/off の結果（有効範囲と逆操作のコマンドを含む）
 * @param {boolean} on
 * @param {string} cliPath cli.js の絶対パス
 */
function hintResult(on, cliPath) {
  const other = `node "${cliPath}" hint ${on ? 'off' : 'on'}`;
  return on
    ? `エラー時のヒントをオンにしました。効くのは TAISUN 本体と setup-project 済みのフォルダです（オフ: ${other}）`
    : `エラー時のヒントをオフにしました（オン: ${other}）`;
}

function hintFailed(code) {
  return `設定を保存できませんでした（${code || '理由不明'}）。書き込みできる場所か確かめてください。`;
}

// guide.js（FR-GUIDE-001〜004, FR-CFG-002）
const GUIDE = Object.freeze({
  RECOMMEND_HEAD: 'おすすめ（例の1行をコピーして貼り付けると始められます）:',
  MENU_HEAD: 'やりたいことを1つ選んで、例のように /guide に続けて入力してください。',
  NO_MATCH: 'ぴったりの候補が見つかりませんでした。',
  NOT_INSTALLED: '（未導入）',
  CATALOG_BROKEN: '案内データを読めませんでした。',
  INPUT_UNREADABLE: '入力を読めませんでした。もう一度 /guide を実行してください。',
});

/**
 * 未導入スキルの導入方法（OS で出し分け・REV-R3-008）
 * @param {string} platform process.platform
 */
function installHint(platform) {
  const flag = platform === 'win32' ? '-Profile full' : '--profile full';
  return `TAISUN をフル構成で入れ直すと使えます（${flag} を付けてインストール）`;
}

/**
 * /guide ヒント の案内（実行時に求めた cli.js の絶対パス入り・REV-R2-014）
 * @param {string} cliPath
 */
function hintGuide(cliPath) {
  return [
    'エラーが起きたときに自動で説明を出す機能（ヒント）は、次の1行で切り替えます。',
    '命令を打つ画面に貼り付けて Enter を押してください。',
    `オンにする: node "${cliPath}" hint on`,
    `オフにする: node "${cliPath}" hint off`,
    '効くのは TAISUN 本体と setup-project 済みのフォルダです。',
  ].join('\n');
}

module.exports = {
  HEADINGS,
  NOT_FOUND,
  NOT_FOUND_STEPS,
  closingLine,
  CONTEXT_NOTE,
  CLI,
  hintResult,
  hintFailed,
  GUIDE,
  installHint,
  hintGuide,
};
