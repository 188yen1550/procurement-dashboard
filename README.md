# AI 團購選品決策輔助系統 — 前端（procurement-dashboard）

採購與主管使用的網頁介面：儀表板、品項管理、AI 商品雷達、選品審核、歷史開團紀錄與系統設定。

> **AI 只做決策輔助**：畫面上的 AI 摘要、適配度、趨勢比對都是參考資訊，正式審核結果一律由主管人工確認。

後端專案見 `Product_Selection_260813`（Spring Boot）。

---

## 目錄

- [技術棧](#技術棧)
- [環境需求](#環境需求)
- [快速開始](#快速開始)
- [Mock 模式](#mock-模式)
- [常用指令](#常用指令)
- [專案結構](#專案結構)
- [頁面、路由與權限](#頁面路由與權限)
- [架構慣例](#架構慣例)
- [與後端串接](#與後端串接)
- [樣式](#樣式)
- [測試](#測試)
- [注意事項與常見問題](#注意事項與常見問題)

---

## 技術棧

| 類別 | 使用 |
|---|---|
| 框架 | Angular 22.1（Standalone Component、**Zoneless**、Signals） |
| 語言 | TypeScript 6.0 |
| 非同步 | RxJS 7.8 |
| 圖表 | Chart.js 4.5、ng2-charts 10 |
| 試算表 | xlsx 0.18.5（批次匯入讀取 Excel／CSV、匯出） |
| 樣式 | SCSS（共用 design token） |
| 測試 | Vitest 4 ＋ jsdom |
| 格式化 | Prettier |
| 建置 | Angular CLI 22.1（`@angular/build`） |

> 專案**沒有使用 zone.js**，畫面更新靠 Signals。在 `subscribe` 回呼裡改一般變數不會觸發畫面更新，要寫進 `signal`。

---

## 環境需求

- **Node.js 22.22.3 以上，或 24.15.0 以上**（Angular CLI 22 的最低需求，版本不足時 `ng` 會直接拒絕執行）
- npm 11（`package.json` 的 `packageManager` 為 `npm@11.12.1`）
- 後端 API 在 `http://localhost:8080` 執行（Mock 模式不需要）

---

## 快速開始

```bash
npm ci          # 依 package-lock.json 安裝
npm start       # 等同 ng serve，開發伺服器 http://localhost:4200
```

開發伺服器使用 `proxy.conf.json`，把下列路徑轉給後端：

| 前端請求 | 轉送到 |
|---|---|
| `/api/**` | `http://localhost:8080` |
| `/images/**` | `http://localhost:8080`（商品圖片） |

前端程式一律用**相對路徑**（`/api/...`）呼叫後端，不寫死網域。後端沒有設定 CORS，所以本機開發一定要透過 proxy；正式環境請讓前後端同網域，或由反向代理轉發。

本機測試帳號由後端建立（後端設定 `app.dev-seed-users=true`）：

| 帳號 | 密碼 | 角色 |
|---|---|---|
| `manager` | `demo123` | 管理層 |
| `purchaser` | `demo123` | 操作層 |

---

## Mock 模式

`src/app/core/config/app-config.ts`：

```ts
export const APP_CONFIG = {
  useMockData: false,   // true：使用本地 Mock 資料，不呼叫後端
} as const;
```

| | Mock 模式（`true`） | 正式模式（`false`） |
|---|---|---|
| 後端 | 不需要 | 需要 |
| 登入 | 本地比對上表的兩個測試帳號 | `POST /api/auth/login` |
| 資料 | 各功能的 `*.mock-data.ts` 或元件內建的示範資料 | 真實 API |
| 會花額度或爬資料的操作（AI 分析、PTT 同步、Google 趨勢） | 不會真的執行，會顯示「功能限制」提示或提供「模擬成功／模擬失敗」按鈕 | 實際呼叫 |

> Mock 模式適合展示 UI 或在沒有後端時開發版面。**提交前請確認改回 `false`**。

---

## 常用指令

| 指令 | 說明 |
|---|---|
| `npm start` | 開發伺服器（development 設定＋proxy） |
| `npm run build` | 正式版建置（production 為預設），輸出到 `dist/procurement-dashboard` |
| `npx ng build --configuration development` | 開發版建置（不壓縮、較快） |
| `npm test` | 執行全部單元測試（Vitest） |
| `npx ng test --watch=false --include='**/product-detail/**/*.spec.ts'` | 只跑指定資料夾的測試 |
| `npx tsc -p tsconfig.spec.json --noEmit` | 只做測試檔型別檢查 |

交付前的建議檢查順序：`ng build --configuration development` → `ng build` → `tsc -p tsconfig.spec.json --noEmit` → `ng test --watch=false`。

---

## 專案結構

```
src/
├── main.ts, index.html, styles.scss
└── app/
    ├── app.config.ts          Router、HttpClient、攔截器（全站唯一註冊點）
    ├── app.routes.ts          頂層路由、Guard、Lazy Loading
    ├── core/                  全站共用、與畫面無關的基礎設施
    │   ├── api/                   ApiResponse 解包、錯誤訊息、HTTP 參數、逾時、CSV 匯出
    │   ├── auth/                  登入狀態、Guard（登入／管理層／操作層／強制改密碼）、withCredentials 攔截器
    │   ├── config/                app-config.ts（Mock 開關）
    │   ├── dialog/                全站對話框（confirm／notify）
    │   ├── domain/                enums.ts（對應後端 enum）、labels.ts（顯示文字）
    │   ├── router/                reload-on-revisit（原地點擊側欄時重新載入）
    │   └── ui/                    品牌色讀取、自動關閉訊息、檔案下載等工具
    ├── shared/                共用 UI
    │   ├── components/            版面（layout、header、sidebar）、icon、info-tip、商品圖片
    │   ├── ui/                    清單排序、排程執行紀錄分頁
    │   └── styles/                _tokens.scss、_base.scss、_components.scss
    └── features/              功能模組（每個模組各自的路由、元件、api/）
        ├── login/
        ├── dashboard/             儀表板（統計、推薦、風險、熱度排行）
        ├── product-management/    品項清單、新增／編輯、詳情、批次匯入、AI 商品雷達清單
        ├── discovery/api/         AI 商品雷達的 API
        ├── review/                選品審核清單與審核詳情
        ├── group-buy/             歷史開團紀錄
        ├── profile/               個人資料與改密碼
        ├── settings/              系統設定（三組）與排程作業面板
        └── user-management/api/   帳號管理 API（畫面在設定頁）
```

### 功能模組內的 `api/` 資料夾

| 檔案 | 職責 |
|---|---|
| `*-api.contract.ts` | 後端 Request／Response DTO 的型別，**欄位名稱與後端完全一致** |
| `*-api.service.ts` | 呼叫 HttpClient，回傳 Observable |
| `*.mapper.ts` | 把 API DTO 轉成畫面用的 model（處理 null、單位、顯示用欄位） |

API Contract 改變時，改 `contract` → `mapper` → 元件，不要讓元件直接依賴後端欄位。

---

## 頁面、路由與權限

| 路徑 | 頁面 | 可進入的角色 |
|---|---|---|
| `/login` | 登入、忘記密碼申請 | 公開 |
| `/dashboard` | 儀表板 | 全部 |
| `/products` | 品項管理清單 | 操作層 |
| `/products/new` | 新增品項 | 操作層 |
| `/products/batch-import` | 批次匯入（CSV／Excel＋圖片） | 操作層 |
| `/products/discoveries` | AI 商品雷達（系統尚未收錄、社群正在討論的商品線索） | 操作層 |
| `/products/:id/edit` | 編輯品項 | 操作層 |
| `/products/:id` | 品項詳情（管理層為唯讀） | 全部 |
| `/review`、`/review/:id` | 選品審核清單、審核詳情 | 管理層 |
| `/group-buy` | 歷史開團紀錄 | 全部 |
| `/profile` | 個人資料 | 全部 |
| `/settings/scoring` | 評分與審核規則 | 管理層 |
| `/settings/data` | 選品基礎資料（商品類型、核心客群、節慶檔期、天氣連動） | 管理層 |
| `/settings/system` | 系統管理（帳號、排程作業：AI 商品雷達（PTT）、PTT 熱度同步、Google 趨勢） | 管理層 |

- 所有頁面（除了登入）都需要登入（`authGuard`），被要求改密碼的帳號（`mustChangePassword=true`）會被 `passwordChangeGuard` 導到 `/profile`，改完密碼前無法進入其他頁面。
- 舊網址 `/settings?tab=...`、`/settings/operations` 會自動轉到新的分組。
- 新增、編輯頁有離頁 Guard，避免未儲存的內容遺失。
- 路由靜態段（`new`、`discoveries`、`batch-import`）必須排在 `:id` 前面。
- 「AI 商品雷達」在程式中一律叫 `discovery`（路由 `discoveries`、`features/discovery/`、`discoveries/` 元件），英文名稱本身不綁定資料來源，**不要為了配合中文名稱而改路由或檔名**。

> **Guard 只改善導覽體驗，不是安全機制。** 權限以後端 `@PreAuthorize` 為準；新增角色限制時，前端 Guard、側欄顯示、後端 API 三處都要一起改。

---

## 架構慣例

```
Component  →  Feature API Service  →  HttpClient  →  /api（proxy）→ 後端
（畫面狀態：signal）（DTO、mapper）
```

- **元件狀態用 Signals**：`signal()`、`computed()`；需要在 DOM 渲染後才能做的事（例如 Chart.js 畫圖）用 `afterRenderEffect()`，避免 canvas 還沒掛上就先畫。
- **Subscription 清理**：長時間的訂閱搭配 `takeUntilDestroyed(this.destroyRef)`。
- **API 回應解包**：後端統一回傳 `{ success, message, data }`，用 `core/api/unwrap.ts` 的 `unwrapData()`／`unwrapPage()` 取出資料。
- **逾時**：會呼叫外部服務的請求使用 `core/api/request-timeout.ts`（PTT 同步 60 秒、AI 分析 100 秒），逾時要顯示可讀的訊息並讓使用者重試。
- **對話框**：統一用 `DialogService`（`confirm`／`notify`），不要用瀏覽器原生的 `alert`／`confirm`。
- **會花額度的操作**（AI 分析、Google 趨勢查詢、立即執行排程）：送出前一定先 `confirm` 說明會用掉額度，執行中鎖住按鈕防止連點。
- **原地重新整理**：`app.config.ts` 開了 `onSameUrlNavigation: 'reload'`，頁面再搭配 `core/router/reload-on-revisit.ts` 重新載入；兩者要一起用才有效。
- **UI 狀態**：每個功能都要處理載入中、成功、空資料、錯誤、權限不足；只有一個區塊失敗時，只讓那個區塊顯示錯誤，不要讓整頁壞掉。
- **語言**：畫面文字與註解一律使用繁體中文。

### 攔截器（修改前必讀）

`app.config.ts` 的 `withInterceptors([...])` 是全站唯一的攔截器註冊點，目前只有 `withCredentialsInterceptor`（讓瀏覽器帶上 HttpOnly Cookie）。

**不要新增會寫死 `Content-Type` 的攔截器**：圖片上傳送的是 `multipart/form-data`，`Content-Type` 被覆蓋會失去 boundary，後端解不出檔案。`core/api/http-interceptors.spec.ts` 會檢查這件事，紅燈時請改攔截器，不要改測試。

---

## 與後端串接

### 登入狀態

- JWT 放在後端設定的 **HttpOnly Cookie**（`access_token`），前端讀不到、也**不存 localStorage／sessionStorage**。
- 重新整理頁面後，`authGuard` 會呼叫 `GET /api/auth/me` 確認 Cookie 是否仍有效。
- 帳號在其他地方重新登入時，舊的 Token 會失效（單一登入），下一個請求會收到 401。

### 前端必須遵守的後端行為

| 行為 | 前端做法 |
|---|---|
| CSV 匯入失敗仍回 **HTTP 200** | 讀 body 的 `success` 判斷，不能只看狀態碼；匯入是全部成功或全部失敗 |
| `supplierSimilarity` 為 `null` | 代表「無法比較」，不能顯示成 0 |
| Gate 狀態 `INSUFFICIENT_DATA` 與 `FAILED` | 補救方式完全不同，要分開顯示，不可合併 |
| 成團率 | 分母不含取消開團 |
| 分數區間 `HISTORICAL` 模式 | 後端會忽略送出的上下限 |
| Google 趨勢 | 相對值（0～100），只能看同一商品的升降，不併入評分；沒查過、查無資料要明講，不能顯示成 0 或「持平」 |
| 錯誤訊息 | 401 帳密錯誤、帳號停用的訊息不同，直接顯示後端的 `message`，不要統一成「登入失敗」 |

---

## 樣式

- **Design token** 在 `src/app/shared/styles/_tokens.scss`：顏色（`--c-brand`、`--c-ok`、`--c-warn`、`--c-danger` 與各自的 `-tint`、`-border`）、字級（`--t-xs`～`--t-display`）等。新樣式請用 token，不要寫死色碼。
- **最小字級是 `--t-xs`（16px）**。
- **元件樣式大小上限**（`angular.json` budgets）：單一元件樣式 **12 kB 警告、16 kB 錯誤**。接近上限時，把新規則拆到第二個樣式檔，並加到元件的 `styleUrls`（例：`product-detail-google-trend.scss`、`dashboard-actions.scss`）。
- 響應式斷點依元件而定（常見 `1100px`、`900px`、`800px`、`760px`、`700px`、`460px`），修改版面時請先看該元件既有的 `@media`，沿用同一組斷點。

---

## 測試

```bash
npm test                               # 全部
npx ng test --watch=false              # 不進 watch 模式（CI、交付前）
```

- 測試檔與元件放在一起（`*.spec.ts`）。
- 修改程式時**一起更新 spec**；有改到畫面文字時，搜尋 spec 裡有沒有 `toContain('舊文字')` 的斷言。
- 執行時出現 `Not implemented: HTMLCanvasElement's getContext()` 是 jsdom 沒有 canvas 造成的，**可以忽略**，不影響測試結果。
- 2026-09-30 時全部 40 個測試檔、453 個測試通過。

---

## 注意事項與常見問題

### `ng` 指令顯示 Node.js 版本不足

Angular CLI 22 需要 Node.js 22.22.3 以上或 24.15.0 以上，請升級 Node.js。

### 登入後一直被導回登入頁

1. 確認後端有啟動，而且是從 `http://localhost:4200`（透過 proxy）存取，不是直接開後端網址。
2. 如果用區網 IP 或非 localhost 的 http 網址測試，後端要設 `COOKIE_SECURE=false`，否則瀏覽器不會存 Secure Cookie。

### 圖片上傳失敗、後端說收不到檔案

檢查是否有攔截器或程式碼手動設定了 `Content-Type`（見[攔截器](#攔截器修改前必讀)）。

### `effect()` 沒有重新觸發

Signal 設定成**相同的值**時不會通知變化（例如連續兩次顯示同一句提示訊息）。需要「每次都觸發」的情境，請用 `core/ui/auto-dismiss.ts` 的 `createDismissibleMessage()`（範例見 `features/profile/profile.ts`），不要依賴相同字串重複 `set()`。

### 換行格式

原始碼使用 **CRLF**（Windows）。用腳本批次修改檔案時，注意不要把 CRLF 轉成 LF（例如 Python 文字模式讀寫要用 `newline=''`）。

### 相關文件

- `AGENTS.md`：給 AI 協作工具的專案 context 說明
- 前端 API 欄位對照（含顯示層註記）
- 企劃書（v8 以上）
