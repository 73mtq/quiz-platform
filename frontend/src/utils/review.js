import { categoryDefinitions, patternDefinitions } from "../data/reviewTaxonomy.js";

export function analyzeReview(course) {
  const questions = course?.questions || [];
  const wrongQuestions = questions.filter((question) => (question.wrongCount || 0) > 0);
  const pendingWrongQuestions = wrongQuestions.filter(isPendingWrongQuestion);
  const masteredWrongQuestions = wrongQuestions.filter(isMasteredWrongQuestion);
  const answeredQuestions = questions.filter((question) => (question.wrongCount || 0) > 0 || (question.correctCount || 0) > 0);
  const correctAttempts = questions.reduce((sum, question) => sum + (question.correctCount || 0), 0);
  const wrongAttempts = questions.reduce((sum, question) => sum + (question.wrongCount || 0), 0);
  const repeatedWrong = pendingWrongQuestions.filter((question) => (question.wrongCount || 0) >= 2);
  const multiWrong = pendingWrongQuestions.filter((question) => (question.answer || []).length > 1);

  const categories = categoryDefinitions
    .map((definition) => {
      const items = pendingWrongQuestions.filter((question) => includesAny(question, definition.keywords));
      return {
        name: definition.name,
        count: items.length,
        attempts: sumWrong(items),
        multiCount: items.filter((question) => (question.answer || []).length > 1).length,
        sample: topQuestions(items, 1)[0] || null,
        advice: definition.advice
      };
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || b.attempts - a.attempts);

  const patterns = patternDefinitions
    .map((definition) => {
      const items = pendingWrongQuestions.filter(definition.test);
      return {
        name: definition.name,
        count: items.length,
        attempts: sumWrong(items),
        advice: definition.advice
      };
    })
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || b.attempts - a.attempts);

  const priorityQuestions = topQuestions(pendingWrongQuestions, 12);
  const memoryCards = buildMemoryCards({ wrongQuestions: pendingWrongQuestions, repeatedWrong, multiWrong, patterns, categories });

  return {
    totalQuestions: questions.length,
    answeredQuestions: answeredQuestions.length,
    wrongQuestions: wrongQuestions.length,
    pendingWrongQuestions: pendingWrongQuestions.length,
    masteredWrongQuestions: masteredWrongQuestions.length,
    repeatedWrong: repeatedWrong.length,
    multiWrong: multiWrong.length,
    correctAttempts,
    wrongAttempts,
    accuracy: correctAttempts + wrongAttempts ? Math.round((correctAttempts / (correctAttempts + wrongAttempts)) * 100) : 0,
    categories,
    patterns,
    priorityQuestions,
    memoryCards
  };
}

export function applyQuestionReview(question, { correct, selectedAnswers, answeredAt = new Date().toISOString() }) {
  const review = normalizeReviewState(question.review);
  review.lastAnsweredAt = answeredAt;
  review.lastSelectedAnswers = (selectedAnswers || []).map((item) => String(item));

  if (correct) {
    review.lastCorrectAt = answeredAt;
    review.consecutiveCorrect += 1;
    if ((question.wrongCount || 0) > 0 && review.consecutiveCorrect >= 2) {
      review.masteredAt = review.masteredAt || answeredAt;
    }
  } else {
    review.lastWrongAt = answeredAt;
    review.consecutiveCorrect = 0;
    review.masteredAt = "";
  }

  question.review = review;
  return review;
}

function normalizeReviewState(review = {}) {
  return {
    lastAnsweredAt: review.lastAnsweredAt || "",
    lastWrongAt: review.lastWrongAt || "",
    lastCorrectAt: review.lastCorrectAt || "",
    consecutiveCorrect: Number(review.consecutiveCorrect) || 0,
    masteredAt: review.masteredAt || "",
    lastSelectedAnswers: Array.isArray(review.lastSelectedAnswers)
      ? review.lastSelectedAnswers.map((item) => String(item))
      : []
  };
}

