# 影格拼圖 Recording-Manga

把螢幕錄影變成 AI 看得懂的漫畫格大圖。
Turn screen recordings into time-stamped manga-style frame sheets that AI can read.

**線上使用：** https://hikari5014.github.io/Recording-Manga/

## 怎麼用

1. 按「開始錄影」錄螢幕，或「上傳影片」（mp4、webm、mov，也可以直接拖進視窗）
2. App 自動挑出變化最大的畫面，拼成一張格子大圖，每格標上編號、秒數、變化量
3. 按「複製拼圖」和「複製說明」，貼給 Claude、Gemini、ChatGPT

所有處理都在瀏覽器裡完成，影片不會上傳到任何地方。

## 安裝成 App

- **Chrome / Edge（Mac）**：網址列右邊的「安裝」圖示
- **Safari（Mac）**：選單「檔案 → 加入 Dock」

裝好後離線也能用。

## 發佈新版

1. 改程式
2. 在 `version.js` 改版本號，並在 `APP_CHANGELOG` 最上面加一筆
3. 推上 `main`，約 1 分鐘後 GitHub Pages 生效
4. 使用者下次打開會看到「有新版本，立即更新」

> 一定要改版本號，否則已安裝的使用者不會收到新版。

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 主畫面 |
| `app.css` | 外觀 |
| `app.js` | 錄影、挑畫面、拼圖、設定、更新 |
| `version.js` | 版本號 + 更新歷史（唯一要改版號的地方） |
| `sw.js` | 離線與更新 |
| `manifest.webmanifest` | 安裝成 App 的設定 |
| `icons/` | App 圖示 |
| `vendor/jszip.min.js` | 打包 zip 用（JSZip 3.10.1，MIT） |

## 限制

- 錄螢幕只能在電腦上用；iPhone、iPad 只能上傳影片
- 部分 iPhone 錄的 .mov（HEVC）可能打不開，請先轉成 mp4
- Mac 第一次錄影需在「系統設定 → 隱私權與安全性 → 螢幕錄製」允許瀏覽器
