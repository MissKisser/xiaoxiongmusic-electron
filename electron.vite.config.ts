import vue from "@vitejs/plugin-vue";
import { defineConfig, loadEnv } from "electron-vite";
import { resolve } from "path";
import AutoImport from "unplugin-auto-import/vite";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";
import Components from "unplugin-vue-components/vite";
import viteCompression from "vite-plugin-compression";
import { VitePWA } from "vite-plugin-pwa";
import { MainEnv } from "./env";
import wasm from "vite-plugin-wasm";

// 是否构建 Web 版本（启用 PWA）
const isWebBuild = process.env.BUILD_TARGET === "web";

export default defineConfig(({ mode }) => {
  // 读取环境变量
  const getEnv = (name: keyof MainEnv): string => {
    return loadEnv(mode, process.cwd())[name];
  };
  // 获取端口
  const webPort: number = Number(getEnv("VITE_WEB_PORT") || 14558);
  const servePort: number = Number(getEnv("VITE_SERVER_PORT") || 25884);
  // 返回配置
  return {
    // 主进程
    main: {
      resolve: {
        alias: {
          // 主进程文件（如 ipc-mac-statusbar）也引用了 @shared 类型，需与 renderer 保持一致
          "@shared": resolve(__dirname, "src/types/shared.ts"),
          "@emi": resolve(__dirname, "native/external-media-integration"),
        },
      },
      build: {
        publicDir: resolve(__dirname, "public"),
        rollupOptions: {
          input: {
            index: resolve(__dirname, "electron/main/index.ts"),
          },
        },
      },
    },
    // 预加载
    preload: {
      resolve: {
        alias: {
          "@shared": resolve(__dirname, "src/types/shared.ts"),
          "@emi": resolve(__dirname, "native/external-media-integration"),
        },
      },
      build: {
        rollupOptions: {
          input: {
            index: resolve(__dirname, "electron/preload/index.ts"),
          },
        },
      },
    },
    // 渲染进程
    renderer: {
      root: ".",
      plugins: [
        vue(),
        // 仅在构建 Web 版本时启用 PWA（Electron 不需要 Service Worker）
        isWebBuild &&
          VitePWA({
          // 由插件自动注入注册脚本（更稳定，避免运行时条件导致未注册）
          injectRegister: "auto",
          registerType: "autoUpdate",
          includeAssets: [
            "icons/favicon.ico",
            "icons/favicon-16x16.png",
            "icons/favicon-32x32.png",
            "icons/apple-touch-icon.png",
            "icons/favicon.png",
          ],
          manifest: {
            lang: "zh-CN",
            id: "/",
            name: "小熊音乐",
            short_name: "小熊音乐",
            description: "A minimalist music player",
            display: "standalone",
            start_url: "/",
            scope: "/",
            theme_color: "#ff5a5f",
            background_color: "#ffffff",
            icons: [
              {
                // 使用仓库里尺寸明确的图标，避免“声明尺寸与实际不符”导致不可安装
                src: "/icons/favicon-192x192.png",
                sizes: "192x192",
                type: "image/png",
                purpose: "any",
              },
              {
                src: "/icons/favicon-512x512.png",
                sizes: "512x512",
                type: "image/png",
                purpose: "any",
              },
              {
                // 额外提供 maskable（可提升部分平台的安装/显示效果）
                src: "/icons/favicon-512x512.png",
                sizes: "512x512",
                type: "image/png",
                purpose: "maskable",
              },
            ],
          },
          workbox: {
            // 让 wasm/font 等静态资源也进入预缓存（便于离线/安装判定）
            globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,wasm,json}"],
            // 关键修改：提高 Workbox 最大缓存文件大小至 3MiB，解决 2.58MiB wasm 文件缓存失败
            maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          },
          devOptions: {
            enabled: false,
            type: "module",
          },
        }),
        // mode === "development" && VueDevTools(),
        AutoImport({
          imports: [
            "vue",
            "vue-router",
            "@vueuse/core",
            {
              "naive-ui": ["useDialog", "useMessage", "useNotification", "useLoadingBar"],
            },
          ],
          eslintrc: {
            enabled: true,
            filepath: "./auto-eslint.mjs",
          },
        }),
        Components({
          resolvers: [NaiveUiResolver()],
        }),
        viteCompression(),
        wasm(),
      ],
      resolve: {
        alias: {
          "@": resolve(__dirname, "src/"),
          "@emi": resolve(__dirname, "native/external-media-integration"),
          "@shared": resolve(__dirname, "src/types/shared.ts"),
          "@opencc": resolve(__dirname, "native/ferrous-opencc-wasm/pkg"),
        },
      },
      css: {
        preprocessorOptions: {
          scss: {
            silenceDeprecations: ["legacy-js-api"],
          },
        },
      },
      server: {
        port: webPort,
        host:true,
        // 代理
        proxy: {
          "/api": {
            target: `http://127.0.0.1:${servePort}`,
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/api/, "/api"),
          },
        },
      },
      preview: {
        port: webPort,
      },
      build: {
        minify: "terser",
        publicDir: resolve(__dirname, "public"),
        // 可选修改：提高 chunk 体积警告阈值至 1000kB，消除 500kB 过大警告
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
          input: {
            index: resolve(__dirname, "index.html"),
            loading: resolve(__dirname, "web/loading/index.html"),
          },
          external: ["external-media-integration.node"],
          output: {
            manualChunks: {
              stores: ["src/stores/data.ts", "src/stores/index.ts"],
            },
          },
        },
        terserOptions: {
          compress: {
            // 保持原行为：仅移除 console.log（不要影响 warn/error）
            pure_funcs: ["console.log"],
          },
        },
        sourcemap: false,
      },
    },
  };
});