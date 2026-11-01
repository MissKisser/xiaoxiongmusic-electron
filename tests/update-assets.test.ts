import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickAssetUrl, pickSetupUrl } from '../src/utils/updateAssets.js'
import { resolveInstallerFileName, formatBytes } from '../src/utils/installerDownload.js'
import { escapeHtml, renderMarkdown } from '../src/utils/renderMarkdown.js'

test('按变体取地址', () => {
  const assets = [{ variant: 'setup', url: 'https://x/s.exe' }];
  assert.equal(pickAssetUrl(assets, 'setup'), 'https://x/s.exe');
  assert.equal(pickAssetUrl(assets, 'portable'), '');
  assert.equal(pickAssetUrl(assets, 'default'), '');
})

test('pickAssetUrl 在数组包含空项时不抛错', () => {
  const sparseAssets = [null, undefined, { variant: 'setup', url: 'https://x/s.exe' }] as any;
  assert.equal(pickAssetUrl(sparseAssets, 'setup'), 'https://x/s.exe');
  assert.equal(pickAssetUrl(sparseAssets, 'portable'), '');
})

test('有 assets 时取安装版地址，缺失安装版返回空字符串', () => {
  const assets = [{ variant: 'setup', url: 'https://x/s.exe' }];
  assert.equal(pickSetupUrl(assets, 'https://x/fallback.exe'), 'https://x/s.exe');

  const withoutSetup = [{ variant: 'portable', url: 'https://x/p.exe' }];
  assert.equal(pickSetupUrl(withoutSetup, 'https://x/fallback.exe'), '');
})

test('无 assets 时回退到兜底地址', () => {
  const url = 'https://x/xiaoxiongmusic-4.4.12-x64-setup.exe';
  assert.equal(pickSetupUrl(undefined, url), url);
  assert.equal(pickSetupUrl([], url), url);
  assert.equal(pickSetupUrl(null as any, url), url);
  assert.equal(pickSetupUrl(undefined, 'https://x/custom.exe'), 'https://x/custom.exe');
})

test('安装包文件名解析：取 URL 路径末段并忽略查询串', () => {
  assert.equal(
    resolveInstallerFileName('https://music.viaxv.cn/api/downloads/xiaoxiongmusic-4.4.12-x64-setup.exe'),
    'xiaoxiongmusic-4.4.12-x64-setup.exe',
  );
  assert.equal(
    resolveInstallerFileName('https://open.viaxv.cn/x/s.exe?sig=abc&exp=1'),
    's.exe',
  );
})

test('安装包文件名解析：非法字符被清洗，无法解析时回退默认名', () => {
  assert.equal(resolveInstallerFileName('https://x/a%3Ab%2Fc.exe'), 'a-b-c.exe');
  assert.equal(resolveInstallerFileName('https://x/'), 'xiaoxiongmusic-setup.exe');
  assert.equal(resolveInstallerFileName(''), 'xiaoxiongmusic-setup.exe');
})

test('字节格式化', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1024 * 1024 * 140), '140.0 MB');
})

test('HTML 转义：尖括号与 & 被转义', () => {
  assert.equal(escapeHtml('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
})

test('md 渲染：粗体与列表生效且原始 HTML 被转义', () => {
  const html = renderMarkdown('**加粗**\n- 列表项');
  assert.ok(html.includes('<strong>加粗</strong>'));
  assert.ok(html.includes('<li>列表项</li>'));
  assert.ok(!html.includes('<img'));
  assert.ok(renderMarkdown('<script>alert(1)</script>').includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
})

test('md 渲染：单换行也换行', () => {
  assert.ok(renderMarkdown('第一行\n第二行').includes('<br>'));
})
