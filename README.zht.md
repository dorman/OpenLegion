<p align="center">
  <a href="https://openlegion.dev">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenLegion logo">
    </picture>
  </a>
</p>
<p align="center">開源的 AI Coding Agent。</p>
<p align="center">
  <a href="https://openlegion.dev/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/openlegion-ai"><img alt="npm" src="https://img.shields.io/npm/v/openlegion-ai?style=flat-square" /></a>
  <a href="https://github.com/dorman/OpenLegion/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/dorman/OpenLegion/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![OpenLegion Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://openlegion.dev)

---

### 安裝

```bash
# 直接安裝 (YOLO)
curl -fsSL https://openlegion.dev/install | bash

# 套件管理員
npm i -g openlegion-ai@latest        # 也可使用 bun/pnpm/yarn
scoop install openlegion             # Windows
choco install openlegion             # Windows
brew install anomalyco/tap/openlegion # macOS 與 Linux（推薦，始終保持最新）
brew install openlegion              # macOS 與 Linux（官方 brew formula，更新頻率較低）
sudo pacman -S openlegion            # Arch Linux (Stable)
paru -S openlegion-bin               # Arch Linux (Latest from AUR)
mise use -g openlegion               # 任何作業系統
nix run nixpkgs#openlegion           # 或使用 github:dorman/OpenLegion 以取得最新開發分支
```

> [!TIP]
> 安裝前請先移除 0.1.x 以前的舊版本。

### 桌面應用程式 (BETA)

OpenLegion 也提供桌面版應用程式。您可以直接從 [發佈頁面 (releases page)](https://github.com/dorman/OpenLegion/releases) 或 [openlegion.dev/download](https://openlegion.dev/download) 下載。

| 平台                  | 下載連結                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `openlegion-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `openlegion-desktop-mac-x64.dmg`     |
| Windows               | `openlegion-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, 或 AppImage        |

```bash
# macOS (Homebrew Cask)
brew install --cask openlegion-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/openlegion-desktop
```

#### 安裝目錄

安裝腳本會依據以下優先順序決定安裝路徑：

1. `$OPENLEGION_INSTALL_DIR` - 自定義安裝目錄
2. `$XDG_BIN_DIR` - 符合 XDG 基礎目錄規範的路徑
3. `$HOME/bin` - 標準使用者執行檔目錄 (若存在或可建立)
4. `$HOME/.openlegion/bin` - 預設備用路徑

```bash
# 範例
OPENLEGION_INSTALL_DIR=/usr/local/bin curl -fsSL https://openlegion.dev/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://openlegion.dev/install | bash
```

### Agents

OpenLegion 內建了兩種 Agent，您可以使用 `Tab` 鍵快速切換。

- **build** - 預設模式，具備完整權限的 Agent，適用於開發工作。
- **plan** - 唯讀模式，適用於程式碼分析與探索。
  - 預設禁止修改檔案。
  - 執行 bash 指令前會詢問權限。
  - 非常適合用來探索陌生的程式碼庫或規劃變更。

此外，OpenLegion 還包含一個 **general** 子 Agent，用於處理複雜搜尋與多步驟任務。此 Agent 供系統內部使用，亦可透過在訊息中輸入 `@general` 來呼叫。

了解更多關於 [Agents](https://openlegion.dev/docs/agents) 的資訊。

### 線上文件

關於如何設定 OpenLegion 的詳細資訊，請參閱我們的 [**官方文件**](https://openlegion.dev/docs)。

### 參與貢獻

如果您有興趣參與 OpenLegion 的開發，請在提交 Pull Request 前先閱讀我們的 [貢獻指南 (Contributing Docs)](./CONTRIBUTING.md)。

### 基於 OpenLegion 進行開發

如果您正在開發與 OpenLegion 相關的專案，並在名稱中使用了 "openlegion"（例如 "openlegion-dashboard" 或 "openlegion-mobile"），請在您的 README 中加入聲明，說明該專案並非由 OpenLegion 團隊開發，且與我們沒有任何隸屬關係。

---

**加入我們的社群** [飞书](https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=738j8655-cd59-4633-a30a-1124e0096789&qr_code=true) | [X.com](https://x.com/openlegion)
