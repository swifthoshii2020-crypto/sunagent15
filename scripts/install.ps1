# TAISUN Agent - Windowsインストールスクリプト (PowerShell)
#
# 使い方 (PowerShell):
#   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
#   .\scripts\install.ps1                    # 標準インストール
#   .\scripts\install.ps1 -Profile minimal   # 最小構成（coreのみ）
#   .\scripts\install.ps1 -Profile full      # 全スキル
#   .\scripts\install.ps1 -ListProfiles      # プロファイル一覧
#
# 必要なもの:
#   - Windows 10/11
#   - Node.js v18+ (https://nodejs.org/)
#   - Claude Code (https://claude.ai/download)
#   - PowerShell 5.1 以上

param(
    [Alias("Profile")]
    [string]$SkillProfile = "standard",
    [switch]$WithDocker,
    [switch]$WithFigma,
    [switch]$WithVoice,
    [switch]$WithDeepResearch,
    [switch]$ListProfiles,
    [switch]$Update,
    [switch]$Fresh,
    [switch]$Force,
    [switch]$AllowPartial,
    [switch]$SkipVerify
)

# PowerShell 5.1 UTF-8 出力対応
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# ErrorActionPreference を Continue に変更（1つの失敗で全体停止を防止）
$ErrorActionPreference = "Continue"

# TLS 1.2 強制（古い Windows 10 対応）
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$REPO_DIR = Split-Path -Parent $PSScriptRoot

# Cluster A: 公式 TAISUN_AGENT_DIR を現プロセスでも export
# （現プロセスから子プロセスへ伝播。永続化は完了処理直前で別途実施）
$env:TAISUN_AGENT_DIR = $REPO_DIR

$VERSION = (Get-Content "$REPO_DIR\package.json" | ConvertFrom-Json).version

if ($ListProfiles) {
    Write-Host ""
    Write-Host "  利用可能なプロファイル:"
    Write-Host ""
    Write-Host "  minimal   — コアスキルのみ（約92個）"
    Write-Host "              リサーチ・SDD・LP・コピーライティング・キーワード等"
    Write-Host ""
    Write-Host "  standard  — 標準構成（約114個）[デフォルト]"
    Write-Host "              core + 動画制作 + X/SNS自動投稿"
    Write-Host ""
    Write-Host "  full      — 全スキル（約121個）"
    Write-Host "              standard + Docker + Figma + 音声AI + ディープリサーチ拡張"
    Write-Host ""
    Write-Host "  追加オプション:"
    Write-Host "    -WithDocker          Docker/コンテナ運用"
    Write-Host "    -WithFigma           Figmaデザイン連携"
    Write-Host "    -WithVoice           音声AI・TTS"
    Write-Host "    -WithDeepResearch    ディープリサーチ拡張"
    Write-Host ""
    exit 0
}

# ─────────────────────────────────────────
# 表示ヘルパー関数
# ─────────────────────────────────────────
function Write-Ok   { param($msg) Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "  !!  $msg" -ForegroundColor Yellow }
function Write-Info { param($msg) Write-Host "  ->  $msg" -ForegroundColor Cyan }
function Write-Fail { param($msg) Write-Host "  NG  $msg" -ForegroundColor Red }
function Write-Step { param($msg) Write-Host ""; Write-Host "━━━ $msg ━━━" -ForegroundColor White }

# ─────────────────────────────────────────
# 共通ヘルパー: BOM 安全な JSON 修復・書き出し
#   PowerShell 5.1 の Set-Content -Encoding UTF8 は BOM を付与するため、
#   .NET API を直接呼んで UTF-8 (no BOM) で書き出す。
#   ref: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/set-content
# ─────────────────────────────────────────
function Write-Utf8NoBom {
    param([string]$Path, [string]$Content)
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function Repair-JsonFile {
    param([string]$Path, [string]$Label = "JSON file")
    if (-not (Test-Path $Path)) { return $true }
    try {
        $bytes = [System.IO.File]::ReadAllBytes($Path)
        if ($bytes.Length -eq 0) { return $true }
        $needsRewrite = $false

        # UTF-8 BOM (EF BB BF) を検出して除去
        if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
            $bytes = $bytes[3..($bytes.Length - 1)]
            $needsRewrite = $true
            Write-Info "${Label}: BOM を検出。除去します ($Path)"
        }
        # UTF-16 LE BOM (FF FE) も検出（救出は手動）
        elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) {
            $backup = "${Path}.utf16-broken-$(Get-Date -Format 'yyyyMMdd-HHmmss').bak"
            [System.IO.File]::Copy($Path, $backup, $true)
            Write-Warn "${Label}: UTF-16 でエンコードされています。バックアップ: $backup"
            Write-Warn "${Label} を空の {} で初期化します（バックアップから手動復元可能）"
            Write-Utf8NoBom -Path $Path -Content "{}"
            return $true
        }

        $text = [System.Text.Encoding]::UTF8.GetString($bytes)
        try {
            $null = $text | ConvertFrom-Json -ErrorAction Stop
        } catch {
            $backup = "${Path}.broken-$(Get-Date -Format 'yyyyMMdd-HHmmss').bak"
            [System.IO.File]::Copy($Path, $backup, $true)
            Write-Warn "${Label} が JSON として壊れています。バックアップ: $backup"
            Write-Warn "${Label} を空の {} で初期化します（バックアップから手動復元可能）"
            Write-Utf8NoBom -Path $Path -Content "{}"
            return $true
        }

        if ($needsRewrite) {
            Write-Utf8NoBom -Path $Path -Content $text
            Write-Ok "${Label}: BOM を除去して保存しました"
        }
        return $true
    } catch {
        Write-Warn "${Label} の修復処理でエラー: $($_.Exception.Message)"
        return $false
    }
}

