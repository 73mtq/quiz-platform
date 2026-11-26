import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../../..");
const source = path.join(repoRoot, "dist/national-security-quiz.html");
const target = path.join(repoRoot, "docs/index.html");

if (!fs.existsSync(source)) {
  throw new Error("缺少 dist/national-security-quiz.html，请先运行 npm run build:ns-html");
}
fs.copyFileSync(source, target);
console.log(`已复制：${target}`);
