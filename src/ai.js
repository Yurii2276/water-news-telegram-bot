import { TOPIC_CATEGORIES } from "./topics.js";

export const AI_DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "relevant",
    "relevanceScore",
    "category",
    "importance",
    "confidence",
    "confidenceScore",
    "summary",
    "whyImportant",
    "hashtags",
    "rejectionReason",
  ],
  properties: {
    relevant: { type: "boolean" },
    relevanceScore: { type: "integer", minimum: 0, maximum: 100 },
    category: { type: "string", enum: [...TOPIC_CATEGORIES, "other"] },
    importance: { type: "integer", minimum: 0, maximum: 100 },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    confidenceScore: { type: "integer", minimum: 0, maximum: 100 },
    summary: { type: "string", maxLength: 700 },
    whyImportant: { type: "string", maxLength: 500 },
    hashtags: {
      type: "array",
      maxItems: 6,
      items: {
        type: "string",
        pattern: "^#[A-Za-zА-Яа-яІіЇїЄєҐґ0-9_]+$"
      },
    },
    rejectionReason: { type: "string", maxLength: 400 },
  },
};

const SYSTEM_PROMPT = `Ти — обережний редактор українських новин водного сектору.
Аналізуй ВИКЛЮЧНО наданий заголовок, URL, джерело і текст сторінки.
Не додавай фактів із пам'яті, припущень або зовнішніх джерел.
Якщо текст не містить достатньо конкретних перевірюваних фактів, relevant=false.
relevanceScore оцінює відповідність водопостачанню/водовідведенню, confidenceScore
оцінює достатність і однозначність фактів саме в наданому тексті.
Summary і whyImportant мають бути прямо підтверджені текстом.
Не плутай загальну екологію водойм із комунальним водопостачанням та водовідведенням.
rejectionReason заповнюй для відхиленого матеріалу; для прийнятого повертай порожній рядок.`;

function responseText(payload) {
  for (const output of payload.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new Error("OpenAI response did not contain output_text");
}

export function validateAiDecision(value) {
  if (!value || typeof value !== "object") throw new Error("Invalid AI decision");
  if (typeof value.relevant !== "boolean") throw new Error("Missing relevance");
  for (const field of ["relevanceScore", "confidenceScore"]) {
    if (!Number.isInteger(value[field]) || value[field] < 0 || value[field] > 100) {
      throw new Error(`Invalid ${field}`);
    }
  }
  if (!Number.isInteger(value.importance) || value.importance < 0 || value.importance > 100) {
    throw new Error("Invalid importance");
  }
  if (!["low", "medium", "high"].includes(value.confidence)) {
    throw new Error("Invalid confidence");
  }
  if (!Array.isArray(value.hashtags)) throw new Error("Invalid hashtags");
  if (value.relevant && (!value.summary?.trim() || !value.whyImportant?.trim())) {
    throw new Error("Relevant decision lacks grounded editorial text");
  }
  if (
    value.relevant &&
    (value.confidence === "low" ||
      value.relevanceScore < 85 ||
      value.confidenceScore < 85)
  ) {
    return {
      ...value,
      relevant: false,
      rejectionReason:
        value.relevanceScore < 85
          ? "Релевантність нижче 85%"
          : "Рівень довіри нижче 85%",
    };
  }
  return value;
}

export async function classifyArticle(
  article,
  { apiKey, model = "gpt-5.4-mini", fetchImpl = fetch },
) {
  if (!article.content || article.content.length < 300) {
    return {
      relevant: false,
      relevanceScore: 0,
      category: "other",
      importance: 0,
      confidence: "low",
      confidenceScore: 0,
      summary: "",
      whyImportant: "",
      hashtags: [],
      rejectionReason: "Недостатньо змісту першоджерела",
    };
  }

  const response = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            title: article.title,
            url: article.url,
            source: article.sourceName,
            content: article.content,
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "water_news_editorial_decision",
          strict: true,
          schema: AI_DECISION_SCHEMA,
        },
      },
    }),
    signal: AbortSignal.timeout(45_000),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`OpenAI API error ${response.status}: ${payload.error?.message ?? "unknown"}`);
  }

  return validateAiDecision(JSON.parse(responseText(payload)));
}