# ─────────────────────────────────────────
# 共通ヘルパー: Junction の古いリンクを安全に更新
#   ReparsePoint を Remove-Item -Recurse で消すと「リンク先のファイルが消える」事故を起こすため、
#   Junction を消すときは [System.IO.Directory]::Delete($path, $false) を使う。
#   ref: https://learn.microsoft.com/en-us/dotnet/api/system.io.directory.delete
# ─────────────────────────────────────────
function Remove-LinkOrDirectory {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return }
    $item = Get-Item -LiteralPath $Path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        # Junction / Symlink: リンクのみ削除（ターゲットは温存）
        [System.IO.Directory]::Delete($Path, $false)
    } else {
        Remove-Item -LiteralPath $Path -Recurse -Force
    }
}

function Test-JunctionTargetMatches {
    param([string]$LinkPath, [string]$ExpectedTarget)
    try {
        $item = Get-Item -LiteralPath $LinkPath -Force
        if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return $false }
        $current = $item.Target
        if ($current -is [array]) { $current = $current[0] }
        if (-not $current) { return $false }
        $normCurrent  = [System.IO.Path]::GetFullPath($current).TrimEnd('\')
        $normExpected = [System.IO.Path]::GetFullPath($ExpectedTarget).TrimEnd('\')
        return ($normCurrent -ieq $normExpected)
    } catch {
        return $false
    }
}

# ─────────────────────────────────────────
# 共通ヘルパー: 古い install フォルダを指す MCP サーバーのパスを
#               現在の $REPO_DIR に張り替える。
# 例: "C:\Users\mitsu\taisun_agent\mcp-servers\..." → "C:\Users\mitsu\sunagent15\mcp-servers\..."
# 検出ルール: 絶対パスかつ
#             (a) $REPO_DIR で始まらない
#             (b) `\mcp-servers\` / `\dist\` を含む
# のものを「内部 MCP サーバーへの参照だが旧パス」とみなして書き換える。
# ユーザー独自の MCP サーバー（リポ外を指すもの）は触らない。
# ─────────────────────────────────────────
function Repair-McpServerPaths {
    param([string]$SettingsPath, [string]$RepoDir)
    if (-not (Test-Path $SettingsPath)) { return }

    # 安全のため「リポジトリが提供する MCP サーバー」だけを対象にする。
    # ユーザーが独自に登録した MCP サーバーは触らない。
    # (.mcp.json.example の mcpServers セクションから抽出した既知リスト)
    $KNOWN_INTERNAL_MCPS = @(
        'taisun-proxy',
        'line-bot',
        'voice-ai',
        'ai-sdr',
        'codebase-memory'
    )

    try {
        $raw = Get-Content $SettingsPath -Raw
        if (-not $raw -or $raw.Trim().Length -eq 0) { return }
        $json = $raw | ConvertFrom-Json -ErrorAction Stop
    } catch {
        Write-Warn "MCP パスマイグレーション: settings.json をパースできず、スキップしました"
        return
    }
    if (-not $json.mcpServers) { return }

    $normRepo = [System.IO.Path]::GetFullPath($RepoDir).TrimEnd('\')
    $changes = 0
    $serverNames = @($json.mcpServers.PSObject.Properties.Name) |
        Where-Object { $KNOWN_INTERNAL_MCPS -contains $_ }

    foreach ($name in $serverNames) {
        $server = $json.mcpServers.$name
        if (-not $server -or -not $server.args) { continue }

        $newArgs = @()
        $modified = $false
        foreach ($arg in $server.args) {
            $newArg = $arg
            if ($arg -is [string] -and $arg -match '^[A-Za-z]:[\\/]') {
                $argNorm = $arg -replace '/', '\'
                $isInRepo = $argNorm.StartsWith($normRepo, [StringComparison]::OrdinalIgnoreCase)
                if (-not $isInRepo) {
                    if ($argNorm -match '[\\](mcp-servers[\\].*|dist[\\].*)$') {
                        $relative = $Matches[1]
                        $candidate = Join-Path $normRepo $relative
                        if (Test-Path $candidate) {
                            $newArg = $candidate
                            $modified = $true
                            Write-Info "MCP マイグレーション: ${name} → $candidate"
                        }
                    }
                }
            }
            $newArgs += $newArg
        }
        if ($modified) {
            $server.args = $newArgs
            $changes++
        }
    }

    if ($changes -gt 0) {
        try {
            Write-Utf8NoBom -Path $SettingsPath -Content ($json | ConvertTo-Json -Depth 20)
            Write-Ok "MCP サーバーパスを ${changes} 件 ${normRepo} に書き換えました"
        } catch {
            Write-Warn "MCP パス書き戻しに失敗: $($_.Exception.Message)"
        }
    }
}

# Opt-in telemetry helper (no-op unless user opted in via manage.js or env var)
$script:InstallStartEpoch = [int]([DateTimeOffset]::Now.ToUnixTimeSeconds())
function Emit-Telemetry {
    param([string]$EventType, [hashtable]$Fields = @{})
    $emitter = Join-Path $REPO_DIR 'scripts\telemetry\emit.js'
    if (-not (Test-Path $emitter)) { return }
    $args = @($emitter, $EventType)
    foreach ($k in $Fields.Keys) {
        $args += "--$k=$($Fields[$k])"
    }
    try { & node @args *>$null } catch { }
}

# ─────────────────────────────────────────
# アップデートモード（-Update フラグ時）
# ─────────────────────────────────────────
if ($Update) {
    Write-Host ""
    Write-Host "  TAISUN Agent アップデート (Windows)" -ForegroundColor Cyan
    Write-Host ""

    # git pull を試行、失敗したら強制同期、それもダメならZIPフォールバック
    Write-Host "  最新版を取得しています..."
    try {
        git fetch origin 2>&1 | Out-Null
        $gitResult = git pull origin main --ff-only 2>&1
        if ($LASTEXITCODE -ne 0) { throw "git pull failed" }
        Write-Ok "git pull 成功"
    } catch {
        Write-Info "通常の更新ができませんでした。"
        # Safety: check for uncommitted local changes before destructive reset
        $localChanges = git status --porcelain 2>$null
        if ($localChanges -and -not $Force) {
            Write-Warn "ローカルに未コミットの変更があります:"
            $localChanges | Select-Object -First 10 | ForEach-Object { Write-Host "    $_" }
            Write-Fail "強制同期は中断されました。次のいずれかを実行してください:"
            Write-Host "    1) 変更をコミット/退避してから再実行"
            Write-Host "    2) git stash で退避"
            Write-Host "    3) -Force を付けて再実行（ローカル変更は失われます）"
            exit 1
        }
        Write-Info "最新版に強制同期します..."
        try {
            git reset --hard origin/main 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "reset failed" }
            Write-Ok "最新版に同期しました"
        } catch {
        Write-Warn "git同期に失敗しました。ZIPダウンロードで更新します..."

        $zipUrl = "https://github.com/taiyousan15/sunagent15/archive/refs/heads/main.zip"
        $zipPath = "$env:TEMP\sunagent15_update.zip"
        $extractPath = "$env:TEMP\sunagent15_extract"

        try {
            Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
            if (Test-Path $extractPath) { Remove-Item $extractPath -Recurse -Force }
            Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

            $sourceDir = Get-ChildItem $extractPath -Directory | Select-Object -First 1
            Get-ChildItem $sourceDir.FullName -Force | ForEach-Object {
                $dest = Join-Path $REPO_DIR $_.Name
                if ($_.PSIsContainer) {
                    if ($_.Name -eq "node_modules" -or $_.Name -eq ".git") { return }
                    Copy-Item $_.FullName -Destination $dest -Recurse -Force
                } else {
                    Copy-Item $_.FullName -Destination $dest -Force
                }
            }
            Write-Ok "ZIPダウンロードで更新しました"
            Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
            Remove-Item $extractPath -Recurse -Force -ErrorAction SilentlyContinue
        } catch {
            Write-Fail "更新に失敗しました: $_"
            Write-Info "手動でZIPをダウンロードしてください: $zipUrl"
            exit 1
        }
    }}
    Write-Host ""
    Write-Host "  引き続きインストールを実行します..." -ForegroundColor Cyan
    Write-Host ""
}

# ─────────────────────────────────────────
# ヘッダー
# ─────────────────────────────────────────
# Clear-Host は使わない（Claude Code内でログが消えるのを防ぐ）
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     TAISUN Agent インストール (Windows)            ║" -ForegroundColor Cyan
Write-Host "║     バージョン：v$VERSION                              ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "  このスクリプトが行うこと："
Write-Host "  1. 必要なソフトウェアの確認"
Write-Host "  2. ファイルのダウンロード・インストール"
Write-Host "  3. スキル・エージェントのセットアップ"
Write-Host "  4. API キーの設定"
Write-Host "  5. 動作確認"
Write-Host ""
Write-Host "  ⚠  途中で文字が流れますが正常な動作です。"
Write-Host "     最後まで待ってください。"
Write-Host ""
Write-Host "  3秒後に自動で開始します..."
Start-Sleep -Seconds 3
Write-Host ""

# ─────────────────────────────────────────
# ステップ 1: 必要なソフトウェアの確認
# ─────────────────────────────────────────
Write-Step "ステップ 1/5：必要なソフトウェアを確認しています"
Write-Host ""

# Node.js
try {
    $nodeVersion = (node -v 2>$null).TrimStart('v').Split('.')[0]
    if ([int]$nodeVersion -lt 18) {
        Write-Fail "Node.js v18 以上が必須です（現在: $(node -v)）"
        Write-Host ""
        Write-Host "  更新方法:"
        Write-Host "    winget upgrade OpenJS.NodeJS.LTS"
        Write-Host "    または https://nodejs.org/ から LTS版をダウンロード"
        Write-Host ""
        exit 1
    }
    Write-Ok "Node.js $(node -v) がインストールされています"
} catch {
    Write-Fail "Node.js がインストールされていません"
    Write-Host ""
    Write-Host "  ┌──────────────────────────────────────────────────────────┐"
    Write-Host "  │  Node.js のインストール方法                               │"
    Write-Host "  ├──────────────────────────────────────────────────────────┤"
    Write-Host "  │  1. https://nodejs.org/ を開く                            │"
    Write-Host "  │  2. 「LTS（推奨版）」をクリックしてダウンロード           │"
    Write-Host "  │  3. ダウンロードした .msi ファイルを実行                  │"
    Write-Host "  │  4. インストール完了後、このスクリプトを再実行            │"
    Write-Host "  └──────────────────────────────────────────────────────────┘"
    Write-Host ""
    exit 1
}

# npm
try {
    $npmV = npm -v 2>$null
    Write-Ok "npm $npmV がインストールされています"
} catch {
    Write-Fail "npm がインストールされていません（Node.js と一緒にインストールされるはずです）"
    exit 1
}

# uv（省略可能）
$UV_AVAILABLE = $false
if (Get-Command uv -ErrorAction SilentlyContinue) {
    $UV_AVAILABLE = $true
    Write-Ok "uv がインストールされています"
} else {
    Write-Warn "uv が見つかりません（Python系の一部機能が使えません）"
    Write-Info "後でインストールする場合: winget install astral-sh.uv"
}

# Claude Code
if (Get-Command claude -ErrorAction SilentlyContinue) {
    Write-Ok "Claude Code がインストールされています"
} else {
    Write-Warn "Claude Code が見つかりません"
    Write-Info "https://claude.ai/download からインストールしてください"
}

# Python3（intelligence-research スキル用）
if (Get-Command python3 -ErrorAction SilentlyContinue) {
    Write-Ok "Python3 がインストールされています"
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    Write-Ok "Python がインストールされています"
} else {
    Write-Warn "Python が見つかりません（intelligence-research スキルが使えない場合があります）"
    Write-Info "https://www.python.org/ からインストールできます"
}

# Ollama（SDD / LP 生成スキル用）
if (Get-Command ollama -ErrorAction SilentlyContinue) {
    Write-Ok "Ollama がインストールされています"
    try {
        $ollamaModels = (ollama list 2>$null | Select-Object -Skip 1 | Select-Object -First 5 | ForEach-Object { ($_ -split '\s+')[0] }) -join ', '
        if ($ollamaModels) { Write-Info "利用可能モデル: $ollamaModels" }
    } catch {}
} else {
    Write-Warn "Ollama が見つかりません（一部のスキルで必要です）"
    Write-Info "対象スキル: sdd-full / sdd-design / sdd-req100 / lp-full-generation / lp-local-generator"
    Write-Info "インストール: https://ollama.com/download"
}

# Opt-in telemetry: install_started
Emit-Telemetry 'install_started' @{ profile = $SkillProfile }

# ─────────────────────────────────────────
# ステップ 2: ファイルのインストール
# ─────────────────────────────────────────
Write-Step "ステップ 2/5：ファイルをインストールしています（少し時間がかかります）"

Write-Host ""
Write-Host "  📦 必要なファイルをダウンロードしています..."
Set-Location $REPO_DIR
$npmLog = "$REPO_DIR\npm-install.log"
# Prefer `npm ci` for deterministic lockfile-based install when lock present
$npmCmd = if (Test-Path "$REPO_DIR\package-lock.json") { 'ci' } else { 'install' }
try {
    $npmOutput = & npm $npmCmd 2>&1
    $npmOutput | Out-File $npmLog -Encoding UTF8
    if ($LASTEXITCODE -ne 0) { throw "npm $npmCmd failed (exit $LASTEXITCODE)" }
    Write-Ok "ファイルのインストールが完了しました"
} catch {
    Write-Warn ("npm " + $npmCmd + " で問題が発生しました: " + $_)
    Write-Info "詳細ログ: $npmLog"
    if (Test-Path $npmLog) {
        Get-Content $npmLog -Tail 10 | ForEach-Object { Write-Host "       $_" -ForegroundColor Gray }
    }
    if ($AllowPartial) {
        Write-Warn "-AllowPartial 指定のため続行します"
    } else {
        Write-Fail "依存パッケージのインストールに失敗しました。"
        Write-Host "    ネットワークを確認するか、-AllowPartial で部分インストールを許可してください。"
        exit 1
    }
}

Write-Host ""
Write-Host "  🔨 システムを構築しています..."
# postinstall hook already runs build:all; --if-present makes this resilient
# when no top-level "build" script is declared.
try {
    npm run build --if-present 2>&1 | Tee-Object -Variable buildOutput | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)" }
    Write-Ok "システムの構築が完了しました"
} catch {
    if ($AllowPartial) {
        Write-Warn "ビルドに失敗しましたが -AllowPartial 指定のため続行します: $_"
    } else {
        Write-Fail "システムビルドに失敗しました: $_"
        Write-Host "    上記のエラーを確認するか、-AllowPartial で続行できます"
        exit 1
    }
}

