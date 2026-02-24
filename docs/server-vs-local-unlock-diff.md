# 本地 pnpm dev 与服务器部署后端差异分析（灰色歌曲解锁）

## 一、结论摘要

**同一套后端代码**（`SPlayer/server`）在本地能解锁灰色歌曲、在服务器上不能，主要差异来自：

1. **请求路径不同**：本地前端通过 Vite 代理访问后端，浏览器/Electron 看到的是「同源」；服务器上由 Nginx 反向代理，若未正确转发或未加 CORS，可能表现为「接口不通」或「跨域」。
2. **后端出站请求来源不同**：解锁与音频代理都是**后端主动请求外部服务**；本地时出站 IP 是**本机**，服务器时是**机房 IP**，易被第三方限流、封禁或反爬拦截。
3. **Nginx 对 `/api/proxy/` 的配置**：若未禁用缓冲或未正确传 Range，会导致音频流/断点续传异常，表现为「能解锁但播不出」。

下面按「请求路径」「后端出站」「Nginx」三块说明。

---

## 二、本地 pnpm dev 时的请求路径

### 2.1 前端如何连到后端

- `pnpm dev` 实际执行：`npm run build:native && tsx scripts/dev.ts` → 只启动 **Electron + Vite 开发服务器**（默认端口 14558，见 `VITE_WEB_PORT`）。
- 后端**不会**被 `pnpm dev` 自动拉起，需要**单独**跑：`pnpm server:dev`（或 `pnpm server:start`），监听 `VITE_SERVER_PORT`（默认 **25884**）。

### 2.2 Vite 代理（electron.vite.config.ts）

```ts
server: {
  port: webPort,   // 14558
  proxy: {
    "/api": {
      target: `http://127.0.0.1:${servePort}`,  // 25884
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, "/api"),
    },
  },
},
```

- 浏览器/Electron 渲染进程里，请求的是 **同一端口**（如 `http://localhost:14558/api/...`）。
- 由 **Vite 把 `/api/*` 转发到 `http://127.0.0.1:25884/api/*`**，对前端而言是「同源」，无 CORS 问题。
- 解锁流程：  
  前端 → `GET /api/unblock/netease?id=xxx` → Vite 代理 → 后端 25884 → 后端再请求外部解锁接口。  
  播放流程：  
  前端 → `GET /api/proxy/audio?url=xxx` → Vite 代理 → 后端 25884 → 后端再请求 `url` 拉音频流并转发。

### 2.3 本地时「谁在请求外部」

- **解锁**（`server/unblock/index.ts`）：后端用 axios 请求  
  - 网易：`https://music-api.gdstudio.xyz/api.php`  
  - 酷我、波点、歌曲宝等：各自的外部 URL  
  这些请求的**源 IP = 本机**（你家/公司网络）。
- **音频代理**（`server/proxy/index.ts`）：后端用 axios 请求「解锁返回的音频 URL」，同样从**本机**出站。

很多第三方接口对家庭/办公 IP 较宽松，对机房/数据中心 IP 会限流或封禁，所以**本地能解锁、服务器不能**往往就出在这里。

---

## 三、服务器部署时的请求路径与后端

### 3.1 典型部署方式

- 后端：`SPlayer/server` 用 Node 直接跑（如 `pnpm server:start` 或 pm2），监听 25884。
- 前面一层 **Nginx**：  
  - 静态：`/` → 前端静态文件（如 `out/renderer`）；  
  - 接口：`/api/*` → `proxy_pass http://localhost:25884/api...`。

所以：**同一套 Fastify 代码**在 25884 上跑，和本地「单独起 server」时一致，差异主要在「谁在调 25884」和「后端从哪台机器出站」。

### 3.2 后端配置（server/config.ts、server/start.ts）

- `isDev = process.env.NODE_ENV === "development"`；  
- `server/start.ts` 里若未设 `NODE_ENV`，会设为 `"production"`。  
- 生产下只影响：是否在 Fastify 里挂静态目录（`out/renderer`）。**不影响** `/api/unblock`、`/api/proxy/audio` 的逻辑，所以不是「本地 dev / 服务器 prod」导致解锁逻辑不一致。

### 3.3 CORS（server/index.ts）

- 后端已在 `onRequest` 里按 `Origin` 设了 `Access-Control-Allow-Origin` 等，并显式允许 `capacitor://localhost`、`http://localhost` 等。
- 若 Nginx **没有**用 `proxy_hide_header` 覆盖这些头，浏览器/App 会收到后端的 CORS 头，跨域请求可以正常发。
- 你项目里已有 `nginx-baota-music.viaxv.top-CORS-FIXED.conf`，对 `/api/*` 做了 CORS 和 `proxy_hide_header`，用这份配置时 CORS 一般没问题；若用的是**未加 CORS 的那份** nginx 配置，只要 Nginx 不 strip 后端响应头，理论上也能用。若出现「接口 200 但浏览器报 CORS」，再重点查 Nginx 是否覆盖/去掉了后端的 CORS 头。

