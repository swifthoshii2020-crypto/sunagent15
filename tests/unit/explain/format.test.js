'use strict';

// T-004: FR-EXPL-001（整形）/ FR-EXPL-005 / NFR-PERF-003 / NFR-SEC-001
const path = require('path');

const EXPLAIN_DIR = path.resolve(__dirname, '..', '..', '..', '.claude', 'skills', 'guide', 'explain');
const { compileEntry } = require(path.join(EXPLAIN_DIR, 'catalog.js'));
const { matchError } = require(path.join(EXPLAIN_DIR, 'matcher.js'));
const { LIMITS } = require(path.join(EXPLAIN_DIR, 'constants.js'));
const messages = require(path.join(EXPLAIN_DIR, 'messages.js'));
const {
  formatTerminal, formatJson, formatHookMessage, formatAdditionalContext,
} = require(path.join(EXPLAIN_DIR, 'format.js'));

const ENTRY = {
  id: 'WIN-PS-POLICY',
  title: 'PowerShell の実行ポリシー',
  priority: 10,
  match: { ids: ['UnauthorizedAccess'] },
  what: 'PowerShell の安全設定で、npm が止められている可能性が高いです。',
  steps: [
    'いま使っている画面で、npm の代わりに npm.cmd と入力して同じ操作を試してください。',
    '例えば「npm run setup」なら、下のコピー用の1行をそのまま貼り付けて Enter を押します。',
  ],
  command: 'npm.cmd run setup',
  terms: [{ term: 'PowerShell', desc: '文字で命令を打つ Windows の画面' }, { term: 'npm', desc: '部品を入れる道具' }],
  hook: true,
  hook_steps: ['Claude に「npm の代わりに npm.cmd で実行して」と頼んでください。'],
  platforms: ['win'],
  evidence: ['EV-ERR-001'],
  fixtures: { positive: ['UnauthorizedAccess'], negative: ['x'] },
};

const MATCHED = { matched: true, entry: ENTRY, rank: 'id' };
const UNMATCHED = { matched: false };

describe('TC-FR-EXPL-001 端末向けの3部構成', () => {
  test('TC-FR-EXPL-001 見出し・番号付き手順・コピー用・用語・締めの1行の順で並ぶ', () => {
    expect(formatTerminal(MATCHED).split('\n')).toEqual([
      '【何が起きた】PowerShell の安全設定で、npm が止められている可能性が高いです。',
      '【次にやること】',
      '  1. いま使っている画面で、npm の代わりに npm.cmd と入力して同じ操作を試してください。',
      '  2. 例えば「npm run setup」なら、下のコピー用の1行をそのまま貼り付けて Enter を押します。',
      '【コピー用】npm.cmd run setup',
      '【用語】PowerShell＝文字で命令を打つ Windows の画面 ／ npm＝部品を入れる道具',
      messages.closingLine('WIN-PS-POLICY'),
    ]);
  });

  test('TC-FR-EXPL-001 command と terms が無ければその行を出さない', () => {
    const entry = Object.assign({}, ENTRY, { command: undefined, terms: [] });
    const out = formatTerminal({ matched: true, entry, rank: 'id' });
    expect(out).not.toContain(messages.HEADINGS.COMMAND);
    expect(out).not.toContain(messages.HEADINGS.TERMS);
    expect(out.split('\n').pop()).toBe(messages.closingLine('WIN-PS-POLICY'));
  });

  test('TC-FR-EXPL-003 不一致は定型文と次の一手2件（説明IDの締めは出さない）', () => {
    const lines = formatTerminal(UNMATCHED).split('\n');
    expect(lines[0]).toBe(`${messages.HEADINGS.WHAT}${messages.NOT_FOUND}`);
    expect(lines).toContain(`  1. ${messages.NOT_FOUND_STEPS[0]}`);
    expect(lines).toContain(`  2. ${messages.NOT_FOUND_STEPS[1]}`);
    expect(lines.join('\n')).not.toContain('説明ID');
  });
});

