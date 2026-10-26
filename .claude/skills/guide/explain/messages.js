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

module.exports = {
  HEADINGS,
  NOT_FOUND,
  NOT_FOUND_STEPS,
  closingLine,
};
