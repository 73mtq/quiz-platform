import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../../..");
const source = path.join(repoRoot, "dist/national-security-quiz.html");
const targets = [
  path.join(repoRoot, "docs/index.html"),
  path.join(repoRoot, "frontend/national-security.html")
];

if (!fs.existsSync(source)) {
  throw new Error("缺少 dist/national-security-quiz.html，请先运行 npm run build:ns-html");
}
for (const target of targets) {
  fs.copyFileSync(source, target);
  console.log(`已复制：${target}`);
}

const legacy = path.join(repoRoot, "content/national-security/legacy-progress.json");
if (fs.existsSync(legacy)) {
  for (const target of [
    path.join(repoRoot, "docs/legacy-progress.json"),
    path.join(repoRoot, "frontend/legacy-progress.json")
  ]) {
    fs.copyFileSync(legacy, target);
    console.log(`已复制：${target}`);
  }
}
