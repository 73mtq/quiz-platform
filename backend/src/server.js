import http from "node:http";
import { config, dataFile } from "./config.js";
import { JsonQuizRepository } from "./repositories/JsonQuizRepository.js";
import { SqlQuizRepository } from "./repositories/SqlQuizRepository.js";
import { AiRecognitionService } from "./services/AiRecognitionService.js";
import { createRouter } from "./routes.js";

// 根据环境变量选择数据存储方式
const repository = config.useDatabase
  ? new SqlQuizRepository(config.databaseUrl)
  : new JsonQuizRepository(dataFile);

if (config.useDatabase) {
  console.log("📦 使用 PostgreSQL 数据库存储");
} else {
  console.log("📄 使用本地 JSON 文件存储");
}

const aiService = new AiRecognitionService(config);
const router = createRouter({ repository, aiService });

const server = http.createServer((req, res) => {
  router(req, res);
});

server.listen(config.port, config.host, () => {
  console.log(`Quiz Platform running at http://${config.host}:${config.port}`);
  console.log(`MiMo model: ${config.mimoModel}`);
});
