import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickAssetUrl, pickPortableUrl, pickSetupUrl } from '../src/utils/updateAssets.js'
import { escapeHtml, renderMarkdown } from '../src/utils/renderMarkdown.js'

test('按变体取地址', () => {
  const assets = [{ variant: 'portable', url: 'https://x/p.exe' }, { variant: 'setup', url: 'https://x/s.exe' }];
  assert.equal(pickAssetUrl(assets, 'portable'), 'https://x/p.exe');
  assert.equal(pickAssetUrl(assets, 'setup'), 'https://x/s.exe');
  assert.equal(pickAssetUrl(assets, 'default'), '');
})

test('pickAssetUrl 在数组包含空项时不抛错', () => {
  const sparseAssets = [null, undefined, { variant: 'portable', url: 'https://x/p.exe' }] as any;
  assert.equal(pickAssetUrl(sparseAssets, 'portable'), 'https://x/p.exe');
  assert.equal(pickAssetUrl(sparseAssets, 'setup'), '');
})

test('无 assets 时回退旧后缀互换', () => {
  const url = 'https://x/xiaoxiongmusic-4.4.10-x64-portable.exe';
  assert.equal(pickPortableUrl(undefined, url), url);
  assert.equal(pickSetupUrl(undefined, url), 'https://x/xiaoxiongmusic-4.4.10-x64-setup.exe');

  const setupUrl = 'https://x/xiaoxiongmusic-4.4.10-x64-setup.exe';
  assert.equal(pickPortableUrl(undefined, setupUrl), 'https://x/xiaoxiongmusic-4.4.10-x64-portable.exe');
  assert.equal(pickSetupUrl(undefined, setupUrl), setupUrl);

  const otherUrl = 'https://x/custom.exe';
  assert.equal(pickPortableUrl(undefined, otherUrl), otherUrl);
  assert.equal(pickSetupUrl(undefined, otherUrl), otherUrl);
})

test('assets 为空数组时回退旧后缀互换', () => {
  const url = 'https://x/xiaoxiongmusic-4.4.10-x64-portable.exe';
  assert.equal(pickPortableUrl([], url), url);
  assert.equal(pickSetupUrl([], url), 'https://x/xiaoxiongmusic-4.4.10-x64-setup.exe');

  const setupUrl = 'https://x/xiaoxiongmusic-4.4.10-x64-setup.exe';
  assert.equal(pickPortableUrl([], setupUrl), 'https://x/xiaoxiongmusic-4.4.10-x64-portable.exe');
  assert.equal(pickSetupUrl([], setupUrl), setupUrl);

  const otherUrl = 'https://x/custom.exe';
  assert.equal(pickPortableUrl([], otherUrl), otherUrl);
  assert.equal(pickSetupUrl([], otherUrl), otherUrl);
})

test('assets 为 null 时回退旧后缀互换', () => {
  const url = 'https://x/xiaoxiongmusic-4.4.10-x64-portable.exe';
  assert.equal(pickPortableUrl(null as any, url), url);
  assert.equal(pickSetupUrl(null as any, url), 'https://x/xiaoxiongmusic-4.4.10-x64-setup.exe');

  const setupUrl = 'https://x/xiaoxiongmusic-4.4.10-x64-setup.exe';
  assert.equal(pickPortableUrl(null as any, setupUrl), 'https://x/xiaoxiongmusic-4.4.10-x64-portable.exe');
  assert.equal(pickSetupUrl(null as any, setupUrl), setupUrl);

  const otherUrl = 'https://x/custom.exe';
  assert.equal(pickPortableUrl(null as any, otherUrl), otherUrl);
  assert.equal(pickSetupUrl(null as any, otherUrl), otherUrl);
})

test('有 assets 时优先取变体地址，缺失变体返回空字符串', () => {
  const assets = [{ variant: 'portable', url: 'https://x/p.exe' }];
  const fallback = 'https://x/fallback-setup.exe';
  assert.equal(pickPortableUrl(assets, fallback), 'https://x/p.exe');
  assert.equal(pickSetupUrl(assets, fallback), '');

  const assetsSetup = [{ variant: 'setup', url: 'https://x/s.exe' }];
  assert.equal(pickPortableUrl(assetsSetup, fallback), '');
  assert.equal(pickSetupUrl(assetsSetup, fallback), 'https://x/s.exe');
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
