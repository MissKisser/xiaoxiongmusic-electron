/**
 * PM2 配置文件
 * 用于生产环境部署
 */

module.exports = {
  apps: [
    {
      name: "xiaoxiongmusic-server",
      script: "./out/server/start.js",
      cwd: "/www/wwwroot/music.viaxv.cn",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        VITE_SERVER_PORT: 25884,
        LOG_DIR: "/www/wwwroot/music.viaxv.cn/logs",
      },
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      autorestart: true,
      max_memory_restart: "500M",
      watch: false,
    },
  ],
};
