import { marked } from "marked";

/**
 * 转义 HTML 特殊字符
 *
 * @param text 原始文本
 * @returns 转义后的文本
 */
export const escapeHtml = (text: string): string => {
  if (!text) return "";
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

/**
 * 渲染 Markdown 为安全 HTML
 *
 * @param text Markdown 源码
 * @returns 渲染后的 HTML
 */
export const renderMarkdown = (text: string): string => {
  if (!text) return "";
  return marked.parse(escapeHtml(text), { breaks: true, gfm: true }) as string;
};
