'use strict';

// T-001 / ADR-007: explain project が tests/unit/explain の .test.js を収集し、
// 新規 JS 3系統がカバレッジ集計対象に入っていることを確認する。
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const config = require(path.join(ROOT, 'jest.config.js'));

describe('ADR-007 テスト基盤', () => {
  const explain = (config.projects || []).find((p) => p.displayName === 'explain');

  test('ADR-007 explain project が定義されている', () => {
    expect(explain).toBeDefined();
    expect(explain.testEnvironment).toBe('node');
  });

  test('ADR-007 explain project は tests/unit/explain の .test.js のみを収集する', () => {
    expect(explain.testMatch).toEqual(['<rootDir>/tests/unit/explain/**/*.test.js']);
  });

  test('ADR-007 既存 unit project は .ts のみで explain の .js と重複しない', () => {
    const unit = config.projects.find((p) => p.displayName === 'unit');
    expect(unit.testMatch.every((m) => m.endsWith('.ts'))).toBe(true);
  });

  test('ADR-007 collectCoverageFrom に新規 JS 3系統が含まれる', () => {
    expect(config.collectCoverageFrom).toEqual(
      expect.arrayContaining([
        '.claude/skills/guide/explain/**/*.js',
        '.claude/skills/guide/guide.js',
        '.claude/hooks/error-explain-hook.js',
      ]),
    );
  });
});