---

## 四、核心差异：后端「出站请求」的来源 IP

| 环节           | 本地（pnpm dev + 单独起 server） | 服务器部署（同一 server 代码） |
|----------------|----------------------------------|--------------------------------|
| 前端 → 后端    | 经 Vite 代理，同源 14558         | 经 Nginx 代理，同源或跨域      |
| 后端 → 解锁 API | 从**本机**出站                   | 从**服务器**出站               |
| 后端 → 音频 URL | 从**本机**出站                   | 从**服务器**出站               |

- **解锁**：  
  `server/unblock/index.ts` 里会请求：  
  - `https://music-api.gdstudio.xyz/api.php`（网易）  
  - `https://www.gequbao.com/...`（歌曲宝）  
  - 酷我、波点等第三方。  
  这些站点常对**机房/数据中心 IP** 做限制（反爬、限流、封禁），所以**同一段代码在服务器上请求失败**，就会导致解锁拿不到 URL 或返回错，灰色歌曲自然播不了。

- **音频代理**：  
  解锁若成功，会返回一个音频直链；`server/proxy/index.ts` 再用 axios 去请求这个 URL，把流转发给前端。若该 URL 带防盗链（只允许「浏览器/用户 IP」），则**从服务器 IP 去拉**可能 403/404，表现为「解锁成功但播放失败」。

因此：**「本地能解锁灰色歌曲、服务器不能」很大概率是后端出站环境差异（IP/网络/防火墙），而不是后端业务代码在本地和服务器上不一致。**

---

## 五、Nginx 与 `/api/proxy/` 的注意点

项目里 `nginx-baota-music.viaxv.top-CORS-FIXED.conf` 已对 `/api/proxy/` 做了：

- `proxy_buffering off;`、`proxy_request_buffering off;`
- `proxy_set_header Range $http_range;`
- 较长 `proxy_read_timeout` 等

这些是**正确**的：音频流不宜缓冲，且需支持 Range。若你实际用的 nginx 配置里：

- 没有对 `/api/proxy/` 关缓冲，或  
- 没有把 `Range` 传到后端，  

可能出现「解锁正常、但播放卡住或无法断点续传」，看起来像「服务器上灰色歌曲播不了」。建议确认线上 Nginx 对 `/api/proxy/` 的配置与 CORS-FIXED 版本一致。

---

## 六、建议排查顺序（仅定位原因）

1. **看服务器后端日志**  
   请求一次灰色歌曲，看：  
   - `/api/unblock/netease`（或其它解锁）是否被调用、返回是否 200、body 里是否有 `url`。  
   - `/api/proxy/audio?url=...` 是否被调用、返回状态码和是否有报错。  
   若 unblock 就 404/500 或无 url，问题在「后端出站访问解锁接口」；若 unblock 正常而 proxy 报错，问题在「后端出站访问音频 URL」或 Nginx 对 proxy 的配置。

2. **在服务器上直接测出站**  
   - `curl -I 'https://music-api.gdstudio.xyz/api.php?types=url&id=某歌曲id'`  
   - 用解锁返回的音频 URL 再 `curl -I` 一次。  
   若在服务器上就 403/超时，而本机同样请求正常，即可确认是**机房 IP 被限/封**导致。

3. **确认实际使用的 Nginx 配置**  
   确保 `/api/proxy/` 使用了「禁用缓冲 + 传 Range + 足够超时」的配置，且没有覆盖或去掉后端返回的 CORS 头（若前端/App 是跨域访问）。

4. **（可选）网络策略**  
   若服务器在云上，检查安全组/防火墙是否禁止出站 443；以及是否有透明代理/网关对部分域名做了拦截。

---

## 七、涉及文件一览

| 文件/位置 | 作用 |
|-----------|------|
| `electron.vite.config.ts` | 本地 dev 时把 `/api` 代理到 25884 |
| `server/config.ts` | `isDev`、`port`（25884） |
| `server/start.ts` | 独立启动后端，默认 NODE_ENV=production |
| `server/index.ts` | Fastify 入口、CORS、挂载 /api |
| `server/unblock/index.ts` | 解锁接口，内部请求 gdstudio/gequbao/酷我等 |
| `server/proxy/index.ts` | 音频代理，内部请求「解锁返回的 url」 |
| `nginx-baota-music.viaxv.top-CORS-FIXED.conf` | 推荐用于线上：CORS + proxy 缓冲/Range/超时 |

以上为「只找原因、不修改」的差异分析；修复需从服务器出站环境、Nginx 配置和后端日志三方面着手。
