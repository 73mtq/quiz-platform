export class AiRecognitionService {
  constructor(config) {
    this.config = config;
  }

  async recognizeImage(imageDataUrl) {
    if (!this.config.mimoApiKey) {
      throw new Error("未设置 MIMO_API_KEY，请在 quiz-platform/.env 中填写 API Key");
    }
    if (!imageDataUrl || !String(imageDataUrl).startsWith("data:image/")) {
      throw new Error("缺少有效的图片 data URL");
    }

    const response = await fetch(`${this.config.mimoBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.mimoApiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.config.mimoModel,
        messages: [
          { role: "system", content: prompt() },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: imageDataUrl } },
              { type: "text", text: "请抽取图片中的所有题目（选择题和填空题），严格输出 JSON。" }
            ]
          }
        ],
        max_completion_tokens: 4096
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error?.message || "AI 识别失败");
    }

    const content = payload.choices?.[0]?.message?.content || "";
    console.log("[AI] 原始返回:", content.slice(0, 500));
    const result = extractJson(content);
    // 兼容 AI 返回数组而非 {questions:[...]} 的情况
    if (Array.isArray(result)) return { questions: result };
    if (result && !result.questions && Array.isArray(result.data)) return { questions: result.data };
    return result;
  }
}

function prompt() {
  return [
    "你是考试截图结构化抽取助手。",
    "只输出 JSON，不要 Markdown，不要解释，不要额外文字。",
    "输出格式：{\"questions\":[{...}]}",
    "",
    "选择题格式：{\"stem\":\"题干\",\"options\":[{\"key\":\"A\",\"text\":\"选项内容\"}],\"answer\":[\"A\"],\"explanation\":\"解析\"}",
    "填空题格式：{\"stem\":\"题干\",\"options\":[],\"answer\":[\"答案\"],\"explanation\":\"解析\"}",
    "",
    "判断规则：有 A/B/C/D 选项的是选择题，没有选项、需要填写内容的是填空题。",
    "选择题 answer 是选项字母数组。填空题 answer 是填入内容的数组，多个空按顺序排列。",
    "没有解析时 explanation 为空字符串。",
    "忽略得分、水印、按钮等界面元素。合并中文拆字空格，修正常见 OCR 错误。"
  ].join("\n");
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("AI 返回的内容不是合法 JSON");
  }
}
