#!/bin/bash
# TAISUN Agent - インストールスクリプト
#
# 使い方:
#   ./scripts/install.sh                    # 標準インストール（core + video + x-sns）
#   ./scripts/install.sh --profile minimal  # 最小構成（coreのみ、約92スキル）
#   ./scripts/install.sh --profile full     # 全スキル（約121スキル）
#   ./scripts/install.sh --with-docker      # 標準 + Docker スキル追加
#   ./scripts/install.sh --with-figma       # 標準 + Figma スキル追加
#   ./scripts/install.sh --with-voice       # 標準 + 音声AI スキル追加
#   ./scripts/install.sh --list-profiles    # プロファイル一覧を表示

# set -e: 致命的失敗で即停止（失敗許容操作には || true を付与）
set -e

# ─────────────────────────────────────────
# UTF-8 ロケール強制（F6.1: 日本語パス・ファイル名対応）
# 既存の UTF-8 ロケールを尊重し、未設定の場合のみフォールバック
# ─────────────────────────────────────────
if ! locale 2>/dev/null | grep -qi 'UTF-8'; then
    for candidate in "en_US.UTF-8" "ja_JP.UTF-8" "C.UTF-8"; do
        if locale -a 2>/dev/null | grep -qi "^${candidate}$"; then
            export LANG="$candidate"
            export LC_ALL="$candidate"
            break
        fi
    done

    if ! locale 2>/dev/null | grep -qi 'UTF-8'; then
        echo ""
        echo "  ⚠️  UTF-8 ロケールが利用できません"
        echo "     日本語ファイル名使用時に文字化けする可能性があります"
        echo ""
    fi
fi

# 日本語等の非ASCII文字をパスに含む場合の注意喚起（LC_ALL=C で locale 非依存検出）
if LC_ALL=C printf '%s' "$PWD" | LC_ALL=C grep -q '[^ -~]'; then
    echo ""
    echo "  ℹ️  現在のパスに非ASCII文字（日本語等）が含まれています:"
    echo "     $PWD"
    echo "     互換性のため英字パス（例: ~/sunagent15）を推奨します"
    echo ""
fi

# Persist installer output to a timestamped log for bug reports.
# Disabled in CI (CI=true env var) where GitHub Actions captures logs.
# Disabled when TAISUN_NO_LOG_FILE is set.
# Skipped silently if /tmp is not writable.
if [ "${CI:-false}" != "true" ] && [ -z "${TAISUN_NO_LOG_FILE:-}" ]; then
    if touch /tmp/.taisun-install-logtest 2>/dev/null; then
        rm -f /tmp/.taisun-install-logtest
        INSTALL_LOG="/tmp/taisun-install-$(date +%s).log"
        # Tee stdout+stderr to log; preserve original tty for live display
        exec > >(tee -a "$INSTALL_LOG") 2>&1
        echo ""
        echo "  ℹ️  インストールログ: $INSTALL_LOG"
    fi
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Cluster A: 公式 TAISUN_AGENT_DIR を現セッションでも export
# （現プロセスから子プロセスへ伝播。永続化は完了処理直前で別途実施）
export TAISUN_AGENT_DIR="$REPO_DIR"

# ─────────────────────────────────────────
# Mac: Xcode Command Line Tools 確認（gitが動くために必須）
# ─────────────────────────────────────────
if [[ "$OSTYPE" == "darwin"* ]]; then
    # スクリプト自身に実行権限を付与（git clone直後はpermission deniedになる場合がある）
    chmod +x "$0" 2>/dev/null || true
    chmod +x "$REPO_DIR/scripts/"*.sh 2>/dev/null || true

    if ! xcode-select -p &>/dev/null; then
        echo ""
        echo "  ⚠️  Xcode Command Line Tools がインストールされていません"
        echo "     git や Node.js を使うために必要です。"
        echo ""
        echo "  以下のコマンドを実行してインストールしてください:"
        echo "    xcode-select --install"
        echo ""
        echo "  インストール完了後、このスクリプトを再実行してください。"
        exit 1
    fi
fi
VERSION=$(cat "$REPO_DIR/package.json" | grep '"version"' | head -1 | cut -d'"' -f4)

