# BlogsClub 簽到助手

[English](./README.md) | [简体中文](./README.zh-Hans.md) | **繁體中文**

BlogsClub 簽到助手是一個使用者腳本，用於在背景檢查 BlogsClub 每日簽到狀態，在需要時提醒你，並在你完成 Geetest 驗證碼後提交簽到。

腳本不會自動辨識、繞過或代替你完成驗證碼，驗證碼必須由你手動完成。

## 功能特色

- 在背景檢查每日簽到狀態。
- 立即檢查，並在需要時開啟 Geetest 驗證碼。
- 手動驗證後提交簽到，並顯示今日排名。
- 可選在伺服器零點前準備驗證碼、零點後提交。
- 透過 HTTP `Date` 回應標頭估算 BlogsClub 伺服器時間。
- 重用有效工作階段和正在進行的請求，減少不必要的請求。
- 選單和通知支援 English、简体中文、繁體中文；首次載入時會依照瀏覽器語言偏好選擇並儲存。

## 支援的腳本引擎

支援 [Tampermonkey](https://www.tampermonkey.net)、[Violentmonkey](https://violentmonkey.github.io)、[Greasemonkey](https://www.greasespot.net)、[ScriptCat](https://docs.scriptcat.org) 等腳本引擎。

## 文件

完整文件見 [簡體中文文件](https://howiehz.top/misc/blogsclub-signin-helper/) 或 [英文文件](https://howiehz.top/misc/en/blogsclub-signin-helper/)。

## 快速開始

1. 安裝支援的腳本引擎。
2. [從 GitHub 直鏈安裝使用者腳本](https://github.com/HowieHz/howiehz-misc/raw/refs/heads/dist-userscript/blogsclub-signin-helper/blogsclub-signin-helper.user.js)，或[從 Greasy Fork 安裝](https://greasyfork.org/scripts/590073-blogsclub-check-in-helper)。
3. 開啟 `https://www.blogsclub.org/` 或其他 BlogsClub 頁面。
4. 在使用者腳本管理器選單中選擇 `BlogsClub 帳號：未設定`，輸入電子郵件和密碼。
5. 選擇 `立即檢查/簽到` 立即檢查；如果當天尚未簽到，腳本會開啟 Geetest 驗證碼。

預設只在 BlogsClub 頁面自動檢查狀態；手動執行 `立即檢查/簽到` 不受頁面限制。密碼儲存在使用者腳本管理器的本機儲存中，只會傳送到 BlogsClub 登入介面。

## 開發

在儲存庫根目錄安裝相依套件後執行：

```bash
pnpm --filter blogsclub-signin-helper build
```

建置 `dist/` 中的使用者腳本產物。

```bash
pnpm --filter blogsclub-signin-helper watch
```

原始檔案變更時自動重新建置使用者腳本。

```bash
pnpm --filter blogsclub-signin-helper dev
```

啟動帶有 HMR 的 Vite 開發伺服器。

```bash
pnpm --filter blogsclub-signin-helper preview
```

建置使用者腳本後，在本機啟動伺服器提供產生的 `dist/` 產物。

## 授權

本專案依 [MIT License](../../LICENSE) 發布。
