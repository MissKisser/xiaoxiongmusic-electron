import fs from "node:fs";
import path from "node:path";

const TARGET_FILE = path.join(process.cwd(), "src/assets/data/exclude.ts");

if (!fs.existsSync(TARGET_FILE)) {
  console.error("❌ 找不到 src/assets/data/exclude.ts，确保你在项目根目录下运行此脚本");
  process.exit(1);
}

const fileContent = fs.readFileSync(TARGET_FILE, "utf-8");

const keywordsMatch = fileContent.match(/(export\s+const\s+keywords\s*=\s*\[)([\s\S]*?)(\];)/);

if (!keywordsMatch) {
  console.error("❌ 找不到 `export const keywords = [...]` 结构");
  process.exit(1);
}

const [fullMatch, prefix, rawContent, suffix] = keywordsMatch;

const itemRegex = /(['"`])(.*?)\1/g;
const rawItems: string[] = [];
let match: RegExpExecArray | null;

while ((match = itemRegex.exec(rawContent)) !== null) {
  const content = match[2].trim();
  if (content) {
    rawItems.push(content);
  }
}

console.log(`✅ 找到 ${rawItems.length} 个关键词`);

const uniqueMap = new Map<string, string>();
let duplicatesRemoved = 0;

for (const item of rawItems) {
  const fingerprint = item.toLowerCase().replace(/\s+/g, "");

  if (uniqueMap.has(fingerprint)) {
    const existing = uniqueMap.get(fingerprint)!;

    if (item.length > existing.length) {
      uniqueMap.set(fingerprint, item);
    }

    duplicatesRemoved++;
  } else {
    uniqueMap.set(fingerprint, item);
  }
}

const uniqueItems = Array.from(uniqueMap.values());

console.log(`🧹 去重完毕，关键词有 ${uniqueItems.length}，移除了 ${duplicatesRemoved}`);

const collator = new Intl.Collator("zh-Hans-CN", { sensitivity: "accent" });

uniqueItems.sort((a, b) => {
  return collator.compare(a, b);
});

const newArrayContent = uniqueItems.map((item) => `  "${item}",`).join("\n");

const newContentBlock = `\n${newArrayContent}\n`;

const newFileContent = fileContent.replace(fullMatch, `${prefix}${newContentBlock}${suffix}`);

fs.writeFileSync(TARGET_FILE, newFileContent, "utf-8");