# ─────────────────────────────────────────
# プロファイル引数の解析
# ─────────────────────────────────────────
SKILL_PROFILE="standard"
EXTRA_PROFILES=()
FRESH_MODE=false
SKIP_VERIFY=false
ALLOW_PARTIAL=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --profile)
            SKILL_PROFILE="$2"
            shift 2
            ;;
        --fresh)
            FRESH_MODE=true
            shift
            ;;
        --skip-verify)
            SKIP_VERIFY=true
            shift
            ;;
        --allow-partial)
            ALLOW_PARTIAL=true
            shift
            ;;
        --with-docker)
            EXTRA_PROFILES+=("docker")
            shift
            ;;
        --with-figma)
            EXTRA_PROFILES+=("figma")
            shift
            ;;
        --with-voice)
            EXTRA_PROFILES+=("voice")
            shift
            ;;
        --with-deep-research)
            EXTRA_PROFILES+=("deep-research")
            shift
            ;;
        --list-profiles)
            echo ""
            echo "  利用可能なプロファイル:"
            echo ""
            echo "  minimal   — コアスキルのみ（約92個）"
            echo "              リサーチ・SDD・LP・コピーライティング・キーワード等"
            echo ""
            echo "  standard  — 標準構成（約114個）[デフォルト]"
            echo "              core + 動画制作 + X/SNS自動投稿"
            echo ""
            echo "  full      — 全スキル（約121個）"
            echo "              standard + Docker + Figma + 音声AI + ディープリサーチ拡張"
            echo ""
            echo "  追加オプション:"
            echo "    --with-docker          Docker/コンテナ運用"
            echo "    --with-figma           Figmaデザイン連携"
            echo "    --with-voice           音声AI・TTS"
            echo "    --with-deep-research   ディープリサーチ拡張"
            echo ""
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

# ─────────────────────────────────────────
# 表示ヘルパー
# ─────────────────────────────────────────
ok()   { echo "  ✅ $1"; }
warn() { echo "  ⚠️  $1"; }
info() { echo "  ℹ️  $1"; }
fail() {
    echo ""; echo "  ❌ エラー: $1"; echo "     → $2"; echo "";
    # Opt-in telemetry: emit failure event before exit (always non-blocking)
    if [ -f "$REPO_DIR/scripts/telemetry/emit.js" ]; then
        node "$REPO_DIR/scripts/telemetry/emit.js" install_failed \
            --error_category="${TAISUN_ERROR_CATEGORY:-unknown}" \
            --profile="$SKILL_PROFILE" >/dev/null 2>&1 || true
    fi
    exit 1
}
step() { echo ""; echo "━━━ $1 ━━━"; }

# F11.3: Error log analyzer - prints actionable hints based on npm log content
# Usage: diagnose_npm_log "$NPM_LOG"
diagnose_npm_log() {
    local log="$1"
    [ -f "$log" ] || return 0
    echo ""
    echo "  🔍 ログ解析による原因推定:"
    local matched=0
    if grep -qi "EACCES\|permission denied" "$log" 2>/dev/null; then
        echo "     Hint: パーミッションエラー"
        echo "           → sudo chown -R \$(whoami) ~/.npm"
        matched=1
    fi
    if grep -qi "ENOSPC\|no space" "$log" 2>/dev/null; then
        echo "     Hint: ディスク容量不足"
        echo "           → df -h で空き容量を確認"
        matched=1
    fi
    if grep -qi "ETIMEDOUT\|ECONNRESET\|getaddrinfo\|ENOTFOUND\|ECONNREFUSED" "$log" 2>/dev/null; then
        echo "     Hint: ネットワーク接続エラー"
        echo "           → インターネット接続を確認"
        echo "           → プロキシ環境: npm config set proxy http://your-proxy:port"
        matched=1
    fi
    if grep -qi "ERESOLVE\|peer dep\|unable to resolve" "$log" 2>/dev/null; then
        echo "     Hint: 依存関係の解決失敗"
        echo "           → npm install --legacy-peer-deps を試す"
        matched=1
    fi
    if grep -qi "EINTEGRITY\|sha512 integrity" "$log" 2>/dev/null; then
        echo "     Hint: lockfile 整合性エラー"
        echo "           → rm package-lock.json && npm install"
        matched=1
    fi
    [ "$matched" -eq 0 ] && echo "     (ログから既知パターンは検出されませんでした)"
}

