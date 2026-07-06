const categoryDefinitions = [
  {
    name: "人民/民生/社会治理",
    keywords: ["人民", "群众", "民生", "社会治理", "基层", "共同富裕", "公平正义", "社会保障"],
    advice: "把“为了谁、依靠谁、成果归谁”作为判断主线。"
  },
  {
    name: "发展/经济/改革开放",
    keywords: ["发展", "高质量发展", "新发展格局", "经济", "供给侧", "改革开放", "内需", "市场", "民营", "区域", "协调发展", "开放"],
    advice: "先判断题目问的是理念、格局、动力还是制度保障。"
  },
  {
    name: "中国式现代化/民族复兴",
    keywords: ["中国式现代化", "现代化", "民族复兴", "中国梦", "新道路", "伟大复兴", "共同富裕"],
    advice: "把总任务、战略安排、共同富裕和五个特征分开记。"
  },
  {
    name: "文化/意识形态",
    keywords: ["文化", "文明", "意识形态", "价值观", "精神文明", "中华优秀传统文化"],
    advice: "注意文化自信、核心价值观、意识形态安全的定位词。"
  },
  {
    name: "法治/国家治理",
    keywords: ["法治", "依法", "宪法", "法律", "治理体系", "治理能力", "制度体系", "良法", "执政"],
    advice: "区分依法治国、依法执政、依法行政和法治体系。"
  },
  {
    name: "科教人才/创新",
    keywords: ["科技", "创新", "教育", "人才", "自立自强", "立德树人", "科教兴国"],
    advice: "按教育、科技、人才三件事分别绑定关键词。"
  },
  {
    name: "党的领导/党建",
    keywords: ["党的领导", "中国共产党", "从严治党", "自我革命", "党建", "党管", "两个维护", "初心", "使命", "组织"],
    advice: "党的领导常考最本质特征、最大优势和根本保证。"
  },
  {
    name: "外交/人类命运共同体",
    keywords: ["外交", "人类命运共同体", "一带一路", "国际", "全球", "世界", "和平", "开放型世界经济"],
    advice: "分清中国方案、全球治理、一带一路和国际合作表述。"
  },
  {
    name: "生态文明/美丽中国",
    keywords: ["生态", "绿色", "美丽中国", "环境", "碳", "自然", "长江", "生命共同体"],
    advice: "多选题优先背完整并列组，避免漏选结构调整项。"
  },
  {
    name: "国家安全/强军",
    keywords: ["国家安全", "安全观", "政治安全", "军事", "军队", "强军", "人民军队", "风险", "底线思维", "极限思维"],
    advice: "记牢人民安全、政治安全、经济安全和强军目标三件套。"
  },
  {
    name: "一国两制/统一",
    keywords: ["一国两制", "香港", "澳门", "台湾", "祖国统一", "特别行政区", "港澳"],
    advice: "港澳题按治理实践、开放助力、人文交流三类区分。"
  }
];

const patternDefinitions = [
  {
    name: "定位词题",
    test: (question) => /根本|本质|关键|核心|基础|前提|保证|宗旨|灵魂|主线|最大|第一|首要/.test(question.stem || ""),
    advice: "看到定位词先停一下：问宗旨、根本、关键还是保证。"
  },
  {
    name: "多选漏选题",
    test: (question) => (question.answer || []).length > 1,
    advice: "不要凭印象选，先数并列项，再排除看似相关但不在原组合里的选项。"
  },
  {
    name: "时间会议题",
    test: (question) => /[0-9]{4}年|二十大|十九大|十八大|十七大|全会|会议|大会/.test(question.stem || ""),
    advice: "只整理错过的年份和会议，不背全量年表。"
  },
  {
    name: "判断题",
    test: (question) => (question.answer || []).some((item) => item === "对" || item === "错"),
    advice: "重点检查“已经、必须、唯一、当前、根本”等修饰词是否偷换。"
  },
  {
    name: "括号概念题",
    test: (question) => /^[(（]|（\s*[）)]/.test(question.stem || "") || (question.stem || "").includes("（）") || (question.stem || "").includes("( )"),
    advice: "把题干改写成“关键词 -> 答案”的短卡片。"
  }
];

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
  const recoveredWrong = wrongQuestions.filter((question) => (question.correctCount || 0) > 0);

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
    recoveredWrong: recoveredWrong.length,
    correctAttempts,
    wrongAttempts,
    accuracy: correctAttempts + wrongAttempts ? Math.round((correctAttempts / (correctAttempts + wrongAttempts)) * 100) : 0,
    categories,
    patterns,
    priorityQuestions,
    memoryCards
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
