// 文档版本一致性校验：README / release-notes / README.en / package.json 必须指向同一版本。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const problems = [];

const checks = [
  ["README.md", `当前版本 **${version}**`],
  ["README.zh-CN.md", `当前版本 **${version}**`],
  ["docs/README.en.md", `Current version ${version}`],
  ["release-notes.md", `# ${version}`],
  ["AGENTS.md", `当前版本：**${version}**`],
];

for (const [file, needle] of checks) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  if (!text.includes(needle)) problems.push(`${file} 缺少版本标记 ${needle}`);
}

if (problems.length) {
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`✓ 文档版本一致：${version}（README / release-notes / README.en 均指向该版本）`);
