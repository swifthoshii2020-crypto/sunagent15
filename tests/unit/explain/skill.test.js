'use strict';

// T-007: FR-GUIDE-005 SKILL.md（手動専用・requires・allowed-tools と本文の同形）
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SKILL_MD = path.join(ROOT, '.claude', 'skills', 'guide', 'SKILL.md');

// 検査する分岐（SDD §2.6）。代替方式へ切り替えたとき（T-007b）だけ 'alternative' にする
const BRANCH = 'normal';

const source = fs.readFileSync(SKILL_MD, 'utf8');
const [, front, body] = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
const meta = yaml.load(front);
const COMMAND = 'node "${CLAUDE_SKILL_DIR}/guide.js"';

describe('TC-FR-GUIDE-005 SKILL.md', () => {
  test('TC-FR-GUIDE-005 手動専用（disable-model-invocation: true）と requires', () => {
    expect(meta.name).toBe('guide');
    expect(meta['disable-model-invocation']).toBe(true);
    expect(meta.requires).toEqual({ node: '>=18' });
  });

  test('TC-FR-GUIDE-005 allowed-tools は Bash 用と PowerShell 用の同形ルール', () => {
    const rules = meta['allowed-tools'];
    expect(rules).toEqual(expect.arrayContaining([`Bash(${COMMAND} *)`, `PowerShell(${COMMAND} *)`]));
    expect(rules.some((r) => r.startsWith('Write('))).toBe(false);
  });

  test('TC-FR-GUIDE-005 本文の実行コマンドが許可ルールと同形', () => {
    expect(body).toContain(`${COMMAND} '`);
    expect(body).toContain(`${COMMAND} --menu`);
    expect(body).toContain('$ARGUMENTS');
  });

  test('TC-FR-GUIDE-005 本文は他スキルを起動せず出力をそのまま表示するよう指示する', () => {
    expect(body).toContain('そのまま表示');
    expect(body).toContain('他のスキル');
  });

  if (BRANCH === 'normal') {
    test('TC-FR-GUIDE-005 通常分岐: Edit ルールも .taisun-inbox も無い', () => {
      expect(meta['allowed-tools'].some((r) => r.startsWith('Edit('))).toBe(false);
      expect(source).not.toContain('.taisun-inbox');
    });
  } else {
    test('TC-FR-GUIDE-005 代替分岐: Edit(./.taisun-inbox/*) がちょうど1つ', () => {
      expect(meta['allowed-tools'].filter((r) => r === 'Edit(./.taisun-inbox/*)')).toHaveLength(1);
      expect(body).toContain(`${COMMAND} --file '`);
    });
  }

  test('TC-FR-GUIDE-005 check-skill-requirements が exit 0', () => {
    expect(() => execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check-skill-requirements.js')], { cwd: ROOT, stdio: 'pipe' })).not.toThrow();
  });
});
