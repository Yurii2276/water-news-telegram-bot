import {
  cleanTitle,
  correctUkrainianTitle,
  deterministicUkrainianTitle,
  hasObviousRussianTitleWords,
} from "./editorial.js";

function countMatches(value, pattern) {
  return [...String(value ?? "").matchAll(pattern)].length;
}

function responseText(payload) {
  for (const output of payload.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new Error("OpenAI translation response did not contain output_text");
}

export function titleForDisplay(material) {
  return correctUkrainianTitle(cleanTitle(
    material?.displayTitleUk ??
    material?.display_title_uk ??
    material?.translatedTitle ??
    material?.titleUk ??
    material?.aiDecision?.displayTitleUk ??
    material?.ai_decision?.displayTitleUk ??
    material?.title ??
    "",
    material?.source_name ?? material?.sourceName,
  ));
}

export function isMostlyCyrillicTitle(title) {
  const text = String(title ?? "");
  const cyrillic = countMatches(text, /\p{Script=Cyrillic}/gu);
  const latin = countMatches(text, /\p{Script=Latin}/gu);
  if (cyrillic === 0 && latin === 0) return true;
  return cyrillic >= latin || cyrillic / Math.max(cyrillic + latin, 1) >= 0.45;
}

export function needsUkrainianTitle(title) {
  const text = String(title ?? "").trim();
  if (!text) return false;
  if (/[ёыэъ]/i.test(text)) return true;
  if (hasObviousRussianTitleWords(text)) return true;
  return !isMostlyCyrillicTitle(text);
}

export async function translateTitleToUkrainian(
  title,
  { apiKey, model = "gpt-5.4-mini", fetchImpl = fetch, logger = console } = {},
) {
  const originalTitle = String(title ?? "").trim();
  if (!needsUkrainianTitle(originalTitle)) {
    return { title: originalTitle, translated: false, failed: false };
  }
  if (!apiKey) {
    const fallbackTitle = deterministicUkrainianTitle(originalTitle);
    return { title: fallbackTitle, translated: fallbackTitle !== originalTitle, failed: true };
  }

  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content:
              "Translate this water-sector news title into professional Ukrainian. Keep names, organizations, numbers, and acronyms. Return only the Ukrainian title.",
          },
          { role: "user", content: originalTitle },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(`OpenAI API error ${response.status}: ${payload.error?.message ?? "unknown"}`);
    }

    const translatedTitle = responseText(payload).replace(/\s+/g, " ").trim();
    const cleanedTitle = correctUkrainianTitle(translatedTitle || originalTitle);
    return {
      title: cleanedTitle,
      translated: Boolean(translatedTitle),
      failed: !translatedTitle || hasObviousRussianTitleWords(cleanedTitle),
    };
  } catch (error) {
    logger.warn?.("Title translation failed", error);
    const fallbackTitle = deterministicUkrainianTitle(originalTitle);
    return { title: fallbackTitle, translated: fallbackTitle !== originalTitle, failed: true };
  }
}

export async function prepareMaterialDisplayTitle(material, options = {}) {
  const existingTitle = cleanTitle(titleForDisplay(material), material?.source_name ?? material?.sourceName);
  if (!needsUkrainianTitle(existingTitle)) {
    return {
      ...material,
      displayTitleUk: existingTitle,
      titleTranslation: { translated: false, failed: false },
    };
  }

  const result = await translateTitleToUkrainian(existingTitle, options);
  return {
    ...material,
    displayTitleUk: result.title,
    titleTranslation: {
      translated: result.translated,
      failed: result.failed,
    },
  };
}