# Opt-in telemetry timing
INSTALL_START_EPOCH=$(date +%s)

# ─────────────────────────────────────────
# ヘッダー
# ─────────────────────────────────────────
# clear は使わない（Claude Code内でログが消えるのを防ぐ）
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║     TAISUN Agent v${VERSION} インストール          ║"
echo "║     所要時間：約 3〜5 分                            ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  プロファイル: ${SKILL_PROFILE}"
echo ""
echo "  このスクリプトが行うこと："
echo "  1. 必要なソフトウェアの確認"
echo "  2. 必要なファイルのダウンロード・準備"
echo "  3. スキル・エージェントの登録（プロファイルに基づく）"
echo "  4. 設定ファイルの作成"
echo "  5. 動作確認"
echo ""
echo "  ⚠️  途中でフォルダが作られたり、画面に文字が流れますが"
echo "      正常な動作です。最後まで待ってください。"
echo ""
# read -p はClaude Code内で動かないため、対話型ターミナルの場合のみ表示
if [ -t 0 ]; then
    read -p "  インストールを開始しますか？ [Enter でスタート / Ctrl+C でキャンセル]" _
fi

# ─────────────────────────────────────────
# Step 1: 必要なソフトウェアの確認
# ─────────────────────────────────────────
step "ステップ 1/5：必要なソフトウェアを確認しています"

echo ""
echo "  このシステムを動かすために必要なソフトウェアを確認します。"
echo ""

# Node.js
if ! command -v node &> /dev/null; then
    fail \
        "Node.js がインストールされていません" \
        "https://nodejs.org/ を開き「LTS版」をダウンロードしてインストールしてください"
fi
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    fail \
        "Node.js v18 以上が必須です（現在: $(node -v)）" \
        "更新してから再実行してください:
       macOS:  brew upgrade node  または  https://nodejs.org/ から LTS版
       nvm:    nvm install --lts && nvm use --lts
       nodebrew: nodebrew install-binary stable && nodebrew use stable
       Linux:  https://nodejs.org/en/download/package-manager"
fi
ok "Node.js $(node -v) … OK"

# npm
if ! command -v npm &> /dev/null; then
    fail \
        "npm がインストールされていません" \
        "Node.js を再インストールすると npm も一緒にインストールされます"
fi
ok "npm $(npm -v) … OK"

# uv（任意）
UV_AVAILABLE=false
if command -v uv &> /dev/null || command -v uvx &> /dev/null; then
    UV_AVAILABLE=true
    ok "uv … OK（追加機能が使えます）"
else
    info "uv が見つかりません。一部の追加機能（Web検索など）は使えませんが、"
    info "メインの機能はすべて使えます。後から追加することもできます。"
fi

# Claude Code
if command -v claude &> /dev/null; then
    ok "Claude Code … OK"
else
    warn "Claude Code がみつかりません"
    warn "https://claude.ai/download からインストールしてください"
fi

# Ollama（SDD / LP 生成スキル用）
if command -v ollama &> /dev/null; then
    ok "Ollama がインストールされています"
    OLLAMA_MODELS=$(ollama list 2>/dev/null | tail -n +2 | awk '{print $1}' | head -5 | tr '\n' ', ' | sed 's/,$//')
    if [ -n "$OLLAMA_MODELS" ]; then
        info "利用可能モデル: ${OLLAMA_MODELS}"
    fi
else
    warn "Ollama が見つかりません（一部のスキルで必要です）"
    info "対象スキル: sdd-full / sdd-design / sdd-req100 / lp-full-generation / lp-local-generator"
    info "インストール: https://ollama.com/download"
fi

echo ""
ok "ソフトウェアの確認が完了しました"

# Opt-in telemetry: install_started (no-op unless user opted in)
if [ -f "$REPO_DIR/scripts/telemetry/emit.js" ]; then
    node "$REPO_DIR/scripts/telemetry/emit.js" install_started \
        --profile="$SKILL_PROFILE" >/dev/null 2>&1 || true
fi

# ─────────────────────────────────────────
# Step 2: ファイルのダウンロード・準備
# ─────────────────────────────────────────
step "ステップ 2/5：必要なファイルを準備しています（少し時間がかかります）"

