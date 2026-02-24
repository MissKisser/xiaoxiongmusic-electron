# 灰色歌曲解锁逻辑差异报告：Mobile vs SPlayer

## 一、结论摘要

| 项目 | 灰色歌曲能否播放 | 主要原因 |
|------|------------------|----------|
| **SPlayer** | 能 | 1）所有歌曲统一「先解锁再官方」；2）**Web 端对解锁/官方 URL 统一走代理**，无 CORS 问题。 |
| **Mobile** | 不能（尤其在 Web 浏览器下） | 1）有灰色歌曲分支，但 2）**Web 端（非 Capacitor）对解锁返回的 URL 直接使用、不走代理**，第三方域名易触发 CORS/混合内容，导致「解锁成功但无法播放」。 |

---

## 二、核心逻辑对比

### 2.1 获取音频源主流程（`getAudioSource` / `getPlayUrl`）

| 步骤 | Mobile | SPlayer |
|------|--------|---------|
| 1 | `canUnlock = type !== "radio" && useSongUnlock` | 同左 |
| 2 | **`isGraySong = song.free !== 0 && !song.pc`**（灰色：VIP/购买专辑/非会员限制等） | **无** `isGraySong` 判断 |
| 3 | **灰色 + 可解锁**：**强制先走解锁**，成功即返回；失败再往下走官方 | **所有可解锁歌曲**：统一先走解锁，成功即返回 |
| 4 | **非灰色 + 可解锁**：先解锁，失败再走官方 | （与上合并，无灰色/非灰色分支） |
| 5 | 调用 `getOnlineUrl` 取官方链接 | 同左 |
| 6 | 官方有效 → 返回官方 | 同左 |
| 7 | **官方无效且灰色且可解锁**：**再次尝试解锁（兜底）** | **无**「官方无效时灰色兜底解锁」 |
| 8 | 最后：本地缓存兜底 / 无可用源 | 同左 |

- **Mobile**：对灰色歌曲有显式分支（先强制解锁 + 官方无效时再解锁兜底），逻辑更细。
- **SPlayer**：不区分灰色/非灰色，一律「先解锁再官方」，且没有「官方无效时再试一次解锁」的兜底。

从「是否先尝试解锁」看，两边对灰色歌曲都会先试解锁；差异主要在**官方无效时的兜底**和**URL 是否经代理**（见下）。

---

### 2.2 解锁 URL 的 Web 端处理（`processUrlForWeb`）

| 环境 | Mobile | SPlayer |
|------|--------|---------|
| Electron | 直接返回原始 URL | 直接返回原始 URL |
| **Web 浏览器** | **直接返回原始 URL**（注释：先尝试直接访问） | **统一通过同源代理**：`/api/proxy/audio?url=encodeURIComponent(url)` |
| Capacitor（原生壳） | 通过 `VITE_API_URL + /api/proxy/audio?url=...` 代理 | （无 Capacitor） |

- **SPlayer**：在 Web 下所有非 Electron 的 URL（包括解锁返回的第三方链接）都会变成同源代理地址，浏览器不会直接请求第三方域名，因此**无 CORS / 混合内容**问题，灰色歌曲可正常播放。
- **Mobile**：在 **Web 浏览器**（非 Capacitor）下，解锁返回的 URL **不做代理**，直接给 `<audio>` 使用。若解锁服务返回的是其它域名的链接，浏览器会按跨域策略处理，常出现：
  - CORS 被拒，或
  - 混合内容（HTTPS 页加载 HTTP 音频）被拦截  
  表现为「解锁接口返回了 URL，但无法播放」→ 用户感觉灰色歌曲不能播。

Capacitor 环境下 Mobile 会走代理，因此**原生 App 内**灰色歌曲有可能可以播，取决于后端代理是否可用；**纯 Web 端**最容易出现不能播。

---

### 2.3 其它相关差异

| 项目 | Mobile | SPlayer |
|------|--------|---------|
| `isCapacitor` | 有（`@capacitor/core`），用于区分原生与 Web | 无 |
| 预加载下一首（`getNextSongUrl`） | 先试解锁，失败再用官方；**不区分灰色** | 同左，不区分灰色 |
| `api/song.ts` 的 `unlockSongUrl` | 同：`/api/unblock` + 各 server 路径，网易用 id，其它用 keyword | 同左 |
| 设置项（`useSongUnlock`、`songUnlockServer` 等） | 有 | 有，一致 |

---

## 三、为何 SPlayer 能播、Mobile 不能播（归纳）

1. **主流程**  
   - SPlayer：所有歌曲（含灰色）都「先解锁再官方」，灰色歌曲只要解锁成功就会用解锁链接。  
   - Mobile：灰色歌曲也是先解锁再官方，且还有「官方无效时再解锁一次」的兜底，从逻辑上并不更保守。

2. **关键差异在 Web 端 URL 使用方式**  
   - **SPlayer**：Web 端对解锁/官方返回的 URL 一律走 **`/api/proxy/audio`**，播放的是同源地址，不受 CORS/混合内容限制。  
   - **Mobile**：Web 端（非 Capacitor）对解锁返回的 URL **直接使用**，第三方域名在浏览器中易被拦截，导致「灰色歌曲解锁成功但无法播放」。

3. **因此**  
   - 能播/不能播的差异主要来自：**Web 下是否对解锁 URL 做同源代理**，而不是灰色分支有无。  
   - 若希望 Mobile 在 Web 下也能播灰色歌曲，需要让 **Mobile 在 Web 端对解锁得到的 URL 也走代理**（与 SPlayer 的 `processUrlForWeb` 行为对齐）。

---

## 四、建议修改方向（仅作参考）