# Prefer npm ci for reproducible install when lockfile present, fall back to npm install otherwise.
foreach ($server in @("voice-ai-mcp-server", "ai-sdr-mcp-server", "line-bot-mcp-server")) {
    $serverPath = "$REPO_DIR\mcp-servers\$server\package.json"
    if (Test-Path $serverPath) {
        try {
            Push-Location "$REPO_DIR\mcp-servers\$server"
            $lockPath = "$REPO_DIR\mcp-servers\$server\package-lock.json"
            if (Test-Path $lockPath) {
                npm ci --silent --prefer-offline --no-audit 2>$null
            } else {
                npm install --silent --prefer-offline --no-audit 2>$null
            }
            npm run build --if-present 2>$null
            Write-Ok "$server を構築しました"
        } catch {
            Write-Info "$server の構築をスキップしました"
        } finally {
            Pop-Location
        }
    }
}

# ─────────────────────────────────────────
# ステップ 3: スキル・エージェントのセットアップ
# ─────────────────────────────────────────
Write-Step "ステップ 3/5：スキル・エージェントをセットアップしています"

Write-Host ""

# --- スキルのインストール ---
$TARGET_SKILLS = "$env:USERPROFILE\.claude\skills"
$SOURCE_SKILLS = "$REPO_DIR\.claude\skills"