echo ""
echo "  インターネットからファイルをダウンロードしています。"
echo "  ※ この作業中は画面に英語の文字が流れますが、正常です。"
echo ""

cd "$REPO_DIR"

echo "  📦 ファイルをダウンロード中..."
NPM_LOG="/tmp/taisun-npm-install-$(date +%s).log"

# Prefer `npm ci` for deterministic lockfile-based install when lock present
if [ -f "package-lock.json" ]; then
    NPM_INSTALL_CMD=(npm ci)
else
    NPM_INSTALL_CMD=(npm install)
fi

if "${NPM_INSTALL_CMD[@]}" 2>&1 | tee "$NPM_LOG"; then
    ok "ファイルのダウンロードが完了しました"
elif [ "$ALLOW_PARTIAL" = true ]; then
    warn "npm install に失敗しましたが --allow-partial 指定のため続行します"
    info "ログ: $NPM_LOG"
else
    diagnose_npm_log "$NPM_LOG"
    fail \
        "依存パッケージのインストールに失敗しました（ログ: $NPM_LOG）" \
        "ネットワーク接続を確認するか、--allow-partial で部分インストールを許可してください"
fi

echo ""
echo "  🔨 システムを構築中..."
# postinstall hook already runs build:all; --if-present makes this resilient
# when no top-level "build" script is declared.

if npm run build --if-present 2>&1; then
    ok "メインシステムの構築が完了しました"
elif [ "$ALLOW_PARTIAL" = true ]; then
    warn "ビルドに失敗しましたが --allow-partial 指定のため続行します"
else
    echo ""
    echo "  🔍 ビルド失敗時のヒント:"
    echo "     - 上記 TypeScript/tsc エラーを確認"
    echo "     - Node.js を最新 LTS に更新: brew upgrade node / nvm install --lts"
    echo "     - 破損した node_modules: rm -rf node_modules && npm install"
    fail \
        "システムビルドに失敗しました" \
        "上記のエラーを確認するか、--allow-partial で続行可能です"
fi

# 追加MCPサーバーのビルド
# Prefer npm ci for reproducible install when lockfile present, fall back to npm install otherwise.
for mcp_dir in "mcp-servers/voice-ai-mcp-server" "mcp-servers/ai-sdr-mcp-server" "mcp-servers/line-bot-mcp-server"; do
    if [ -f "$REPO_DIR/$mcp_dir/package.json" ]; then
        mcp_name=$(basename "$mcp_dir")
        if [ -f "$REPO_DIR/$mcp_dir/package-lock.json" ]; then
            mcp_install="npm ci --silent --prefer-offline --no-audit"
        else
            mcp_install="npm install --silent --prefer-offline --no-audit"
        fi
        (cd "$REPO_DIR/$mcp_dir" && $mcp_install && npm run build --if-present 2>/dev/null) && \
            ok "${mcp_name} の準備が完了しました" || \
            info "${mcp_name} の準備をスキップしました（APIキー設定後に使えます）"
    fi
done

# ─────────────────────────────────────────
# Step 3: スキル・エージェントの登録
# ─────────────────────────────────────────
step "ステップ 3/5：スキル・エージェントを登録しています"

echo ""
echo "  スキルとは「Claude への命令テンプレート」です。"
echo "  登録すると /リサーチ や /設計 などのコマンドが使えるようになります。"
echo ""

# プロファイルに基づく許可リスト生成（インジェクション安全な外部スクリプト経由）
PROFILE_FILE="$REPO_DIR/scripts/skill-profiles.json"
RESOLVER="$REPO_DIR/scripts/internal/profile-resolver.js"
ALLOWED_SKILLS=""

if [ -f "$PROFILE_FILE" ] && [ -f "$RESOLVER" ] && command -v node &> /dev/null; then
    ALLOWED_SKILLS=$(
        PROFILE_FILE="$PROFILE_FILE" \
        PROFILE="$SKILL_PROFILE" \
        EXTRAS="${EXTRA_PROFILES[*]}" \
        node "$RESOLVER" 2>/dev/null
    )
fi

