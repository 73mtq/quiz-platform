import { dataFile } from "../config.js";
import { JsonQuizRepository } from "../repositories/JsonQuizRepository.js";
import { applyStudyNotesToState } from "../services/StudyNoteGenerator.js";

const overwrite = process.argv.includes("--overwrite");
const repository = new JsonQuizRepository(dataFile);
const state = await repository.getState();
const result = applyStudyNotesToState(state, { overwrite });

await repository.saveState(state);

console.log(`Scanned: ${result.scanned}`);
console.log(`Updated questions: ${result.updated}`);
console.log(`Explanations added: ${result.explanationAdded}`);
console.log(`Memory tips added: ${result.memoryTipAdded}`);
console.log(`Mode: ${overwrite ? "overwrite" : "fill empty only"}`);