# プロファイルに基づく許可リスト生成
$PROFILE_FILE = "$REPO_DIR\scripts\skill-profiles.json"
$ALLOWED_SKILLS = @()

if (Test-Path $PROFILE_FILE) {
    try {
        $profileData = Get-Content $PROFILE_FILE -Raw | ConvertFrom-Json
        $presetGroups = $profileData.presets.$SkillProfile
        if (-not $presetGroups) { $presetGroups = $profileData.presets.standard }

        $extraProfiles = @()
        if ($WithDocker) { $extraProfiles += "docker" }
        if ($WithFigma) { $extraProfiles += "figma" }
        if ($WithVoice) { $extraProfiles += "voice" }
        if ($WithDeepResearch) { $extraProfiles += "deep-research" }

        $activeGroups = @($presetGroups) + $extraProfiles | Select-Object -Unique
        foreach ($group in $activeGroups) {
            $groupObj = $profileData.profiles | Select-Object -ExpandProperty $group -ErrorAction SilentlyContinue
            if ($groupObj) {
                $ALLOWED_SKILLS += $groupObj.skills
            }
        }
        $ALLOWED_SKILLS = $ALLOWED_SKILLS | Select-Object -Unique
    } catch {
        Write-Warn "プロファイル読み込みエラー: 全スキルをインストールします"
    }
}

