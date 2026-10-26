'use strict';

// 本ブランチの分岐元（main との merge-base）を返す。テスト専用ヘルパ（*.test.js ではないので収集されない）。
// 分岐元との差分で「この変更だけを入れた」ことを確かめるテストは、次のときは null を返して skip させる:
//   - 浅い履歴（CI の checkout 等）で main や merge-base が取れない
//   - merge-base が HEAD と同じ（main にマージ済みで、比べる差分が無い）
const { execFileSync } = require('child_process');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function branchBase(root) {
  for (const ref of ['main', 'origin/main']) {
    try {
      const base = git(root, ['merge-base', 'HEAD', ref]);
      return base === git(root, ['rev-parse', 'HEAD']) ? null : base;
    } catch {
      // 次の候補を試す
    }
  }
  return null;
}

function showAt(root, base, rel) {
  return git(root, ['show', `${base}:${rel}`]);
}

function changedLines(root, base, rel) {
  const diff = execFileSync('git', ['diff', '--unified=0', base, '--', rel], { cwd: root, encoding: 'utf8' });
  const lines = diff.split('\n').filter((l) => !l.startsWith('+++') && !l.startsWith('---'));
  return {
    added: lines.filter((l) => l.startsWith('+')).map((l) => l.slice(1)),
    removed: lines.filter((l) => l.startsWith('-')).map((l) => l.slice(1)),
  };
}

module.exports = { branchBase, showAt, changedLines };
