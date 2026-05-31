import fs from "node:fs/promises";
import path from "node:path";

const roots = [
  path.join(process.env.USERPROFILE || "", ".codex", "sessions"),
  path.join(process.env.LOCALAPPDATA || "", "Codex", "Logs"),
  path.join(process.env.APPDATA || "", "Codex")
];
const files = [];

for (const root of roots) await walk(root);

const found = new Map();

for (const file of files) {
  const text = await fs.readFile(file, "utf8").catch(() => "");
  collect(file, text, /\{"stem":"([^"]{2,260})"[\s\S]{0,2600}?"answer":\[/g);
  collect(file, text, /stem\\":\\"([^\\"]{2,260})\\"[\s\S]{0,2600}?answer\\":\[/g);
  collect(file, text, /stem\\\\\\":\\\\\\"([^\\"]{2,260})\\\\\\"[\s\S]{0,2600}?answer\\\\\\":\[/g);
}

const rows = [...found.entries()]
  .filter(([stem]) => /[\u4e00-\u9fff]/.test(stem))
  .sort((a, b) => a[0].localeCompare(b[0], "zh-CN"));

console.log(`unique_stems=${rows.length}`);
rows.slice(0, 200).forEach(([stem, sources], index) => {
  console.log(`${index + 1}. ${stem}`);
  console.log(`   ${[...sources].slice(0, 3).join(" | ")}`);
});

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const item = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(item);
    else if (/\.(jsonl|log|json|ldb|txt)$/i.test(entry.name)) files.push(item);
  }
}

function collect(file, text, regex) {
  let match;
  while ((match = regex.exec(text))) {
    const stem = match[1]
      .replace(/\\n/g, " ")
      .replace(/\\"/g, "\"")
      .replace(/\\\\/g, "\\")
      .trim();
    if (!found.has(stem)) found.set(stem, new Set());
    found.get(stem).add(file);
  }
}