Write-Host "  スキルを設定しています..."
Write-Host "  📋 プロファイル: $SkillProfile"
Write-Info "スキルの保存先: $TARGET_SKILLS"
Write-Host "       （Claude Code が使うスキルが入るフォルダです）"
Write-Host ""

if (-not (Test-Path $TARGET_SKILLS)) {
    New-Item -ItemType Directory -Path $TARGET_SKILLS -Force | Out-Null
    Write-Ok "$TARGET_SKILLS フォルダを作成しました"
}

$INSTALLED = 0
$UPDATED = 0
$SKIPPED = 0
$PROFILE_SKIPPED = 0

if (Test-Path $SOURCE_SKILLS) {
    Get-ChildItem -Path $SOURCE_SKILLS -Directory | ForEach-Object {
        $skillName = $_.Name
        $skillDir = $_.FullName

        # 内部ディレクトリをスキップ
        if ($skillName -in @("_archived", "_guides", "data")) { return }

        # SKILL.md または CLAUDE.md があるものだけ
        if (-not (Test-Path "$skillDir\SKILL.md") -and -not (Test-Path "$skillDir\CLAUDE.md")) { return }

        # プロファイルフィルタ
        if ($ALLOWED_SKILLS.Count -gt 0 -and $skillName -notin $ALLOWED_SKILLS) {
            $PROFILE_SKIPPED++
            return
        }

        $target = "$TARGET_SKILLS\$skillName"

        # 既存ターゲットの状態を判定
        #  - 通常ディレクトリ → 削除して Junction で置き換え
        #  - Junction だが別フォルダ (例: 旧 taisun_agent インストール) を指している → 削除して再作成
        #  - Junction かつ現在のソースを正しく指している → スキップ
        if (Test-Path $target) {
            $isReparse = (Get-Item -LiteralPath $target -Force).Attributes -band [IO.FileAttributes]::ReparsePoint
            if (-not $isReparse) {
                # 通常ディレクトリ → 削除
                Remove-Item -LiteralPath $target -Recurse -Force
            } elseif (-not (Test-JunctionTargetMatches -LinkPath $target -ExpectedTarget $skillDir)) {
                # 古い Junction (別インストール先を指す) → リンクのみ削除して再作成
                Remove-LinkOrDirectory -Path $target
            }
        }

        if (-not (Test-Path $target)) {
            # Junction リンクを作成（失敗時はコピーにフォールバック）
            try {
                New-Item -ItemType Junction -Path $target -Target $skillDir | Out-Null
            } catch {
                Copy-Item $skillDir -Destination $target -Recurse -Force
            }
            $INSTALLED++
        } else {
            $SKIPPED++
        }
    }

    $total = @(Get-ChildItem $TARGET_SKILLS -Directory -ErrorAction SilentlyContinue).Count
    Write-Ok "スキルを設定しました（新規: ${INSTALLED}件 / スキップ: ${SKIPPED}件 / 合計: ${total}件）"
    if ($PROFILE_SKIPPED -gt 0) {
        Write-Info "プロファイル外スキル: ${PROFILE_SKIPPED}件（-Profile full で全て登録可能）"
    }
} else {
    Write-Warn "スキルのソースフォルダが見つかりません: $SOURCE_SKILLS"
}

