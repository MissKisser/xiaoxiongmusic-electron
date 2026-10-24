import dotenv from "dotenv";
import { execSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

interface NativeModule {
  name: string;
  enabled?: boolean;
}

const isRustAvailable = () => {
  try {
    execSync("cargo --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });

if (process.env.SKIP_NATIVE_BUILD === "true") {
  console.log("[BuildNative] SKIP_NATIVE_BUILD 已设置，跳过原生模块构建");
  process.exit(0);
}

if (!isRustAvailable()) {
  console.error("[BuildNative] 错误：检测不到 Rust 工具链");
  console.error("[BuildNative] 未设置 SKIP_NATIVE_BUILD，因此必须包含 Rust 环境才能继续");
  console.error(
    "[BuildNative] 安装 Rust (https://rust-lang.org/tools/install/) 或者设置环境变量 SKIP_NATIVE_BUILD=true",
  );
  process.exit(1);
}

const modules: NativeModule[] = [
  {
    name: "external-media-integration",
  },
  {
    name: "tools",
  },
  {
    name: "taskbar-lyric",
  },
  // 有人抱怨编译 wasm 总是有问题，暂时注释掉
  // {
  //   name: "ferrous-opencc-wasm",
  // },
];

/**
 * 检查原生模块是否属于 pnpm workspace
 *
 * pnpm 对未匹配的过滤器只打印提示并以成功状态退出，
 * 构建流程会在模块缺失时静默跳过，必须显式拦截。
 * @param name 原生模块包名
 * @returns 是否为 workspace 成员
 */
const isWorkspaceMember = (name: string): boolean => {
  try {
    const output = execSync(
      `pnpm --filter ${name} exec node -e "process.stdout.write('WORKSPACE_MEMBER')"`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return output.includes("WORKSPACE_MEMBER");
  } catch {
    return false;
  }
};

try {
  const args = process.argv.slice(2);
  const isDev = args.includes("--dev");
  const buildCommand = isDev ? "build:debug" : "build";

  for (const mod of modules) {
    if (mod.enabled === false) {
      continue;
    }
    if (!isWorkspaceMember(mod.name)) {
      console.error(
        `[BuildNative] 模块 ${mod.name} 不在 pnpm workspace 中，无法通过过滤器构建`,
      );
      process.exit(1);
    }
    execSync(`pnpm --filter ${mod.name} ${buildCommand}`, {
      stdio: "inherit",
    });
  }
} catch (error) {
  console.error("[BuildNative] 模块构建失败", error);
  process.exit(1);
}