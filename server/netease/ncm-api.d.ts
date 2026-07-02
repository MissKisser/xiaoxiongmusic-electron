// @neteasecloudmusicapienhanced/api does not publish declarations for these private modules.

declare module "@neteasecloudmusicapienhanced/api/generateConfig.js" {
  const generateConfig: () => Promise<void>;
  export default generateConfig;
}

declare module "@neteasecloudmusicapienhanced/api/server.js" {
  const serverModule: Record<string, unknown>;
  export default serverModule;
}