# プロファイル情報を表示
echo "  📋 プロファイル: ${SKILL_PROFILE}"
if [ ${#EXTRA_PROFILES[@]} -gt 0 ]; then
    echo "     追加: ${EXTRA_PROFILES[*]}"
fi
echo ""
echo "  🔗 ~/.claude/skills/ フォルダを作成・更新しています"
echo "     ※ ~/.claude/ は Claude Code の設定フォルダです（システムが自動管理します）"
echo ""

TARGET_SKILLS="$HOME/.claude/skills"
SOURCE_SKILLS="$REPO_DIR/.claude/skills"
mkdir -p "$TARGET_SKILLS"

INSTALLED=0; UPDATED=0; SKIPPED=0; PROFILE_SKIPPED=0

if [ -d "$SOURCE_SKILLS" ]; then
    for skill_dir in "$SOURCE_SKILLS"/*/; do
        skill_name=$(basename "$skill_dir")
        [[ "$skill_name" == "_archived" ]] && continue
        [[ "$skill_name" == "_guides" ]] && continue
        [[ "$skill_name" == "data" ]] && continue
        [[ ! -f "$skill_dir/SKILL.md" ]] && [[ ! -f "$skill_dir/CLAUDE.md" ]] && continue

        # プロファイルフィルタ: 許可リストが空でない場合、リストにないスキルはスキップ
        if [ -n "$ALLOWED_SKILLS" ]; then
            if ! echo "$ALLOWED_SKILLS" | grep -qx "$skill_name"; then
                ((PROFILE_SKIPPED++)) || true
                continue
            fi
        fi

        target="$TARGET_SKILLS/$skill_name"
        if [ -d "$target" ] && [ ! -L "$target" ]; then rm -rf "$target"; fi

        if [ ! -L "$target" ]; then
            ln -sf "$skill_dir" "$target"
            ((INSTALLED++)) || true
        else
            current_target=$(readlink "$target")
            if [ "$current_target" != "$skill_dir" ]; then
                ln -sf "$skill_dir" "$target"
                ((UPDATED++)) || true
            else
                ((SKIPPED++)) || true
            fi
        fi
    done
fi

TOTAL_SKILLS=$(ls -d "$TARGET_SKILLS"/*/ 2>/dev/null | wc -l | tr -d ' ')
ok "スキルを登録しました（新規: ${INSTALLED}件 / 更新: ${UPDATED}件 / 合計: ${TOTAL_SKILLS}件）"
if [ "$PROFILE_SKIPPED" -gt 0 ]; then
    info "プロファイル外スキル: ${PROFILE_SKIPPED}件（--profile full で全て登録可能）"
fi

echo ""
echo "  🤖 ~/.claude/agents/ フォルダを作成・更新しています"
echo "     ※ エージェントとは「特定の仕事を自動で行うAI」です"
echo ""

TARGET_AGENTS="$HOME/.claude/agents"
SOURCE_AGENTS="$REPO_DIR/.claude/agent-source"
mkdir -p "$TARGET_AGENTS"

AGENT_INSTALLED=0; AGENT_UPDATED=0; AGENT_SKIPPED=0

if [ -d "$SOURCE_AGENTS" ]; then
    for agent_file in "$SOURCE_AGENTS"/*.md; do
        agent_name=$(basename "$agent_file")
        [[ "$agent_name" == "CLAUDE.md" ]] && continue
        target="$TARGET_AGENTS/$agent_name"
        # Replace symlinks with real copies to avoid double-loading in project directories
        if [ -L "$target" ]; then rm -f "$target"; fi
        if [ ! -f "$target" ]; then
            cp "$agent_file" "$target"
            ((AGENT_INSTALLED++)) || true
        elif ! diff -q "$agent_file" "$target" > /dev/null 2>&1; then
            cp "$agent_file" "$target"
            ((AGENT_UPDATED++)) || true
        else
            ((AGENT_SKIPPED++)) || true
        fi
    done
fi

TOTAL_AGENTS=$(ls "$TARGET_AGENTS"/*.md 2>/dev/null | wc -l | tr -d ' ')
ok "エージェントを登録しました（新規: ${AGENT_INSTALLED}件 / 更新: ${AGENT_UPDATED}件 / 合計: ${TOTAL_AGENTS}件）"

# ─────────────────────────────────────────
# Step 4: 設定ファイルの作成
# ─────────────────────────────────────────
step "ステップ 4/5：設定ファイルを作成しています"

echo ""
echo "  各種ツールの設定ファイルを準備します。"
echo ""

# フック
chmod +x "$REPO_DIR"/.claude/hooks/*.sh 2>/dev/null || true
chmod +x "$REPO_DIR"/.claude/hooks/*.js 2>/dev/null || true
mkdir -p "$REPO_DIR/.claude/temp" "$REPO_DIR/.claude/agent-memory" "$REPO_DIR/.taisun/memory"
ok "フック（自動実行設定）を準備しました"
info "  .claude/temp/        … 一時ファイル置き場"
info "  .claude/agent-memory/ … AIの作業メモ置き場"
info "  .taisun/memory/      … システムのメモリ置き場"

# .mcp.json
echo ""
if [ ! -f "$REPO_DIR/.mcp.json" ]; then
    cp "$REPO_DIR/.mcp.json.example" "$REPO_DIR/.mcp.json" 2>/dev/null || true
    ok ".mcp.json を作成しました（利用するツールの設定ファイル）"
else
    ok ".mcp.json はすでに存在します（既存の設定を保持しました）"
fi

# .env
echo ""
if [ ! -f "$REPO_DIR/.env" ]; then
    cp "$REPO_DIR/.env.example" "$REPO_DIR/.env" 2>/dev/null || touch "$REPO_DIR/.env"
    echo ""
    echo "  ┌─────────────────────────────────────────────────────────────┐"
    echo "  │  ⚠️  APIキーの設定が必要です（重要）                          │"
    echo "  └─────────────────────────────────────────────────────────────┘"
    echo ""
    echo "  .env ファイルを作成しました（一部のスクリプト・機能が使います）。"
    echo ""
    echo "  Claude Code を動かす方法は2通りあります："
    echo ""
    echo "  【方法1・おすすめ】ログインする（APIキー不要）"
    echo "    → Claude Code を開いて  /login  と入力するだけ"
    echo ""
    echo "  【方法2】APIキーを使う"
    echo "    ※ Claude Code はこの .env を自動では読み込みません。次のどちらかに設定："
    echo "      (A) ~/.zshrc に  export ANTHROPIC_API_KEY=sk-ant-api03-xxxxx  を追記"
    echo "      (B) ~/.claude/settings.json の \"env\" に ANTHROPIC_API_KEY を設定"
    echo "    取得先 → https://console.anthropic.com/"
    echo ""
    echo "  【MCPツールのキー（任意）】TAVILY / OPENAI / FIGMA 等"
    echo "    → ~/.claude/settings.json の \"env\" かシェルの export に設定"
    echo "      （.mcp.json の \${VAR} はシェル環境から読み込み、.env は対象外）"
    echo "    有料ツール（gpt-researcher/tavily/apify/firecrawl）は既定オフ。"
    echo "    使うときは .mcp.json で該当サーバーを \"disabled\": false に。"
    echo "    詳しい手順 → docs/API_KEY_TROUBLESHOOTING.md"
    echo ""
else
    ok ".env はすでに存在します（既存の設定を保持しました）"
    if grep -q "ANTHROPIC_API_KEY=sk-ant-" "$REPO_DIR/.env" 2>/dev/null; then
        ok "ANTHROPIC_API_KEY が .env にあります"
    else
        warn "ANTHROPIC_API_KEY が .env に見つかりません"
        warn "Claude Code で /login するか、~/.claude/settings.json かシェルに ANTHROPIC_API_KEY を設定してください"
        warn "詳細 → docs/API_KEY_TROUBLESHOOTING.md（.env は Claude Code に読まれません）"
    fi
fi

# MCP グローバル登録
echo ""
echo "  🔗 ツール（MCP）をClaude Codeに登録しています..."
echo "     ※ ~/.claude/settings.json に設定が書き込まれます"

SETTINGS_FILE="$HOME/.claude/settings.json"
mkdir -p "$(dirname "$SETTINGS_FILE")"

if [ "$FRESH_MODE" = true ]; then
    info "--fresh モード: 既存の MCP カスタマイズはテンプレートで上書きされます"
    node "$REPO_DIR/scripts/update-settings.js" "$REPO_DIR" "$SETTINGS_FILE" --fresh \
        || warn "ツールの登録に問題がありました（後から手動で設定できます）"
else
    node "$REPO_DIR/scripts/update-settings.js" "$REPO_DIR" "$SETTINGS_FILE" \
        || warn "ツールの登録に問題がありました（後から手動で設定できます）"
fi

# CodeGraph MCP パスをプロジェクト設定に自動書き換え
PROJ_SETTINGS="$REPO_DIR/.claude/settings.json"
CODEGRAPH_BIN="$REPO_DIR/tools/codebase-memory-mcp/codebase-memory-mcp"
if [ -f "$PROJ_SETTINGS" ] && [ -f "$CODEGRAPH_BIN" ]; then
    node -e "
const fs = require('fs');
const s = JSON.parse(fs.readFileSync('$PROJ_SETTINGS', 'utf8'));
if (s.mcpServers && s.mcpServers['codebase-memory']) {
  s.mcpServers['codebase-memory'].command = '$CODEGRAPH_BIN';
  fs.writeFileSync('$PROJ_SETTINGS', JSON.stringify(s, null, 2));
  console.log('  ✅ CodeGraph MCP パスを自動設定しました');
}
" 2>/dev/null
fi

# ─────────────────────────────────────────
# Step 5: 動作確認
# ─────────────────────────────────────────
step "ステップ 5/5：動作を確認しています"

echo ""

[ -f "$REPO_DIR/.claude/CLAUDE.md" ] && ok "設定ファイル (.claude/CLAUDE.md) … OK"

HOOK_OK=$(ls "$REPO_DIR/.claude/hooks/"*.js 2>/dev/null | wc -l | tr -d ' ')
if [ "$HOOK_OK" -gt 0 ]; then
    ok "フック: ${HOOK_OK} 個が利用可能です"
else
    warn "フック: ${HOOK_OK} 個（.claude/hooks/ が空の可能性）"
fi

SKILL_COUNT=$(ls -d "$TARGET_SKILLS"/*/ 2>/dev/null | wc -l | tr -d ' ')
EXPECTED_SKILLS=$(ls -d "$SOURCE_SKILLS"/*/ 2>/dev/null | grep -v '_archived' | grep -v 'data' | wc -l | tr -d ' ')
if [ "$SKILL_COUNT" -ge "$EXPECTED_SKILLS" ] 2>/dev/null; then
    ok "スキル: ${SKILL_COUNT} 個が利用可能です ✅（期待値: ${EXPECTED_SKILLS}個）"
elif [ "$SKILL_COUNT" -ge 50 ] 2>/dev/null; then
    warn "スキル: ${SKILL_COUNT} 個（期待値: ${EXPECTED_SKILLS}個 — 一部欠落の可能性）"
    info "全スキルを入れるには: ./scripts/install.sh --profile full"
else
    warn "スキル: ${SKILL_COUNT} 個（期待値: ${EXPECTED_SKILLS}個 — 大幅に不足しています）"
    warn "install.sh を再実行してください: ./scripts/install.sh"
fi

AGENT_COUNT=$(ls "$TARGET_AGENTS"/*.md 2>/dev/null | wc -l | tr -d ' ')
ok "エージェント: ${AGENT_COUNT} 個が利用可能です"

# ─────────────────────────────────────────
# 深部検証（symlink dangling、hook 参照、version 整合）
# ─────────────────────────────────────────
if [ "$SKIP_VERIFY" = true ]; then
    warn "--skip-verify 指定: 深部検証をスキップしました（自己責任）"
elif [ -f "$REPO_DIR/scripts/verify-installation.js" ]; then
    echo ""
    if ! node "$REPO_DIR/scripts/verify-installation.js" "$REPO_DIR" 2>&1; then
        echo ""
        echo "  🔍 検証失敗時のヒント:"
        echo "     - 上記 verify-installation.js の出力で失敗項目を確認"
        echo "     - 多くは部分インストール破損: ./scripts/install.sh --fresh で再構築"
        echo "     - 一時的に先に進める: --skip-verify"
        fail \
            "インストール検証に失敗しました" \
            "ログを確認して再実行するか、--skip-verify で検証を回避できます（推奨されません）"
    fi
fi

# ─────────────────────────────────────────
# Cluster A: TAISUN_AGENT_DIR を shell rc に永続化
# 既存スクリプト・スキルが `${TAISUN_AGENT_DIR}` を参照できるよう
# zsh/bash の rc ファイルに追記（idempotent）。CI ではスキップ。
# ─────────────────────────────────────────
if [ "${CI:-false}" != "true" ]; then
    PERSISTED_FILES=""
    for rcfile in "$HOME/.zshrc" "$HOME/.bashrc"; do
        [ -f "$rcfile" ] || continue
        # 既存行を削除（idempotent）
        if grep -q '^export TAISUN_AGENT_DIR=' "$rcfile" 2>/dev/null; then
            tmp_rc=$(mktemp) || continue
            grep -v '^export TAISUN_AGENT_DIR=' "$rcfile" > "$tmp_rc" && mv "$tmp_rc" "$rcfile"
        fi
        # 新規追加（値は実 install path）
        printf '\nexport TAISUN_AGENT_DIR=%q\n' "$REPO_DIR" >> "$rcfile"
        PERSISTED_FILES="$PERSISTED_FILES $(basename "$rcfile")"
    done
    if [ -n "$PERSISTED_FILES" ]; then
        ok "TAISUN_AGENT_DIR=$REPO_DIR を$PERSISTED_FILES に登録しました"
    fi
fi

# ─────────────────────────────────────────
# Opt-in telemetry: install_completed
# ─────────────────────────────────────────
if [ -f "$REPO_DIR/scripts/telemetry/emit.js" ]; then
    INSTALL_DURATION_MS=$(( ($(date +%s) - INSTALL_START_EPOCH) * 1000 ))
    node "$REPO_DIR/scripts/telemetry/emit.js" install_completed \
        --profile="$SKILL_PROFILE" \
        --duration_ms="$INSTALL_DURATION_MS" \
        --skill_count="${SKILL_COUNT:-0}" >/dev/null 2>&1 || true
fi

# ─────────────────────────────────────────
# 完了メッセージ
# ─────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   🎉  インストールが完了しました！  v${VERSION}                 ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  ┌──────────────────────────────────────────────────────────┐"
echo "  │  次にやること（3ステップ）                                │"
echo "  ├──────────────────────────────────────────────────────────┤"
echo "  │                                                          │"
echo "  │  1️⃣  Claude Code で /login（APIキー不要・おすすめ）      │"
echo "  │     → APIキーを使う場合は ~/.zshrc か                    │"
echo "  │       ~/.claude/settings.json に設定（.env は不可）      │"
echo "  │                                                          │"
echo "  │  2️⃣  Claude Code を開く（再起動が必要です）                │"
echo "  │     → Claude Code を一度閉じて、再度開いてください        │"
echo "  │                                                          │"
echo "  │  3️⃣  試しに使ってみる                                     │"
echo "  │     → チャット欄に「こんにちは」と入力してみる            │"
echo "  │     → /help と入力すると使い方が見られます                │"
echo "  │                                                          │"
echo "  └──────────────────────────────────────────────────────────┘"
echo ""
echo "  💡 よく使うコマンド："
echo "     /research      → 調査・リサーチ"
echo "     /mega-research → 複数ソースからの詳細調査"
echo "     /sdd-full      → 設計書の自動生成"
echo "     /help-expert   → 詳しい使い方を見る"
echo ""
echo "  🔄 アップデート方法："
echo "     npm run update                          # 推奨：既存設定を保持"
echo "     （git pull + ファイル更新のみ、~/.claude/settings.json は触らない）"
echo ""
echo "  🔧 MCP を完全にリセットする場合のみ："
echo "     npm run setup:fresh                     # ~/.claude/settings.json を上書き"
echo "     （破壊的操作。事前に自動バックアップされます）"
echo ""
echo "  📋 スキル構成の変更："
echo "     ./scripts/install.sh --list-profiles    # プロファイル一覧"
echo "     ./scripts/install.sh --profile minimal  # 最小構成に変更"
echo "     ./scripts/install.sh --profile full     # 全スキルに変更"
echo ""
echo "  ❓ 困ったときは："
echo "     困ったとき・何から始めるか迷ったときは、Claude Code で /guide と入力してください。"
echo "     npm run taisun:diagnose  → 問題の診断"
echo "     チャットで「使い方を教えて」と話しかける"
[ -n "${INSTALL_LOG:-}" ] && echo "  📝 ログファイル: $INSTALL_LOG"
echo ""