describe('TC-FR-EXPL-005 JSON 出力', () => {
  test('TC-FR-EXPL-005 一致時は必須キーを持つ1行の JSON', () => {
    const out = formatJson(MATCHED);
    expect(out).not.toContain('\n');
    expect(JSON.parse(out)).toEqual({
      matched: true,
      id: 'WIN-PS-POLICY',
      what: ENTRY.what,
      steps: ENTRY.steps,
      terms: ENTRY.terms,
    });
  });

  test('TC-FR-EXPL-005 不一致時は matched=false・id=null と次の一手', () => {
    expect(JSON.parse(formatJson(UNMATCHED))).toEqual({
      matched: false,
      id: null,
      what: messages.NOT_FOUND,
      steps: messages.NOT_FOUND_STEPS,
      terms: [],
    });
  });
});

describe('TC-NFR-PERF-003 hook 向け文面', () => {
  test('TC-NFR-PERF-003 systemMessage は hook_steps を使い、端末向け steps・コピー用は含めない', () => {
    const msg = formatHookMessage(ENTRY);
    expect(msg).toContain(ENTRY.what);
    expect(msg).toContain(ENTRY.hook_steps[0]);
    expect(msg).not.toContain(ENTRY.steps[0]);
    expect(msg).not.toContain(messages.HEADINGS.COMMAND);
    expect(msg).toContain(messages.closingLine('WIN-PS-POLICY'));
  });

  test('TC-NFR-PERF-003 systemMessage は600字以内（上限いっぱいのエントリでも）', () => {
    const big = Object.assign({}, ENTRY, {
      what: 'あ'.repeat(77) + 'です。',
      hook_steps: [1, 2, 3].map(() => 'い'.repeat(75) + 'ください。'),
      terms: [1, 2, 3].map((n) => ({ term: `語${'う'.repeat(30)}${n}`, desc: 'え'.repeat(40) })),
    });
    const msg = formatHookMessage(big);
    expect(msg.length).toBeLessThanOrEqual(LIMITS.SYSTEM_MESSAGE_MAX);
    expect(msg).not.toContain(messages.HEADINGS.TERMS);
    expect(msg.split('\n').pop()).toBe(messages.closingLine('WIN-PS-POLICY'));
  });

  test('TC-NFR-PERF-003 用語を省いても超えるときは本文を切り、締めの1行を残し、サロゲートペアを分断しない', () => {
    const huge = Object.assign({}, ENTRY, {
      what: '😀'.repeat(150) + 'です。',
      hook_steps: ['😀'.repeat(150) + 'ください。'],
      terms: [],
    });
    const msg = formatHookMessage(huge);
    expect(msg.length).toBeLessThanOrEqual(LIMITS.SYSTEM_MESSAGE_MAX);
    expect(msg.split('\n').pop()).toBe(messages.closingLine('WIN-PS-POLICY'));
    expect(msg).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  test('TC-NFR-PERF-003 additionalContext は200字以内の1行でエントリIDを含む', () => {
    const ctx = formatAdditionalContext(ENTRY);
    expect(ctx).toContain('WIN-PS-POLICY');
    expect(ctx).not.toContain('\n');
    expect(ctx.length).toBeLessThanOrEqual(LIMITS.ADDITIONAL_CONTEXT_MAX);
    const longId = Object.assign({}, ENTRY, { id: `X-${'A'.repeat(300)}` });
    expect(formatAdditionalContext(longId).length).toBeLessThanOrEqual(LIMITS.ADDITIONAL_CONTEXT_MAX);
  });
});

describe('NFR-SEC-001 エラー原文を再掲しない', () => {
  test('NFR-SEC-001 入力に含まれるトークンやパスがどの出力にも出ない', () => {
    const cat = [compileEntry(ENTRY)];
    const input = 'C:\\Users\\taro\\secret sk-ant-TESTDUMMY FullyQualifiedErrorId : UnauthorizedAccess';
    const result = matchError(cat, input);
    const outputs = [formatTerminal(result), formatJson(result), formatHookMessage(result.entry), formatAdditionalContext(result.entry)];
    for (const out of outputs) {
      expect(out).not.toContain('sk-ant-TESTDUMMY');
      expect(out).not.toContain('taro');
    }
    const miss = matchError(cat, 'sk-ant-TESTDUMMY unknown');
    expect(formatTerminal(miss)).not.toContain('sk-ant-TESTDUMMY');
    expect(formatJson(miss)).not.toContain('sk-ant-TESTDUMMY');
  });
});
