import crypto from "node:crypto";

export function questionCore(question) {
  return {
    id: question.id,
    type: question.type,
    stem: question.stem,
    options: question.options,
    answer: question.answer
  };
}

export function courseCore(course) {
  return {
    id: course.id,
    name: course.name,
    questions: (course.questions || []).map(questionCore)
  };
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function computeCoreHash(courses) {
  return sha256(JSON.stringify((courses || []).map(courseCore)));
}

export function computeBankHash(courses) {
  return sha256(JSON.stringify((courses || []).map(({ id, name, questions }) => ({ id, name, questions }))));
}
