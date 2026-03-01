# mcp-prompt-bridge

**MCPのpromptsをtoolsとして再公開するMCPサーバー**

Claude CodeがMCPサーバーのpromptsを認識しない問題（[#11054](https://github.com/anthropics/claude-code/issues/11054), [#3210](https://github.com/anthropics/claude-code/issues/3210)）のワークアラウンドです。

## 仕組み

```
[Claude Code]
    ↓ tools として呼び出し
[mcp-prompt-bridge]  ← このサーバー
    ↓ MCP client として接続（オンデマンド）
[既存のMCPサーバーA] [MCPサーバーB] ...
    prompts/list → 一覧取得
    prompts/get  → 内容取得して返却
```

上流サーバーへの接続は常時ではなく、`list` / `get` が呼ばれたときだけ接続→取得→切断します。

## セットアップ

```bash
npm install
npm run build
```

## 使い方

Claude Codeの設定ファイル（`.mcp.json`, `~/.claude.json` 等）から
MCPサーバーを自動的に発見し、プロンプトをツールとして公開します。

### Claude Codeへの登録

`.mcp.json` に追加：

```json
{
  "mcpServers": {
    "prompt-bridge": {
      "command": "node",
      "args": ["/path/to/mcp-prompt-bridge/dist/index.js"]
    }
  }
}
```

CLIから：

```bash
claude mcp add prompt-bridge -- node /path/to/mcp-prompt-bridge/dist/index.js
```

### 特定のサーバーを除外

```bash
node dist/index.js --exclude slow-server --exclude broken-server
```

### サーバー発見の仕組み

以下の設定ファイルを順番に読み込みます（後のものが優先）：

1. `~/.claude.json` — ユーザースコープ（cwdに対応するプロジェクト設定も読み込み）
2. `~/.claude/settings.local.json` — ユーザーローカル
3. `./.mcp.json` — プロジェクトスコープ
4. `./.claude/settings.local.json` — プロジェクトローカル

設定ファイルが見つからない場合は `claude mcp list` の出力をパースします。

### 安全機能

- **自己排除**: 自身と同じ実行パスを持つサーバーを自動スキップ（循環接続防止）
- **HTTP除外**: HTTPトランスポートのサーバーはスキップ（stdioのみ対応）
- **プロンプト非対応サーバー**: エラーにならず静かにスキップ
- **タイムアウト**: 接続は10秒でタイムアウト
- **オンデマンド接続**: 起動時にサーバーを立ち上げず、ツール呼び出し時のみ接続

## 公開されるツール

### `list`

全サーバーの全プロンプト一覧を返します（サーバー名、プロンプト名、説明、引数を含む）。

### `get`

特定のプロンプトを取得します。

| 引数 | 説明 |
|------|------|
| `server` | MCPサーバー名 |
| `prompt` | プロンプト名 |
| `arguments` | プロンプト引数（key-valueペア、省略可） |

## CLI オプション

| オプション | 説明 |
|-----------|------|
| `--exclude <name>` | 除外するサーバー名（複数指定可） |
| `--help`, `-h` | ヘルプ表示 |

## 制限事項

- stdioトランスポートのみ対応（HTTP/SSEサーバーは非対応）
- プロンプトの動的更新には未対応（再起動が必要）
- バイナリリソースを含むプロンプトはメタデータのみ表示

## ライセンス

MIT
