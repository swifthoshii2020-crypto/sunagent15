# TAISUN v2

**Unified Development & Marketing Platform** - AIエージェント、MCPツール、マーケティングスキルを統合した次世代開発プラットフォーム

[![CI](https://github.com/taiyousan15/sunagent15/actions/workflows/ci.yml/badge.svg)](https://github.com/taiyousan15/sunagent15/actions/workflows/ci.yml)
[![Security Scan](https://github.com/taiyousan15/sunagent15/actions/workflows/security.yml/badge.svg)](https://github.com/taiyousan15/sunagent15/actions/workflows/security.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20.x%20%7C%2022.x-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Tests-1092%20passing-brightgreen)](https://github.com/taiyousan15/sunagent15/actions)
[![Research Sources](https://img.shields.io/badge/Research%20Sources-133-blueviolet)](https://github.com/taiyousan15/sunagent15/blob/main/.claude/skills/world-research/SKILL.md)

> **TAISUN v2 は Claude Code の拡張パックです。**
> インストールするだけで 92〜121スキル（プロファイル可変・標準 約114）・101+コマンド・25 MCPサーバー が使えるようになります（エージェントは Claude Code 組み込み subagent + 83 個の agent-source テンプレートを活用）。

---

## 📋 最新バージョン

**v2.53.3** (2026-04-15) — 他人インストール/更新/別プロジェクト利用ポータビリティ完全対応・サイレント失敗検知

| バージョン | 日付 | 内容 |
|-----------|------|------|
| v2.53.3 | 2026-04-15 | **他人配布向けポータビリティ修正5フェーズ（PR #307）** — (P0) `scripts/setup-project.ps1:181`で`.claude\agents`→`.claude\agent-source`に修正（Windows setup-project単体実行時にエージェント0件の可能性を解消）/ `install.ps1`のパラメータ`$Profile`→`$SkillProfile`改名（PowerShell自動変数衝突の解消、`-Profile`エイリアスで後方互換）/ install.sh完了メッセージの更新案内を`npm run setup`（破壊的）から`npm run update`（非破壊）に変更 / (P1) **非破壊アップデート実装** — `src/utils/settings-merge.ts`で additive-only deep merge を実装（ユーザー値優先・新規MCPは`disabled:true`で追加）/ `scripts/update-settings.js`で自動backup（chmod 600・FIFO 3世代）+ merge + サマリー表示 / 新コマンド`npm run setup:fresh`で破壊的リセットを明示分離 / (P2) **サイレント失敗検知** — `scripts/verify-installation.js`でローカル検証7項目（CLAUDE.md存在・hook動的カウント・hook参照先存在・skill symlink dangling検出・agent数・version整合・JSON構文）/ 新コマンド`npm run taisun:verify` / install.sh Step 5 動的hookカウントへ変更（ハードコード3件→全件）/ (P3) **Windows CI + update.sh verify統合** — `.github/workflows/ci.yml`にwindows-latestジョブ新設、setup-project.ps1のagent-source参照 + install.ps1のSkillProfile/Alias を回帰ガード / update.sh最後にverify-installation自動実行 / (P4) **セキュリティ + housekeeping** — `npm audit fix`で8脆弱性（critical 1 + high 3 + moderate 4）→ 0解消 / `.gitignore`に`ログ/`追加 / hook 14件のchmod +x整合 / (P5) **フレッシュインストール regression修正** — `update-settings.js`に fresh install 自動検知を追加（settings.json不在 or mcpServers空 → template値を尊重して `disabled:false` MCPがデフォルトで有効化される）/ `smartMerge`関数を新設（auto-detection + forceFresh オプション）/ 15ラウンドOpus × Codex議論ドキュメント保存（debate/下34ファイル）/ テスト: 57 suites / 1107 tests（+15 settings-merge ユニット）/ ESLint: 0 / tsc: 0 / npm audit: 0 vulnerabilities |
| v2.53.2 | 2026-04-13 | **hookコマンド全31件のポータビリティ修正** — 相対パス`node .claude/hooks/xxx.js`がCWD≠プロジェクトルート時にMODULE_NOT_FOUNDで失敗する問題を解消。ファイル不在時のみサイレントexit 0、存在時はnodeのexit codeをそのまま保持する`[ ! -f X ] && exit 0; node X`パターンに統一。unified-guard等のブロック用非ゼロexit codeが`|| exit 0`で上書きされていた潜在バグも同時修正 / テスト: 56 suites / 1092 tests / ESLint: 0 |
| v2.53.1 | 2026-04-13 | **コンテキスト最適化 ~6,700トークン/セッション削減** — boot/03-core-rules.md削除(CLAUDE.mdと85%重複)・boot/04-agent-rules.mdトリガー表圧縮・mistakes.md修正済みテーブル分離・context-management.md重複削除・MCP 3件無効化(obsidian/puppeteer/gpt-researcher) / **Opus+Codex 20ラウンドレビュー全課題解消** — High 3件+Medium 2件+Low 4件 / **新スキル** — `/task-miss`(ミス防止プロトコル)・`/honest-mode`(推測禁止)・`/session-start`・`/session-end` / **ポータビリティ改善** — ハードコードパス5箇所修正・mistakes.md移動(16ファイル27箇所)・dist再ビルド / **MEMORY.md作成** — 6トピックファイルで永続記憶初期化 / テスト: 56 suites / 1092 tests / ESLint: 0 |
| v2.53.0 | 2026-04-09 | **3エージェント（Codex Pro + GPT 5.4 Pro Thinking + Opus 4.6）合同コードレビュー + 15ラウンド議論** に基づく緊急修正・堅牢化 / **緊急修正4件** — (1) research-quality-guard: APIトークン名を検索キーワードから除外しnitter/twitter.com/searchに変更（機密情報誘導リスク削除） (2) mistake-pattern-matcher: action.substring(0, 2000) で大ファイル書込み時のn-gram爆発防止 (3) cost-hard-stop-guard: recordCost順序修正で上限超過時の二重計上を解消 (4) rules-enforce-guard + checkpoint-guard: Bashホワイトリスト迂回対策（コマンド連結文字 [;&\|\`$()<>] を含む場合は適用外化） / **短期修正4件** — (5) utils/session-path.js 新規helper（厳格なsessionId検証・path.resolve閉じ込め・symlink拒否によるPath Traversal対策） (6) rules-read-tracker: JSON→JSONL append-only化でrace condition解消 (7) 全9 hookに stdin timeout(3秒) 追加 (8) catch ハンドラに console.error 追加でデバッグ性向上 / **判定訂正** — 議論で3つの誤認を特定: Codex「deny時exit 0はfail-open」は誤り(Claude Code仕様では正常ブロック)、GPT「構文エラー多数」は事実無根、Opus「pid衝突で全ツール凍結」は方向逆 / hook合計13個が全て堅牢化完了 |
| v2.52.0 | 2026-04-08 | **3層ミス対策システム完成（97/100点）** — 812ソース徹底調査+15ラウンドOpus×GPT議論に基づく / **context-snapshot-manager.js追加** — PreCompact hookで一時保存→SessionStartで自動復元→SessionEndで自動削除。巨大リサーチでコンパクト時の記憶喪失を防止 / **mid-session-reminder.js追加** — 5回プロンプトごとにコアルールを自動再注入。長時間セッションのルールドリフト対策 / **mistake-pattern-matcher.js追加** — Write/Edit/Bash/Task前にmistakes.mdパターンと現在アクションをJaccard類似度で自動照合。日本語2-gram/3-gram対応トークナイザー。「同じミスを繰り返す」問題への直接対策 / **cost-hard-stop-guard.js追加** — Issue #42796（$345→$42,121爆発）対策。日次$50/月次$500上限でツール実行をハードストップ / **research-quality-guard.js追加** — リサーチ出力時の10カテゴリ網羅を物理確認 / **research-system SKILL.md強化** — 720件以上/10カテゴリ最低件数ルール追加（X/YouTube/arxiv/GitHub/HN/日本語コミュニティ/企業ブログ/Dev.to/ベンチマーク/セキュリティ） / **CLAUDE.md 91行→76行** — 重要ルール全保持で段階圧縮 / hook合計13個で物理強制システム完成 |
| v2.51.0 | 2026-04-07 | **チェックポイント物理強制システム完成（92/100点）** — LLMが指示を自己判断でスキップする問題を技術的に防止。リサーチ4エージェント並列調査 + Opus×GPT 10ラウンド議論に基づき設計 / **checkpoint-guard.js追加** — PreToolUse hook (Write/Edit/Bash/MultiEdit) でboot sequence完了を物理確認。Phase 1=警告モード、Phase 2=新規Writeブロック、Phase 3=全ツールブロック / **agent-checkpoint-guard.js追加** — Task tool起動時にプロンプトに「AGENT CHECKPOINT」マーカー必須化 / **rules-read-tracker.js追加** — PostToolUse Read hookでルールファイル読み込み履歴を記録 / **rules-enforce-guard.js追加** — mistakes.md未読時はWrite/Edit/Bash/Task全てブロック。**サブエージェント経由の迂回も完全防止**（親が未読なら子も起動不可） / **安全設計** — フェイルオープン・タイムアウト3秒・環境変数で完全停止可能 / **学術根拠** — AEGIS (arXiv:2603.12621), AgentSpec (ICSE'26), AWS Strands Agents BeforeToolCallEvent |
| v2.50.0 | 2026-04-07 | **BOOT CHECKPOINT** — セッション開始時に動的5問チェック（mistakes.mdランダムPattern確認・SESSION_HANDOFF検証・ワークフロー状態確認・スキル/トリガー検出・未読ファイル編集禁止確認）。推測不可能な質問で確実にファイルを読ませる仕組み / **Agent Checkpoint** — 重要Agent（リサーチ・実装・設計・要件定義）起動時に3問の品質ゲートをプロンプト末尾に自動挿入。Agent成功率75%→90%+予測 / **CLAUDE.md 50%削減** — 183行→91行に構造改善。重要ルールを先頭配置、低頻度ルールをL2に移動。15ラウンドOpus×GPT議論に基づく段階的改善 / **Windows Quick Installer** — `irm https://raw.githubusercontent.com/.../quick-install.ps1 \| iex` の1行でC:\taisun_agentに自動インストール。OneDrive・日本語パス・LongPath問題を根絶 / **install.ps1バグ修正** — .Countバグ全5箇所修正・TLS 1.2強制・npmエラーログ保存 / **research系9スキルeffort:正規化** — frontmatter外のeffort:を内に移動し高品質思考モードが正しく適用されるように修正 / **スキル数検証チェック** — install/updateスクリプトに期待値照合を追加 |
| v2.49.0 | 2026-04-05 | **agent-browser v0.24.1 をデフォルトブラウザツールに採用** — Playwright MCPからの移行でコンテキストトークン93%削減（114k→7k/10ステップ操作）。Opus 4.6×GPT 5.4の8ラウンド議論（全ラウンド一致）に基づく判定。CLI方式のためMCP枠を消費しない / **udemy-downloadスキル復活** — Udemyコース全動画+字幕一括ダウンロード（video-downloadでは代替不可） / Playwright MCPはオプション降格（disabled: true、特殊用途で残す） / **git履歴衝突の自動回復** — update.sh/install.ps1にgit reset --hard自動フォールバック追加。Mac/Windows両対応 / **動画ダウンロード自動発動** — 「動画ダウンロード」「YouTube保存」「Instagram/TikTokダウンロード」「Udemyコース保存」「文字起こし」等の日本語トリガーでvideo-download/udemy-downloadが自動起動 |
|-----------|------|------|
| v2.48.0 | 2026-04-04 | **リポジトリ大規模クリーンアップ** — Opus 4.6×GPT 5.4の10ラウンドレビューに基づき909ファイル削除（約199MB削減）/ ルートファイル105→32（-70%）/ スキル125→62（-50%）不要スキル58件削除+リサーチ子スキル12件をdisable-model-invocation化 / google-auth-system壊れたsubmodule→正しいsubmoduleに修正 / sdd-fullの質問を素人でも答えられる平易な日本語に改善 / .gitignore強化（.agent-trace, research, dist等の実行時生成物を追跡除外） |
| v2.47.0 | 2026-04-03 | **research-system-free** 完全無料リサーチスキル追加（APIキーゼロ・WebSearch+opencli-rs+Ollamaで動作） / research-system配布用ファイル同梱（scripts/distributions/） / CLAUDE.mdにリサーチ自動発動ルール追加（「リサーチして」等で全13スキル自動起動） / Windows git pull競合修正（.gitattributes ps1 eol=lf） / install.ps1 ReadKey廃止→Start-Sleep 3秒（キー入力待ち停止修正） |
| v2.46.0 | 2026-03-30 | **パイプラインコンテキスト連携v2.5** — research-systemから各リサーチスキル（mega/world/intelligence/omega）へSTEPコンテキスト（キーワード・前STEP発見事項・品質基準）をJSON経由で自動伝搬。設計書v3.0完全接続 / **GSD移植3件** — SESSION_HANDOFF JSON構造化・Atomic Git Commits・コンテキスト30-40%制御 / **.claude最適化** — hooks/data 1.06MB削除・rules重複8ファイル解消・mistakes.md 224→75行圧縮 / **Windows根本修正** — UTF-8 BOM追加・set -e廃止・非対話対応・git pull失敗→ZIP自動フォールバック・Junction失敗→コピーフォールバック / **Mac修正** — set -e廃止・clear廃止・read -p対話判定・rsyncなしcp代替 |
| v2.45.0 | 2026-03-29 | **opencli-rs統合**（55サイト333コマンドをリサーチスキルに接続）— world-research Layer 5にSNS直接取得追加 / mega-research Deep Modeにopencli-rs補完Step追加 / intelligence-researchに金融3+テック3ソース自動追加 / opencli-research v2（5Tier・6パターン）全面書き直し / **YouTube transcript**で動画文字起こし取得対応 / Twitter trending・Reddit・LinkedIn・Instagram・TikTok・Facebook のブラウザ認証経由取得対応 / **Windows UX改善** — README/setup-project.ps1のハードコードパス(`C:\Users\you`)を`~`に修正 / `git pull` エラー時のZIPダウンロード手順を追加 |
| v2.44.0 | 2026-03-25 | **プロファイルインストール**（minimal/standard/full）— install.sh + install.ps1 両対応 / **CodeGraph統合**（codebase-memory-mcp・自動インデックス・ROI計測）/ **配布互換性修正**（ハードコードパス5箇所→環境変数化）/ StopFailure自動記録Hook / effortフロントマター（コスト制御）/ MCP最適化（twitter-client・obsidian有効化、9個無効化）/ video-downloadスキル復活 / スキル114エージェント数更新 |
| v2.43.0 | 2026-03-18 | BUG-001/004/005/006/007 全解消 / スキル早見表4枚（リサーチTier・taiyo-style・LP・SDD）追加 / `taisun:version` `taisun:support` コマンド新設 / 承認モデル実装（投稿系=警告・課金系=ブロック）/ Ollamaランタイムガード / プロファイル整合性チェック / gem-research・unified-research 命名修正 / research-system v2.4（QA Gate・61件URL・外部ファイル不要） |
| v2.42.0 | 2026-03-17 | install.sh / update.sh / install.ps1 を全面日本語化（70歳でも使える初心者UX）/ フォルダ説明・エラー案内・完了後3ステップガイドを追加 / MCPプロファイル切替スキル（`/mcp-profile`）追加 / `npm run mcp:dev\|secure\|marketing\|status` コマンド追加 |
| v2.41.0 | 2026-03-17 | README に everything-claude-code インストール・アップデート手順セクション追加 / MCP 29→21個に整理（不要5サーバー削除）/ proxy-mcp resilience 強化（リトライ5回・エラークラス分類）|
| v2.40.0 | 2026-03-14 | バリデーション8層化 — kuromoji日本語形態素解析・LLM Judge（Claude Haiku審判）追加 / BUG-001〜008全修正（ゼロ除算・数値正規化・ラウンド表記・completeness検出強化）/ MAX_SENTENCES=50でO(N²)爆発防止 |
| v2.39.0 | 2026-03-14 | 7層バリデーションパイプライン実装（Constitutional AI + Self-Contrast + CoVe + Faithfulness + DeepEval + Reflexion）/ エンタープライズ規模テスト81件追加 |
| v2.38.0 | 2026-03-13 | Stagehand/Skyvern MCP追加でAIブラウザ自動操作を強化 |
| v2.37.0 | 2026-03-12 | Firecrawl MCP統合 — スクレイピング・クロール・サイト構造分析 |
| v2.36.1 | 2026-03-08 | `tsconfig.json` バグ修正（`src/lib`除外を削除・`noImplicitAny: true`）/ CI カバレッジ閾値70→80%（※`src/`ビルド対象のみ。フック46個・スキル130個・エージェント96個は対象外）・Trivy@0.29.0固定・gitleaksシークレットスキャン追加 / `cd.yml`をGitHub Releases配布ワークフローに全面書き換え（tar.gz+zip+SHA256チェックサム自動生成） |
| v2.35.0 | 2026-03-06 | Windows 10/11 用 PowerShell インストールスクリプト (`scripts/install.ps1`) 新規追加・INSTALL.md を Mac/Windows 分離の手順に全面書き直し |
| v2.34.0 | 2026-03-06 | `intelligence-research` スキルを taisun_agent に移植（31ソース並列収集）+ SKILL.md をシンボリックリンク自動検出でポータブル化 |
| v2.33.0 | 2026-03-06 | `/research-system` スキル追加 — BUILD_TARGETを引数で渡すとキーワード展開→ディープリサーチ2回→アーキテクチャ設計→12セクションレポートまで自動実行（YAML定義でコンテキスト52%削減） |
| v2.32.1 | 2026-03-06 | スキル・MCP設定の絶対パスをポータブルパスに修正 |
| v2.32.0 | 2026-03-06 | グローバルスキル3件をリポジトリに追加 — スタンドアロン化完了（deep-research-grok / intelligence-research / omega-research） |
| v2.31.0 | 2026-03-04 | SDD 13スキルをOllamaローカルモデルに最適化（deepseek-r1:70b + qwen2.5:72b）+ setup-sdd.sh追加（3プラン選択式セットアップ） |
| v2.30.0 | 2026-03-02 | install/update のagentリンクバグ修正 — git pull後も全96エージェントが~/.claude/agents/に確実に反映されるよう修正 |
| v2.29.0 | 2026-03-02 | OpenRouter/Groq経由 LiteLLMセットアップ追加 — claude-lite コマンドでClaude料金を1/3〜1/10に削減 |
| v2.28.0 | 2026-03-02 | install/update 全面改善 — 全スキルsymlink化・MCP自動ビルド・絶対パス除去・agent-memory/praetorian をgitignore |
| v2.27.0 | 2026-02-28 | スラッシュコマンド 110→190+に拡充 / サブエージェント永続メモリ実装 / task-overflow-guard追加 |
| v2.26.0 | 2026-02-27 | プランモード自動起動防止ルール追加 (`no-plan-mode.md`) |
| v2.25.0 | 2026-02-22 | Hook Advisory-only化 + AGENTS.md 自己改善ループ |

→ 全バージョン履歴: [CHANGELOG.md](CHANGELOG.md)

---

## 📦 リポジトリ移行のお知らせ（旧 taisun_agent ユーザー向け）

本プロジェクトは **2026-05 にリポジトリ名を `taisun_agent` → `sunagent15` に変更** しました。
旧リポジトリ `taiyousan15/taisun_agent` は凍結済み（今後の更新なし・近日アーカイブ予定）です。

### 旧 `~/taisun_agent` を使っている方の乗り換え手順

旧 repo から git pull はできません（新リポジトリは別 URL）。下記の **クリーン乗り換え** を推奨します。

```bash
# 1. 旧フォルダをバックアップ（念のため）
mv ~/taisun_agent ~/taisun_agent.backup-$(date +%Y%m%d)

# 2. 新リポジトリを取得して再インストール
cd $HOME
git clone https://github.com/taiyousan15/sunagent15.git
cd sunagent15
./scripts/install.sh   # Mac/Linux
# .\scripts\install.ps1 # Windows
```

> 動作確認後に `~/taisun_agent.backup-*` は削除して構いません。
> なお、`.claude/agent-memory/` の per-machine 学習履歴を引き継ぎたい場合は、バックアップから `cp -r ~/taisun_agent.backup-YYYYMMDD/.claude/agent-memory ~/sunagent15/.claude/` で復元できます。

---

## 🚀 インストール（5分）

> **Claude Code のチャットにコピペするだけ！** スキル・エージェント・MCPは全て自動でグローバル登録されます。
> インストール後はどのフォルダで Claude Code を開いてもスキル・MCP が使えます。
> sunagent15 の hooks やプロジェクト固有ワークフローも別プロジェクトで使いたい場合は、後述の **「📂 別のプロジェクトフォルダで使う」** を参照してください。

### 🍎 Mac

**インストール（推奨: 1行で完了）**

```
以下をコピペして実行：
curl -fsSL https://raw.githubusercontent.com/taiyousan15/sunagent15/main/install.sh | bash
```

> デフォルトで `~/.taisun-agent/` にクローンされます。別のパスに入れたい場合: `curl -fsSL https://raw.githubusercontent.com/taiyousan15/sunagent15/main/install.sh | TAISUN_INSTALL_DIR=~/my-path bash`

<details>
<summary>インストール（検証付き: SHA256チェックあり）※現在準備中・利用不可</summary>

> ⚠️ この方式は GitHub Release の公開後に利用可能になります（現在 Release は未公開のため失敗します）。
> 通常は上の1行インストールをご利用ください。

```
以下をコピペして実行：
curl -fsSL https://raw.githubusercontent.com/taiyousan15/sunagent15/main/install-release.sh | bash
```

</details>

<details>
<summary>Legacy: git clone から手動インストール</summary>

```
以下のコマンドを順番に実行して：
cd ~
git clone https://github.com/taiyousan15/sunagent15.git
cd sunagent15
bash scripts/install.sh
```

> `Permission denied` が出た場合は `bash scripts/install.sh` で実行してください。
> `git: command not found` が出た場合は `xcode-select --install` を先に実行してください。

</details>

**完了の目安**: `スキル: N 個が利用可能です ✅（期待値: M個）` と `エージェント: N 個が利用可能です` が表示されれば成功。数値はプロファイルで変動（minimal: 約 92 / standard: 約 114 / full: 約 121）。「エージェント」表示は `.claude/agent-source/` の 83 テンプレートが `~/.claude/agents/` にコピーされた数です。

**アップデート（1行で完了）**

```
# one-liner で入れた場合
cd ~/.taisun-agent && ./scripts/update.sh
# git clone で入れた場合
cd ~/sunagent15 && ./scripts/update.sh
```

> git pull を自動試行し、失敗した場合はZIPダウンロードで自動更新します。手動操作は不要です。

---

### 🪟 Windows

> PowerShell を開いて実行してください。

**事前準備（初回のみ）**

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

**インストール（推奨: 1行で完了）**

```powershell
irm https://raw.githubusercontent.com/taiyousan15/sunagent15/main/install.ps1 | iex
```

> 上の事前準備（`Set-ExecutionPolicy`）を済ませてから PowerShell ウィンドウで実行してください。

**インストール（git clone から手動）**

```powershell
cd $HOME
git clone https://github.com/taiyousan15/sunagent15.git
cd sunagent15
.\scripts\install.ps1
```

> `スクリプトの実行が無効` エラーが出た場合は `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` を先に実行してください。
> `git: 用語 'git' は〜` エラーが出た場合は https://git-scm.com/download/win から git をインストールしてください。

**完了の目安**: `スキル: N 個が利用可能です ✅（期待値: M個）` と `エージェント: N 個が利用可能です` が表示されれば成功。数値はプロファイルで変動（minimal: 約 92 / standard: 約 114 / full: 約 121）。「エージェント」表示は `.claude/agent-source/` の 83 テンプレートが `~/.claude/agents/` にコピーされた数です。

**アップデート（1行で完了）**

```powershell
cd $HOME\sunagent15; .\scripts\install.ps1 -Update
```

> git pull を自動試行し、失敗した場合はZIPダウンロードで自動更新します。手動操作は不要です。

---

### 🔧 環境変数 `TAISUN_AGENT_DIR`（自動設定）

インストールすると、`TAISUN_AGENT_DIR` 環境変数が **自動的に設定・永続化** されます:

| OS | 永続化先 | 値 |
|----|---------|---|
| Mac / Linux | `~/.zshrc`, `~/.bashrc`（存在するもの全て） | sunagent15 インストール先の絶対パス |
| Windows | PowerShell の `$PROFILE` | 同上 |

これは **sunagent15 をインストールしたフォルダの絶対パス** を保持し、TAISUN のスキル・スクリプトが内部で参照します（環境変数名は歴史的経緯で `TAISUN_AGENT_DIR` のまま）。**ユーザーが直接操作・export する必要はありません**。

別フォルダにインストールした場合（例: `~/dev/sunagent15`、`TAISUN_INSTALL_DIR=~/my-path`）も自動でその値が保存されます。

> 💡 新しいシェルセッションでは自動で有効になります。現セッションですぐ使うには `source ~/.zshrc`（Mac/Linux）または PowerShell 再起動。

---

### 📂 別のプロジェクトフォルダで使う

sunagent15 の機能を他のプロジェクトでも使いたい場合、セットアップスクリプトを1行実行するだけです。
`.claude/` と `.mcp.json` がリンクされ、そのフォルダでClaude Codeを開くと全機能が使えます。

**Mac:**
```bash
cd /path/to/your/project
~/sunagent15/scripts/setup-project.sh
```

**Windows:**
```powershell
cd ~\Projects\MyProject
~\sunagent15\scripts\setup-project.ps1
```

実行後の結果:
```
  ┌──────────────┬──────────────────────────────────────────┐
  │     項目     │                   状態                    │
  ├──────────────┼──────────────────────────────────────────┤
  │ .git         │ 初期化済み                                │
  │ .claude/     │ → ~/sunagent15/.claude/                │
  │ .mcp.json    │ → ~/sunagent15/.mcp.json               │
  │ スキル       │ 69個                                      │
  │ エージェント │ 83個                                      │
  └──────────────┴──────────────────────────────────────────┘
```

> `.gitignore` に `.claude/` `.mcp.json` `.env` が自動追加されるので、リンク先がgitに入ることはありません。

---

## 🛠 インストール後に使えるコマンド

### バージョン確認

```bash
npm run taisun:version
```

バージョン・OS・Node・Ollama・プロファイル・スキル数・サポートIDを一覧表示します。

### 困ったとき（サポート用診断）

```bash
npm run taisun:support
```

診断情報をファイルに保存します。サポートに送るだけで問題を特定できます。

### システム診断

```bash
npm run taisun:diagnose
```

スキル・エージェント・MCP・フックの状態を自動チェックします。

### MCPプロファイル切替

```bash
npm run mcp:dev          # 開発モード（Playwright・Context7・n8n等）
npm run mcp:secure       # セキュアモード（最小権限）
npm run mcp:marketing    # マーケティングモード（Meta Ads・Twitter・Firecrawl等）
npm run mcp:status       # 現在の状態を確認
```

### スキルプロファイル変更

インストール後でもスキル構成を変更できます。

**Mac:**
```bash
./scripts/install.sh --list-profiles          # 一覧表示
./scripts/install.sh --profile minimal        # 最小構成（93個）
./scripts/install.sh --profile full           # 全スキル（約122個）
./scripts/install.sh --with-docker --with-figma  # 個別追加
```

**Windows:**
```powershell
.\scripts\install.ps1 -ListProfiles           # 一覧表示
.\scripts\install.ps1 -Profile minimal        # 最小構成（93個）
.\scripts\install.ps1 -Profile full           # 全スキル（約122個）
.\scripts\install.ps1 -WithDocker -WithFigma  # 個別追加
```

### APIキー設定

`.env` ファイルに設定します。**ANTHROPIC_API_KEY だけあれば基本機能は全て使えます。**

```bash
# 必須（これがないとClaude Codeが動きません）
ANTHROPIC_API_KEY=sk-ant-...

# 推奨（リサーチ機能が大幅に強化されます・全て無料枠あり）
TAVILY_API_KEY=tvly-...          # Web検索（1,000 req/月 無料）
FRED_API_KEY=...                 # 経済指標（無制限・要登録）
NEWSAPI_KEY=...                  # ニュース収集（100 req/日 無料）
```

> 他のAPIキーは `.env.example` に一覧があります。必要になった時に追加すればOKです。

### スキル早見表

インストール後、以下のガイドが `.claude/skills/_guides/` に配置されます：

| ガイド | 内容 |
|-------|------|
| `research-tier-guide.md` | リサーチスキルの選び方（Tier 0〜4 / 8スキル比較） |
| `taiyo-style-guide.md` | コピーライティング8種の用途別早見表 |
| `lp-flow-guide.md` | LP作成フロー（Ollama不要/必要ルート別） |
| `sdd-flow-guide.md` | SDD設計フロー（Ollama不要/必要ルート別） |

---

## 🔄 everything-claude-code (ECC) のインストール・アップデート

TAISUN は **[everything-claude-code](https://github.com/affaan-m/everything-claude-code)** をベースレイヤーとして使用しています。
ECC は Claude Code 向けの汎用スキル・エージェント・コマンド集（Anthropic Hackathon 受賞）です。

### システム構造

```
ECC (基盤層)              → ~/.claude/ にグローバルインストール
  └─ rules / agents / commands / skills (300+)

TAISUN (プロジェクト層)   → ./claude/ にプロジェクトローカル設定
  └─ WORKFLOW CONTRACT / hooks / MCP 26個 / 独自スキル
```

### 初回インストール

```bash
# 1. リポジトリをクローン
cd ~/Desktop/01_開発プロジェクト   # ← 任意のフォルダでOK
git clone https://github.com/affaan-m/everything-claude-code.git
cd everything-claude-code

# 2. 依存関係をインストール
npm install

# 3. ECC を ~/.claude/ に適用（TypeScript プロジェクト向け）
bash install.sh typescript
```

**完了の目安**: `~/.claude/commands/`, `~/.claude/agents/`, `~/.claude/skills/` に大量のファイルが展開されれば成功。

> インストール記録は `~/.claude/ecc/install-state.json` に保存されます（バージョン・コミットハッシュ確認可能）。

### アップデート

```bash
cd ~/Desktop/01_開発プロジェクト/everything-claude-code

# 競合する可能性があるローカルファイルを退避（初回のみ）
# ls .claude 2>/dev/null && mv .claude .claude.backup

# 最新版を取得
git pull origin main

# 再インストール（差分のみ適用）
bash install.sh typescript
```

**現在の ECC バージョン確認**:
```bash
cat ~/.claude/ecc/install-state.json | python3 -m json.tool | grep repoVersion
```

### ECC が提供する主な機能

| カテゴリ | 内容 | TAISUN での使われ方 |
|---------|------|-------------------|
| `rules/` | coding-style, testing, security 等11ファイル | 全コードのコーディング規約強制 |
| `agents/` | ait42-* 汎用エージェント群 | `/omega-research` 等から自動呼び出し |
| `commands/` | /tdd, /code-review, /checkpoint 等 | スラッシュコマンドとして使用可能 |
| `skills/` | 300+ スキル | `Skill tool` で呼び出す全スキルのベース |

### 注意事項

- ECC は `~/.claude/` (グローバル) に適用、TAISUN 独自設定 `.claude/` (プロジェクト) には影響なし
- `git pull` 前にローカルに `.claude/` があると競合エラーが出る → `mv .claude .claude.backup` で退避
- ECC v1.8.0 では357ファイルが展開される（インストール時間: 約30秒）

---

## 🤖 SDD スキル最適化セットアップ（NEW v2.31.0）

SDD（Software Design Document）スキル13本を環境に合わせた最適なモデルで動作させるセットアップです。

### 3パターンから選べます

| # | プラン | モデル | 対象 |
|---|--------|--------|------|
| 1 | Claude MAX/Pro | claude-opus / claude-sonnet | MAX $200プラン加入済みの方 |
| 2 | **Ollama ローカル（推奨）** | deepseek-r1:70b / qwen2.5:72b | M1/M2/M3/M4 Mac（32GB以上） |
| 3 | OpenRouter 格安API | deepseek-chat | どのマシンでも |

### セットアップ（Claude Code のチャットに貼り付けて実行）

```
以下を実行して（対話式でプランを選べます）：
bash ~/sunagent15/scripts/setup-sdd.sh
```

完了したら：

```
以下を実行して：
source ~/.zshrc
```

### SDD スキル（13本）の使い方

```
/sdd-full <spec-slug>        ← 要件定義〜設計まで一括実行（最もよく使う）
/sdd-req100 <spec-slug>      ← EARS準拠 要件定義書作成
/sdd-design <spec-slug>      ← アーキテクチャ設計書作成
/sdd-adr <title> <spec-slug> ← 技術決定記録（ADR）作成
/sdd-context <spec-slug>     ← ビジネスコンテキスト整合（Amazon PR-FAQ）
/sdd-tasks <spec-slug>       ← 実装タスク分解
/sdd-slo <spec-slug>         ← SLO/SLA定義
/sdd-threat <spec-slug>      ← STRIDE脅威分析
/sdd-guardrails <spec-slug>  ← セキュリティガードレール
/sdd-runbook <spec-slug>     ← 運用Runbook作成
```

> **Ollamaモデルを使う場合**: 事前に `ollama pull deepseek-r1:70b` と `ollama pull qwen2.5:72b-instruct-q8_0` が必要です（setup-sdd.sh が自動的に案内します）

---

## 💰 オプション：格安モデルで使う（OpenRouter / Groq）

通常の Claude Code は Anthropic に直接課金されますが、**OpenRouter経由にすると料金が1/3〜1/10**になります。

### APIキーを取得する（2つ）

| サービス | 料金 | 取得先 |
|---------|------|--------|
| OpenRouter | 有料（安い） | https://openrouter.ai/keys |
| Groq | **無料枠あり** | https://console.groq.com/keys |

### セットアップ（Claude Code のチャットに貼り付けて実行）

```
以下を実行して（キーを自分のものに置き換えて）：
OPENROUTER_API_KEY="sk-or-ここにキー" GROQ_API_KEY="gsk_ここにキー" bash ~/sunagent15/scripts/setup-litellm.sh
```

完了したら：

```
以下を実行して：
source ~/.zshrc
```

### 使い方

```
claude-lite      ← 安いモデル経由でClaude Codeを起動（これだけでOK）
litellm-stop     ← 止める
litellm-health   ← 起動状態を確認
```

> **Groqだけ使いたい場合**（完全無料）: `GROQ_API_KEY="gsk_ここにキー" bash ~/sunagent15/scripts/setup-litellm.sh`

---

## ✅ 動作確認

```
npm run taisun:diagnose
```

**70点以上で正常動作（90点以上で全機能良好）**

| 項目 | 配点 |
|------|------|
| 13層防御システム | 40点 |
| Hooks 設定 | 20点 |
| スキル | 15点 |
| エージェント | 15点 |
| MCPツール | 5点 |
| メモリシステム | 5点 |

---

## 🎯 使い方

困ったとき・何から始めるか迷ったときは、Claude Code で /guide と入力してください。

インストール後は **日本語で話しかけるだけ** で全機能が使えます：

```
セールスレターを書いて
LP分析して
YouTubeサムネイルを作って
要件定義を作って
市場リサーチして
```

---

## 📦 含まれる機能

| カテゴリ | 数 | 例 |
|---------|----|----|
| スキル | 69個 | mega-research, taiyo-style-lp, sdd-full, world-research |
| エージェント | Claude Code subagents + agent-source 83個 | planner, code-reviewer, security-reviewer, tdd-guide 等は Claude Code 組み込み |
| コマンド | 101+個 | /learn, /research, /sdd-full, /summarize |
| Hookシステム | 14 層（hook ファイル 62 個） | 危険コマンド防止・セッション継続・自動バックアップ・タスク結果オーバーフロー防止 |
| MCPサーバー | 26 | playwright, pexels, claude-historian, praetorian |
| 永続メモリ | 6エージェント | ait42-coordinator, code-reviewer, planner, security-auditor 等 |

### 主要スキル一覧

| スキル | コマンド | 説明 |
|--------|---------|------|
| **mega-research** | `/mega-research` | 6API統合の最強リサーチ |
| **world-research** | `/world-research` | 6層133ソース総合リサーチ（論文/SNS/コミュニティ） |
| **taiyo-style-lp** | `/taiyo-style-lp` | 太陽スタイルのLP自動生成（成約率4.3倍実績） |
| **sdd-full** | `/sdd-full` | 要件定義→設計→タスク分解を一括生成 |
| **video-agent** | `/video-agent` | 動画制作パイプライン全体 |
| **nanobanana-pro** | `/nanobanana-pro` | AI画像生成（無料・Gemini） |
| **shorts-create** | `/shorts-create` | Shorts/Reels動画自動生成 |
| **url-all** | `/url-all` | URL完全分析（構造・コンテンツ・SEO） |

---

## 🌐 グローバルスキル（どのプロジェクトでも使用可能）

`npm run taisun:setup` 実行時に、以下のスキルが `~/.claude/skills/` に自動インストールされます。
**sunagent15 をリンクしていないプロジェクトでも**使用可能です。

| スキル | コマンド | 説明 |
|--------|---------|------|
| **sdd-req100** | `/sdd-req100` | 100点満点の要件定義（EARS準拠） |
| **sdd-full** | `/sdd-full` | SDD全成果物を一括生成 |
| **research** | `/research` | ワンコマンド調査 |
| **world-research** | `/world-research` | 6層133ソース総合リサーチ |
| **nanobanana-pro** | `/nanobanana-pro` | AI画像生成（無料） |
| **agentic-vision** | `/agentic-vision` | 画像・動画分析（Gemini） |

---

## ❓ よくある質問

| 状況 | 解決方法 |
|------|---------|
| `「already exists」エラー` | 正常です！アップデートコマンドを実行してください |
| `「command not found: claude」` | まずClaude Code CLIをインストール: https://claude.ai/code |
| スキルが使えない | `このフォルダで sunagent15 を使えるようにして` とClaude Codeに伝える |
| `「heap out of memory」` | `メモリ設定を最適化して` とClaude Codeに伝える |
| ビルドエラー | `npm run taisun:setup` を再実行 |
| Windowsでシンボリックリンク失敗 | 開発者モードを有効化するか、方法B（管理者）または方法C（コピー）を試す |
| `Invalid API key` エラー | [docs/API_KEY_TROUBLESHOOTING.md](docs/API_KEY_TROUBLESHOOTING.md) を参照 |

詳細: [INSTALL.md](INSTALL.md) | [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

---

## 🔌 上級者向け: Plugin形式

Claude Code v2.1.0以降（Mac / Windows 共通）：

```bash
/plugin marketplace add taiyousan15/sunagent15
/plugin install taisun-agent@taisun-agent
```

アップデート: `/plugin update taisun-agent`

---

## TAISUNでできないこと（限界）

- 単独では動作しない（Claude Code必須）
- 24時間自律稼働（人間の監視が必要）
- 100%正確な情報（ハルシネーションの可能性あり）
- 専門資格が必要な判断（医療診断、法的助言等）

---

## 📚 ドキュメント

| ドキュメント | 内容 |
|------------|------|
| [CHANGELOG.md](CHANGELOG.md) | 全バージョン更新履歴 |
| [INSTALL.md](INSTALL.md) | 詳細インストールガイド |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | システムアーキテクチャ |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | トラブルシューティング |
| [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md) | Windows専用セットアップ |
| [TAISUN_GUIDE.md](TAISUN_GUIDE.md) | システム解説・プレゼン資料 |