export function getQuestionTags(question) {
  const tags = [];
  const wrongCount = question.wrongCount || 0;
  const correctCount = question.correctCount || 0;
  const consecutiveCorrect = question.review?.consecutiveCorrect || 0;
  if (wrongCount > 0) tags.push(`错 ${wrongCount}`);
  if (correctCount > 0) tags.push(`对 ${correctCount}`);
  if (isMasteredWrongQuestion(question)) tags.push("已掌握");
  if (isPendingWrongQuestion(question)) tags.push(`待清 ${Math.min(consecutiveCorrect, 2)}/2`);
  if ((question.answer || []).length > 1) tags.push("多选");
  if ((question.answer || []).some((item) => item === "对" || item === "错")) tags.push("判断");
  for (const pattern of patternDefinitions) {
    if (pattern.name !== "多选漏选题" && pattern.name !== "判断题" && pattern.test(question)) {
      tags.push(pattern.name.replace("题", ""));
    }
  }
  return [...new Set(tags)];
}

export function isPendingWrongQuestion(question) {
  return (question.wrongCount || 0) > 0 && !question.review?.masteredAt;
}

export function isMasteredWrongQuestion(question) {
  return (question.wrongCount || 0) > 0 && Boolean(question.review?.masteredAt);
}

export function sortWrongQuestions(questions) {
  return [...questions].sort((a, b) => questionPriority(b) - questionPriority(a));
}

function topQuestions(questions, limit) {
  return sortWrongQuestions(questions).slice(0, limit);
}

function questionPriority(question) {
  const wrong = question.wrongCount || 0;
  const correct = question.correctCount || 0;
  const answerCount = (question.answer || []).length;
  const lastWrongAt = Date.parse(question.review?.lastWrongAt || "") || 0;
  const recencyDays = lastWrongAt ? Math.min(30, Math.floor((Date.now() - lastWrongAt) / 86400000)) : 30;
  const repeatWeight = wrong * 100;
  const unresolvedWeight = correct ? 0 : 40;
  const multiWeight = answerCount > 1 ? 24 + answerCount : 0;
  const recencyWeight = 30 - recencyDays;
  const patternWeight = patternDefinitions.reduce((sum, pattern) => sum + (pattern.test(question) ? 4 : 0), 0);
  return repeatWeight + unresolvedWeight + multiWeight + recencyWeight + patternWeight;
}

function includesAny(question, keywords) {
  const text = [
    question.stem,
    ...(question.options || []).map((option) => option.text)
  ].join("\n");
  return keywords.some((keyword) => text.includes(keyword));
}

function sumWrong(questions) {
  return questions.reduce((sum, question) => sum + (question.wrongCount || 0), 0);
}

function buildMemoryCards({ wrongQuestions, repeatedWrong, multiWrong, patterns, categories }) {
  const cards = [];
  if (repeatedWrong.length) {
    cards.push({
      title: "先清反复错",
      body: `先刷 ${repeatedWrong.length} 道错 2 次以上的题。它们数量少，但最能暴露混淆点。`
    });
  }
  if (multiWrong.length) {
    cards.push({
      title: "多选整组背",
      body: `${multiWrong.length} 道错题是多选。把答案写成“关键词 = A + B + C”的组合，不要只记单个选项。`
    });
  }
  const conceptPattern = patterns.find((item) => item.name === "括号概念题");
  if (conceptPattern) {
    cards.push({
      title: "括号题改短卡",
      body: `${conceptPattern.count} 道错题是概念填空。复习时只保留“题干关键词 -> 正确答案”。`
    });
  }
  const topCategory = categories[0];
  if (topCategory) {
    cards.push({
      title: `主攻 ${topCategory.name}`,
      body: `这个板块有 ${topCategory.count} 道错题。${topCategory.advice}`
    });
  }
  if (!cards.length && wrongQuestions.length) {
    cards.push({
      title: "保持错题复盘",
      body: "错题数量不多，按错题列表从高到低刷一轮即可。"
    });
  }
  return cards;
}
