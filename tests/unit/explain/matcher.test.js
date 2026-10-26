'use strict';

// T-003: FR-EXPL-001（切り出し）/ FR-EXPL-002 / FR-EXPL-003 / NFR-PORT-001
const path = require('path');

const EXPLAIN_DIR = path.resolve(__dirname, '..', '..', '..', '.claude', 'skills', 'guide', 'explain');
const { compileEntry } = require(path.join(EXPLAIN_DIR, 'catalog.js'));
const { matchError, normalizeInput } = require(path.join(EXPLAIN_DIR, 'matcher.js'));

function entry(id, match, priority) {
  return { id, priority: priority === undefined ? 50 : priority, match };
}

function catalog(...entries) {
  return entries.map(compileEntry);
}

describe('TC-FR-EXPL-001 入力の正規化と長文の切り出し', () => {
  test('TC-FR-EXPL-001 20,000字以下はそのまま', () => {
    const text = 'a'.repeat(20000);
    expect(normalizeInput(text)).toBe(text);
  });

  test('TC-FR-EXPL-001 20,000字超は先頭10,000字＋改行＋末尾10,000字', () => {
    const text = 'h'.repeat(10000) + 'm'.repeat(5) + 't'.repeat(10000);
    expect(normalizeInput(text)).toBe('h'.repeat(10000) + '\n' + 't'.repeat(10000));
  });

  test('TC-FR-EXPL-001 末尾にある識別子も20,001字入力で一致する', () => {
    const cat = catalog(entry('DISK-FULL', { ids: ['ENOSPC'] }));
    const text = ' '.repeat(20001 - 'ENOSPC'.length) + 'ENOSPC';
    expect(matchError(cat, text).entry.id).toBe('DISK-FULL');
  });

  test('TC-FR-EXPL-001 境界: 20,000字ちょうど（index 9,997 から ENOSPC）は一致', () => {
    const cat = catalog(entry('DISK-FULL', { ids: ['ENOSPC'] }));
    const text = ' '.repeat(9997) + 'ENOSPC' + ' '.repeat(20000 - 9997 - 6);
    expect(text).toHaveLength(20000);
    expect(matchError(cat, text).matched).toBe(true);
  });

  test('TC-FR-EXPL-001 境界: 20,001字は切り出しで分断され不一致（連結による偽一致なし）', () => {
    const cat = catalog(entry('DISK-FULL', { ids: ['ENOSPC'] }));
    const text = ' '.repeat(9997) + 'ENOSPC' + ' '.repeat(20001 - 9997 - 6);
    expect(text).toHaveLength(20001);
    expect(matchError(cat, text).matched).toBe(false);
  });
});

describe('TC-FR-EXPL-002 一次キー優先・priority・記載順', () => {
  test('TC-FR-EXPL-002 一次キー一致は文言一致より優先（priority が大きくても）', () => {
    const cat = catalog(
      entry('BY-PATTERN', { patterns: ['cannot be loaded'] }, 1),
      entry('BY-ID', { ids: ['UnauthorizedAccess'] }, 90),
    );
    const result = matchError(cat, 'npm.ps1 cannot be loaded. FullyQualifiedErrorId : UnauthorizedAccess');
    expect(result).toEqual(expect.objectContaining({ matched: true, rank: 'id' }));
    expect(result.entry.id).toBe('BY-ID');
  });

  test('TC-FR-EXPL-002 同種一致は priority の小さい順', () => {
    const cat = catalog(
      entry('LOW', { patterns: ['timeout'] }, 40),
      entry('HIGH', { patterns: ['timeout'] }, 10),
    );
    expect(matchError(cat, 'request timeout').entry.id).toBe('HIGH');
  });

  test('TC-FR-EXPL-002 priority 同値・同種一致はカタログ記載順の先頭', () => {
    const cat = catalog(
      entry('FIRST', { ids: ['EPERM'] }, 20),
      entry('SECOND', { ids: ['EPERM'] }, 20),
    );
    expect(matchError(cat, 'Error: EPERM: operation not permitted').entry.id).toBe('FIRST');
  });

  test('TC-FR-EXPL-002 単語境界: GetContentReaderUnauthorizedAccessError は WIN-PS-POLICY に不一致', () => {
    const cat = catalog(entry('WIN-PS-POLICY', { ids: ['UnauthorizedAccess'] }));
    expect(matchError(cat, 'GetContentReaderUnauthorizedAccessError').matched).toBe(false);
    expect(matchError(cat, 'FullyQualifiedErrorId : UnauthorizedAccess').matched).toBe(true);
  });

  test('TC-FR-EXPL-002 match.all は全て含む時だけ一致（AND）', () => {
    const cat = catalog(entry('NODE-MODULE-NOT-FOUND', { patterns: ['cannot find module'], all: ['MODULE_NOT_FOUND'] }));
    expect(matchError(cat, "Error: Cannot find module 'x'").matched).toBe(false);
    expect(matchError(cat, "Error: Cannot find module 'x'\n  code: 'MODULE_NOT_FOUND'").matched).toBe(true);
  });

  test('TC-FR-EXPL-002 一致は1件のみ返す', () => {
    const cat = catalog(entry('A-ONE', { ids: ['ENOENT'] }), entry('B-TWO', { ids: ['ENOENT'] }));
    const result = matchError(cat, 'ENOENT');
    expect(Object.keys(result).sort()).toEqual(['entry', 'matched', 'rank']);
    expect(result.entry.id).toBe('A-ONE');
  });
});

describe('TC-FR-EXPL-003 一致なし', () => {
  test('TC-FR-EXPL-003 どれにも一致しなければ matched=false のみ', () => {
    const cat = catalog(entry('DISK-FULL', { ids: ['ENOSPC'] }));
    expect(matchError(cat, 'something unrelated happened')).toEqual({ matched: false });
  });

  test.each([null, undefined, 42, {}, ''])('TC-FR-EXPL-003 不正入力 %p は例外を投げず matched=false', (input) => {
    const cat = catalog(entry('DISK-FULL', { ids: ['ENOSPC'] }));
    expect(matchError(cat, input)).toEqual({ matched: false });
  });

  test('TC-FR-EXPL-003 カタログが空・不正でも matched=false', () => {
    expect(matchError([], 'ENOSPC')).toEqual({ matched: false });
    expect(matchError(null, 'ENOSPC')).toEqual({ matched: false });
  });

  test('TC-FR-EXPL-003 コンパイル済みでない要素が混ざっても例外を投げず、正しい要素で照合する', () => {
    const cat = [{}, null, ...catalog(entry('DISK-FULL', { ids: ['ENOSPC'] }))];
    expect(() => matchError(cat, 'ENOSPC')).not.toThrow();
    expect(matchError(cat, 'ENOSPC').entry.id).toBe('DISK-FULL');
  });
});

describe('TC-NFR-PORT-001 改行コード', () => {
  test('TC-NFR-PORT-001 CRLF と LF で同じ結果（複数行にまたがるパターン）', () => {
    const cat = catalog(entry('MULTI-LINE', { patterns: ['line one\\nline two'] }));
    const lf = matchError(cat, 'line one\nline two');
    const crlf = matchError(cat, 'line one\r\nline two');
    expect(lf.matched).toBe(true);
    expect(crlf).toEqual(lf);
  });

  test('TC-NFR-PORT-001 単独の CR も LF として扱う', () => {
    expect(normalizeInput('a\rb\r\nc')).toBe('a\nb\nc');
  });
});