Write-Host ""

# --- エージェントのインストール ---
$TARGET_AGENTS = "$env:USERPROFILE\.claude\agents"
$SOURCE_AGENTS = "$REPO_DIR\.claude\agent-source"

Write-Host "  エージェントを設定しています..."
Write-Info "エージェントの保存先: $TARGET_AGENTS"
Write-Host "       （Claude Code が使うエージェントが入るフォルダです）"
Write-Host ""

if (-not (Test-Path $TARGET_AGENTS)) {
    New-Item -ItemType Directory -Path $TARGET_AGENTS -Force | Out-Null
    Write-Ok "$TARGET_AGENTS フォルダを作成しました"
}

$AGENT_INSTALLED = 0

if (Test-Path $SOURCE_AGENTS) {
    Get-ChildItem -Path $SOURCE_AGENTS -Filter "*.md" | ForEach-Object {
        if ($_.Name -eq "CLAUDE.md") { return }

        $target = "$TARGET_AGENTS\$($_.Name)"
        Copy-Item $_.FullName -Destination $target -Force
        $AGENT_INSTALLED++
    }
    $total = @(Get-ChildItem $TARGET_AGENTS -Filter "*.md" -ErrorAction SilentlyContinue).Count
    Write-Ok "エージェントを設定しました（更新: ${AGENT_INSTALLED}件 / 合計: ${total}件）"
    Write-Info "Windows版はエージェントをコピーしています。git pull 後に再実行して更新してください。"
}

# --- 作業用ディレクトリの作成 ---
Write-Host ""
Write-Host "  作業用フォルダを作成しています..."

$dirs = @(
    @{ Path = "$REPO_DIR\.claude\temp";         Desc = "一時ファイル用" },
    @{ Path = "$REPO_DIR\.claude\agent-memory"; Desc = "エージェントの記憶保存用" },
    @{ Path = "$REPO_DIR\.taisun\memory";       Desc = "システムの記憶保存用" }
)
foreach ($dir in $dirs) {
    if (-not (Test-Path $dir.Path)) {
        New-Item -ItemType Directory -Path $dir.Path -Force | Out-Null
        Write-Ok "$($dir.Path) を作成しました（$($dir.Desc)）"
    }
}

# ─────────────────────────────────────────
# ステップ 4: API キーの設定
# ─────────────────────────────────────────
Write-Step "ステップ 4/5：API キーを設定しています"

Write-Host ""
Write-Host "  📝 設定ファイル (.mcp.json) を準備しています..."

if (-not (Test-Path "$REPO_DIR\.mcp.json")) {
    if (Test-Path "$REPO_DIR\.mcp.json.example") {
        Copy-Item "$REPO_DIR\.mcp.json.example" "$REPO_DIR\.mcp.json"
        Write-Ok ".mcp.json をテンプレートから作成しました"
    }
} else {
    Write-Ok ".mcp.json は既に存在します"
}

Write-Host ""
Write-Host "  🔑 環境変数ファイル (.env) を準備しています..."

if (-not (Test-Path "$REPO_DIR\.env")) {
    if (Test-Path "$REPO_DIR\.env.example") {
        Copy-Item "$REPO_DIR\.env.example" "$REPO_DIR\.env"
    } else {
        New-Item -ItemType File -Path "$REPO_DIR\.env" | Out-Null
    }

    Write-Host ""
    Write-Host "  ┌──────────────────────────────────────────────────────────────┐"
    Write-Host "  │  ⚠  ANTHROPIC_API_KEY の設定が必要です                      │"
    Write-Host "  ├──────────────────────────────────────────────────────────────┤"
    Write-Host "  │  1. https://console.anthropic.com/ を開く                    │"
    Write-Host "  │  2. 「API Keys」→「Create Key」でキーを発行                  │"
    Write-Host "  │  3. 以下のファイルをメモ帳で開いて編集:                      │"
    Write-Host "  │     $REPO_DIR\.env"
    Write-Host "  │  4. ANTHROPIC_API_KEY=sk-ant-... の行を追記                  │"
    Write-Host "  └──────────────────────────────────────────────────────────────┘"
    Write-Host ""
    Write-Host "  オプション（設定するとより多くの機能が使えます）："
    Write-Host "  ┌──────────────────────────────────────────────────────────────┐"
    Write-Host "  │  FRED_API_KEY    → 経済指標の取得 (fred.stlouisfed.org 無料) │"
    Write-Host "  │  NEWSAPI_KEY     → ニュース収集 (newsapi.org 無料枠あり)     │"
    Write-Host "  │  APIFY_TOKEN     → X/Twitter のデータ収集 (apify.com)        │"
    Write-Host "  └──────────────────────────────────────────────────────────────┘"
} else {
    Write-Ok ".env は既に存在します"
    $envContent = Get-Content "$REPO_DIR\.env" -Raw
    if ($envContent -match "ANTHROPIC_API_KEY=sk-ant-") {
        Write-Ok "ANTHROPIC_API_KEY が設定されています"
    } else {
        Write-Warn "ANTHROPIC_API_KEY がまだ設定されていません"
        Write-Info ".env ファイルに ANTHROPIC_API_KEY=sk-ant-... を追記してください"
    }
}