1. **Mobile**  
   - 在 `SongManager.processUrlForWeb` 中：当**非 Electron 且非 Capacitor**（即纯 Web 浏览器）时，与 SPlayer 一致，将解锁/官方返回的音频 URL 统一改为通过当前站点代理，例如：  
     `当前站点同源 + /api/proxy/audio?url=encodeURIComponent(原始URL)`。  
   - 需保证 Mobile 后端或网关提供 `/api/proxy/audio`（或等价）代理能力。

2. **SPlayer**（可选）  
   - 若希望与 Mobile 行为完全一致，可在 `getAudioSource` 中增加：  
     - `isGraySong = song.free !== 0 && !song.pc`；  
     - 官方链接无效时，若 `isGraySong && canUnlock`，再调用一次 `getUnlockSongUrl` 作为兜底。  
   - 这样灰色歌曲在「官方无链接」时多一次解锁机会，逻辑与 Mobile 对齐。

---

## 五、涉及文件一览

| 文件 | Mobile | SPlayer |
|------|--------|---------|
| `core/player/SongManager.ts` | 灰色分支 + 兜底；`processUrlForWeb` 区分 Capacitor/Web | 无灰色分支；`processUrlForWeb` 在 Web 下统一代理 |
| `utils/env.ts` | 含 `isCapacitor` | 无 `isCapacitor` |
| `api/song.ts`（`unlockSongUrl`） | 一致 | 一致 |

以上为灰色歌曲解锁逻辑的差异报告；若需对某一段落做代码级对照或改法示例，可指定模块（如仅 `processUrlForWeb` 或仅 `getAudioSource`）。

---

## 六、Mobile 打包成 App 后灰色歌曲无法播放的可能原因（仅分析，不修改）

在 **Capacitor 打包成原生 App** 的场景下，灰色歌曲仍可能无法播放，与「SPlayer 在 Web 下能播」形成对比。下面是可能原因归纳。

### 6.1 代理 URL 的「同源 vs 跨域」差异（最可能）

| 项目 | 代理 URL 形式 | 与页面是否同源 |
|------|----------------|----------------|
| **SPlayer（Web）** | 相对路径：`/api/proxy/audio?url=...` | 是。页面打开在哪个域名，代理就同源，无 CORS 问题。 |
| **Mobile（Capacitor App）** | 绝对路径：`${VITE_API_URL}/api/proxy/audio?url=...`（如 `https://music.viaxv.top/...`） | 否。App 页面 origin 为 `capacitor://localhost`（或类似），请求的是另一域名，属于跨域。 |

- 在 App 里，**音频是由 `<audio>.src = proxyUrl` 直接请求的**（`AudioElementPlayer.ts`），不经过 axios/CapacitorHttp。
- 因此代理请求是 **WebView 发起的普通跨域 GET**。若后端 **未对 App 的 origin 返回 CORS 头**（如 `Access-Control-Allow-Origin` 包含 `capacitor://localhost` 或 `*`），部分 WebView/系统会拦截响应，导致「有代理 URL 但无法播放」。

**结论**：SPlayer 能播是因为代理始终同源；Mobile App 不能播，很可能是因为 **代理 URL 跨域且后端未对 Capacitor 的 origin 放行 CORS**。

### 6.2 构建时 `VITE_API_URL` 未配置或配置错误

- Capacitor 下，**解锁请求**（`/api/unblock`）和 **代理请求**（`/api/proxy/audio`）的域名都来自 **构建时** 的 `import.meta.env["VITE_API_URL"]`，默认回退为 `https://music.viaxv.top`。
- 若用户自建后端（例如 `https://my-api.com`），但 **打包 App 时未设置 `VITE_API_URL=https://my-api.com`**，则：
  - 解锁请求会发往 `https://music.viaxv.top/api/unblock/...`；
  - 代理请求会发往 `https://music.viaxv.top/api/proxy/audio?url=...`。
- 若默认站点 `music.viaxv.top` 未部署或未提供上述接口，或与用户环境不一致，则 **解锁失败或代理失败**，灰色歌曲都会无法播放。

**结论**：App 打包时若未把 `VITE_API_URL` 指向实际使用的后端，灰色歌曲会因「解锁/代理都打到错误域名」而无法播放。

### 6.3 后端 `/api/proxy/audio` 实现或环境问题

- 即使解锁成功并返回了第三方音频 URL，**代理接口** 需要能正确请求该 URL 并流式返回。
- 若后端对部分解锁返回的 URL 存在以下情况，也会导致 App 内无法播放：
  - 重定向、特殊 Header、或 TLS/证书问题导致服务端请求失败；
  - 对域名/协议做了白名单限制，未包含解锁服务返回的域名；
  - 超时、网络策略或防火墙导致服务端访问第三方 URL 失败。

**结论**：灰色歌曲「解锁成功但 App 仍不能播」，有可能是 **代理接口对部分 URL 请求失败**，与前端逻辑无关。

### 6.4 小结（仅找原因）

| 可能原因 | 说明 |
|----------|------|
| **代理跨域 + CORS** | App 内代理 URL 为绝对地址，与 `capacitor://localhost` 跨域；后端未对 App origin 放行 CORS，WebView 拦截音频响应。 |
| **VITE_API_URL 未配置/错误** | 打包时未设置或设错，解锁和代理都打到默认/错误域名，接口不可用或非用户自己的后端。 |
| **后端代理实现** | `/api/proxy/audio` 对部分解锁返回的 URL 请求失败（重定向、TLS、白名单、超时等）。 |

以上为「只找原因、不修改」的归纳；修复需从后端 CORS、构建时 `VITE_API_URL`、以及代理接口实现三方面排查。
