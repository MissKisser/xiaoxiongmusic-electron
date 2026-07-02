import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { serverLog } from "../../main/logger";
import generateConfig from "@neteasecloudmusicapienhanced/api/generateConfig.js";
import ncmServerExports from "@neteasecloudmusicapienhanced/api/server.js";

export const NON_API_EXPORTS = new Set<string>([
  ...Object.keys(ncmServerExports ?? {}),
  "server",
]);

const xeapiPublicKeyPath = join(tmpdir(), "xeapi_public_key");

let ncmConfigReady = false;
let ncmConfigPromise: Promise<void> | null = null;

export const ensureNcmConfig = (): Promise<void> => {
  if (ncmConfigReady) return Promise.resolve();
  if (!ncmConfigPromise) {
    ncmConfigPromise = generateConfig()
      .then(() => {
        if (existsSync(xeapiPublicKeyPath)) {
          ncmConfigReady = true;
          serverLog.info("NcmAPI xeapi config initialized");
        } else {
          serverLog.error("NcmAPI xeapi config was not generated; will retry on next request");
        }
      })
      .catch((error: unknown) => {
        serverLog.error("NcmAPI config initialization failed:", error);
      })
      .finally(() => {
        ncmConfigPromise = null;
      });
  }
  return ncmConfigPromise;
};