# MCPをグローバル登録
Write-Host ""
Write-Host "  🔌 MCPサーバーをグローバル登録しています..."
Write-Info "登録先: $env:USERPROFILE\.claude\settings.json"
Write-Host "       （Claude Code が自動的に読み込む設定ファイルです）"

$SETTINGS_FILE = "$env:USERPROFILE\.claude\settings.json"
$settingsDir = Split-Path $SETTINGS_FILE
if (-not (Test-Path $settingsDir)) {
    New-Item -ItemType Directory -Path $settingsDir -Force | Out-Null
    Write-Ok "$settingsDir フォルダを作成しました"
}

# Pre-flight: BOM 除去 + JSON 健全性チェック
#   PowerShell 5.1 系で過去に書かれたファイルは BOM 付きの可能性があり、
#   ConvertFrom-Json / Node 側の JSON.parse がエラーで落ちる原因になる。
#   壊れていればバックアップを取って空 {} で初期化（ユーザーが手動復元可能）。
Repair-JsonFile -Path $SETTINGS_FILE -Label "user settings.json" | Out-Null

# Use shared update-settings.js for non-destructive merge with backup
# (replaces previous inline overwrite that destroyed user MCP customizations).
# Behavior parity with macOS install.sh:434-438.
$updateScript = Join-Path $REPO_DIR 'scripts\update-settings.js'
if (-not (Test-Path $updateScript)) {
    Write-Warn "update-settings.js が見つかりません。MCP登録をスキップします。"
} else {
    if ($Fresh) {
        Write-Info "--Fresh モード: 既存の MCP カスタマイズはテンプレートで上書きされます"
        & node $updateScript $REPO_DIR $SETTINGS_FILE --fresh
    } else {
        & node $updateScript $REPO_DIR $SETTINGS_FILE
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "MCPのグローバル登録に問題がありました（後から手動設定もできます）"
    }

    # 旧 taisun_agent などのフォルダを指す MCP サーバーのパスを現在の REPO_DIR に張り替える
    # (taisun-proxy / line-bot / voice-ai / ai-sdr 等、内部 MCP サーバー専用)
    Repair-McpServerPaths -SettingsPath $SETTINGS_FILE -RepoDir $REPO_DIR
}

# CodeGraph MCP パスをプロジェクト設定に自動書き換え
$PROJ_SETTINGS = "$REPO_DIR\.claude\settings.json"
$CODEGRAPH_BIN = "$REPO_DIR\tools\codebase-memory-mcp\codebase-memory-mcp"
if ((Test-Path $PROJ_SETTINGS) -and (Test-Path $CODEGRAPH_BIN)) {
    # Pre-flight: BOM 除去 + JSON 健全性チェック
    Repair-JsonFile -Path $PROJ_SETTINGS -Label "project settings.json" | Out-Null
    try {
        $projSettings = Get-Content $PROJ_SETTINGS -Raw | ConvertFrom-Json
        if ($projSettings.mcpServers -and $projSettings.mcpServers.'codebase-memory') {
            $projSettings.mcpServers.'codebase-memory'.command = $CODEGRAPH_BIN
            # UTF-8 (no BOM) で書き出し。PS5.1 の Set-Content -Encoding UTF8 は BOM を付与してしまうため使わない。
            Write-Utf8NoBom -Path $PROJ_SETTINGS -Content ($projSettings | ConvertTo-Json -Depth 10)
            Write-Ok "CodeGraph MCP パスを自動設定しました"
        }
    } catch {
        Write-Warn "CodeGraph MCP パス設定をスキップしました"
    }
}

# ─────────────────────────────────────────
# ステップ 5: 動作確認
# ─────────────────────────────────────────
Write-Step "ステップ 5/5：動作を確認しています"

Write-Host ""

if (Test-Path "$REPO_DIR\.claude\CLAUDE.md") {
    Write-Ok "設定ファイルが正しく配置されています"
}

