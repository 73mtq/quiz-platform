import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, "../../..");
const sourceRoots = ["backend/src", "frontend/src"];

const files = [];
for (const root of sourceRoots) collect(path.join(rootDir, root), files);

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file]);
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    failed += 1;
  }
}

console.log(`语法检查完成：共 ${files.length} 个文件，失败 ${failed} 个。`);
if (failed) process.exit(1);

function collect(dir, target) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(fullPath, target);
    else if (entry.name.endsWith(".js")) target.push(fullPath);
  }
}
