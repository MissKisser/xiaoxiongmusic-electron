# Nginx CORS 配置部署说明

## 修改内容概述

为了支持前端的 `withCredentials: true`（允许发送 Cookie），Nginx 配置需要：
1. 返回请求来源的具体地址，而不是通配符 `*`
2. 添加 `Access-Control-Allow-Credentials: true` 头
3. 处理 OPTIONS 预检请求

## 部署步骤

### 1. 备份原配置
```bash
cd /www/server/panel/vhost/nginx
cp music.viaxv.top.conf music.viaxv.top.conf.backup
```

### 2. 替换配置文件
将新的配置文件内容复制到服务器的 Nginx 配置路径：
```bash
/www/server/panel/vhost/nginx/music.viaxv.top.conf
```

### 3. 测试配置
```bash
nginx -t
```

如果显示 `syntax is ok` 和 `test is successful`，继续下一步。

### 4. 重载 Nginx
```bash
nginx -s reload
```

或者在宝塔面板中点击"重载配置"。

## 关键改动说明

### CORS 头配置
每个 API location 块都新增了：

```nginx
# 处理 OPTIONS 预检请求
if ($request_method = 'OPTIONS') {
    add_header 'Access-Control-Allow-Origin' $http_origin always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization' always;
    add_header 'Access-Control-Allow-Credentials' 'true' always;
    add_header 'Access-Control-Max-Age' 1728000 always;
    add_header 'Content-Type' 'text/plain; charset=utf-8' always;
    add_header 'Content-Length' 0 always;
    return 204;
}

# 正常请求的 CORS 响应头
add_header 'Access-Control-Allow-Origin' $http_origin always;
add_header 'Access-Control-Allow-Credentials' 'true' always;
add_header 'Access-Control-Expose-Headers' 'Content-Length,Content-Range' always;
```

### `$http_origin` 变量说明
- `$http_origin` 会动态获取请求头中的 `Origin` 字段
- 对于 `http://localhost:14558` 的请求，会返回 `Access-Control-Allow-Origin: http://localhost:14558`
- 对于 `https://music.viaxv.top` 的请求，会返回 `Access-Control-Allow-Origin: https://music.viaxv.top`
- 这样就避免了通配符 `*` 与 `withCredentials: true` 的冲突

## 验证部署

部署完成后，在浏览器中访问 `http://localhost:14558`，应该不会再出现 CORS 错误。

可以在浏览器开发者工具的 Network 标签中查看响应头，应该能看到：
```
Access-Control-Allow-Origin: http://localhost:14558
Access-Control-Allow-Credentials: true
```

## 故障排查

如果仍然有 CORS 错误：
1. 确认 Nginx 配置已重载成功
2. 清空浏览器缓存（Ctrl+Shift+Delete）
3. 检查 Nginx 错误日志：`/www/wwwlogs/music.viaxv.top.error.log`