$SKILL_COUNT = @(Get-ChildItem $TARGET_SKILLS -Directory -ErrorAction SilentlyContinue).Count
$EXPECTED_SKILLS = @(Get-ChildItem $SOURCE_SKILLS -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -notin @("_archived", "_guides", "data") } | Where-Object { (Test-Path "$($_.FullName)\SKILL.md") -or (Test-Path "$($_.FullName)\CLAUDE.md") }).Count
if ($SKILL_COUNT -ge $EXPECTED_SKILLS) {
    Write-Ok "スキル: $SKILL_COUNT 個が利用可能です（期待値: ${EXPECTED_SKILLS}個）"
} elseif ($SKILL_COUNT -ge 50) {
    Write-Warn "スキル: $SKILL_COUNT 個（期待値: ${EXPECTED_SKILLS}個 — 一部欠落の可能性）"
    Write-Info "全スキルを入れるには: .\scripts\install.ps1 -Profile full"
} else {
    Write-Warn "スキル: $SKILL_COUNT 個（期待値: ${EXPECTED_SKILLS}個 — 大幅に不足しています）"
    Write-Warn "install.ps1 を再実行してください: .\scripts\install.ps1"
}

$AGENT_COUNT = (Get-ChildItem $TARGET_AGENTS -Filter "*.md" -ErrorAction SilentlyContinue).Count
Write-Ok "エージェント: $AGENT_COUNT 個が利用可能です"

# ─────────────────────────────────────────
# Cluster A: TAISUN_AGENT_DIR を $PROFILE に永続化
# 既存スクリプト・スキルが $env:TAISUN_AGENT_DIR を参照できるよう
# PowerShell プロファイルに追記（idempotent）。CI ではスキップ。
# ─────────────────────────────────────────
if (-not $env:CI) {
    try {
        $profilePath = $PROFILE
        $profileDir = Split-Path -Parent $profilePath
        if (-not (Test-Path $profileDir)) {
            New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
        }
        if (-not (Test-Path $profilePath)) {
            New-Item -ItemType File -Path $profilePath -Force | Out-Null
        }
        $envLine = '$env:TAISUN_AGENT_DIR = ' + ('"' + $REPO_DIR + '"')
        $existing = Get-Content $profilePath -Raw -ErrorAction SilentlyContinue
        if ($existing -and ($existing -match '\$env:TAISUN_AGENT_DIR\s*=')) {
            # 既存行を置換
            $updated = $existing -replace '(?m)^.*\$env:TAISUN_AGENT_DIR\s*=.*$', $envLine
            Set-Content -Path $profilePath -Value $updated -Encoding UTF8 -NoNewline
        } else {
            # 新規追加
            Add-Content -Path $profilePath -Value "`r`n$envLine" -Encoding UTF8
        }
        Write-Ok "TAISUN_AGENT_DIR=$REPO_DIR を $profilePath に登録しました"
    } catch {
        Write-Warn "TAISUN_AGENT_DIR の永続化をスキップしました: $_"
    }
}

# ─────────────────────────────────────────
# Opt-in telemetry: install_completed
# ─────────────────────────────────────────
$installDurationMs = ([int]([DateTimeOffset]::Now.ToUnixTimeSeconds()) - $script:InstallStartEpoch) * 1000
Emit-Telemetry 'install_completed' @{
    profile     = $SkillProfile
    duration_ms = $installDurationMs
    skill_count = $SKILL_COUNT
}

# ─────────────────────────────────────────
# 完了メッセージ
# ─────────────────────────────────────────
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║   インストールが完了しました！  v$VERSION (Windows)               ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  ┌──────────────────────────────────────────────────────────┐"
Write-Host "  │  次にやること（3ステップ）                               │"
Write-Host "  ├──────────────────────────────────────────────────────────┤"
Write-Host "  │                                                          │"
Write-Host "  │  ① .env を開いて ANTHROPIC_API_KEY を設定               │"
Write-Host "  │     （まだ設定していない場合のみ）                       │"
Write-Host "  │                                                          │"
Write-Host "  │  ② Claude Code をこのフォルダで開く                     │"
Write-Host "  │     PowerShell で: claude                                │"
Write-Host "  │                                                          │"
Write-Host "  │  ③ 「使い方を教えて」と話しかける                       │"
Write-Host "  │     日本語で何でも聞けます                               │"
Write-Host "  │                                                          │"
Write-Host "  └──────────────────────────────────────────────────────────┘"
Write-Host ""
Write-Host "  アップデートするには（1行で完了）："
Write-Host "    .\scripts\install.ps1 -Update"
Write-Host ""
Write-Host "  📋 スキル構成の変更："
Write-Host "    .\scripts\install.ps1 -ListProfiles      # プロファイル一覧"
Write-Host "    .\scripts\install.ps1 -Profile minimal    # 最小構成に変更"
Write-Host "    .\scripts\install.ps1 -Profile full       # 全スキルに変更"
Write-Host ""
Write-Host "  ❓ 困ったときは："
Write-Host "     困ったとき・何から始めるか迷ったときは、Claude Code で /guide と入力してください。"
Write-Host "     npm run taisun:diagnose  → 問題の診断"
Write-Host "     チャットで「使い方を教えて」と話しかける"
Write-Host ""
Write-Host "  ※ スキルは Junction リンク（git pull で自動更新）"
Write-Host "     エージェントはコピー（git pull 後に install.ps1 を再実行）"
Write-Host ""
