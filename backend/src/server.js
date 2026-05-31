import http from "node:http";
import { config, dataFile } from "./config.js";
import { JsonQuizRepository } from "./repositories/JsonQuizRepository.js";
import { AiRecognitionService } from "./services/AiRecognitionService.js";
import { createRouter } from "./routes.js";

const repository = new JsonQuizRepository(dataFile);
const aiService = new AiRecognitionService(config);
const router = createRouter({ repository, aiService });

const server = http.createServer((req, res) => {
  router(req, res);
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(`Quiz Platform running at http://127.0.0.1:${config.port}`);
  console.log(`MiMo model: ${config.mimoModel}`);
});
