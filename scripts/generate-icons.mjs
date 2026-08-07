// 一次性图标重新生成脚本
// 从 public/icons/icon-1024.png（1024×1024）出发，生成：
//   - public/icons/logo.ico           多尺寸 ICO（用于窗口图标 + electron-builder win.icon）
//   - public/icons/tray/tray@32.png   32×32 PNG（用于 macOS/Linux 托盘主图标）
//
// 运行：node scripts/generate-icons.mjs
// 需要 png2icons 已在 devDependencies（package.json 已声明）。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// png2icons 是 devDependencies，目前顶层 node_modules 没有符号链接
// 通过 pnpm store 的真实路径用 CJS require 加载（避免 ESM 驱动盘符路径问题）
const png2iconsPkg = resolve(
  projectRoot,
  "node_modules/.pnpm/png2icons@2.0.1/node_modules/png2icons/png2icons.js",
);
const require2 = createRequire(import.meta.url);
const { createICO } = require2(png2iconsPkg);

const srcPngPath = join(projectRoot, "public/icons/icon-1024.png");
const outIcoPath = join(projectRoot, "public/icons/logo.ico");
const outTrayPngPath = join(projectRoot, "public/icons/tray/tray@32.png");

const input = readFileSync(srcPngPath);

// -- 多尺寸 ICO（覆盖 logo.ico） -----------------------------------------
// forWinExe=true: 64+ 存 PNG，<64 存 BMP，兼容旧版 Windows 资源管理器属性对话框
// numOfColors=0: 无损（保留 PNG 全色）
const icoBuf = createICO(input, /* scaling */ 4 /*HERMITE*/, /* colors */ 0, /* PNG */ true, /* forWinExe */ true);
if (!icoBuf) throw new Error("createICO 失败");
writeFileSync(outIcoPath, icoBuf);
console.log(`✔ 写入 ${outIcoPath} (${icoBuf.length} bytes)`);

// -- 32×32 PNG（覆盖 tray@32.png）---------------------------------------
// 用 sharp 做精确缩放（通过 pnpm store 加载）
const sharpPkg = resolve(
  projectRoot,
  "node_modules/.pnpm/sharp@0.33.5/node_modules/sharp/lib/index.js",
);
let sharp;
try {
  sharp = require2(sharpPkg);
} catch (err) {
  console.warn("⚠ sharp 加载失败：", err.message);
  sharp = null;
}
if (sharp) {
  const trayPng = await sharp(input).resize(32, 32).png().toBuffer();
  writeFileSync(outTrayPngPath, trayPng);
  console.log(`✔ 写入 ${outTrayPngPath} (${trayPng.length} bytes)`);
} else {
  console.warn("⚠ 跳过 tray@32.png 重新生成（保持原文件）。");
}

console.log("完成。");
