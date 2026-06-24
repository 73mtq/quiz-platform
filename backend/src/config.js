import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const dataFile = path.join(rootDir, "data", "quiz-data.json");
export const frontendDir = path.join(rootDir, "frontend");

loadDotEnv(path.join(rootDir, ".env"));

export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL || "",
  get useDatabase() {
    return Boolean(this.databaseUrl);
  },
  mimoApiKey: process.env.MIMO_API_KEY || "",
  mimoBaseUrl: (process.env.MIMO_BASE_URL || "https://token-plan-cn.xiaomimimo.com/v1").replace(/\/+$/, ""),
  mimoModel: process.env.MIMO_MODEL || "mimo-v2.5"
};

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
