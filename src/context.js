import { needsUkrainianTitle } from "./translation.js";
import { factualExtract, validatePublicContext } from "./editorial.js";

function decisionOf(material) {
  return material?.ai_decision ?? material?.aiDecision ?? {};
}

export function materialCategory(material) {
  const decision = decisionOf(material);
  return decision.materialCategory ??
    decision.sourceCategory ??
    material?.sourceCategory ??
    material?.source_category ??
    "general_news";
}

export const FALLBACK_CONTEXTS_UK = {
  regulator:
    "Матеріал стосується регулювання водопостачання або водовідведення. Такі рішення можуть впливати на тарифи, правила роботи ліцензіатів та планування діяльності водоканалів.",
  government:
    "Повідомлення стосується державної політики або відновлення інфраструктури. Для водного сектору це важливо з точки зору фінансування, пріоритетів відбудови та координації рішень.",
  parliament:
    "Матеріал може мати значення для законодавчого регулювання водного сектору. Варто відстежувати можливий вплив на громади, водоканали, тарифи та інфраструктурні проєкти.",
  association:
    "Новина стосується професійної спільноти водного сектору. Такі повідомлення допомагають бачити позицію галузі, актуальні проблеми підприємств та потреби модернізації.",
  vodokanal:
    "Матеріал стосується роботи водоканалу або комунальної інфраструктури. Це важливо для розуміння стану мереж, втрат води, аварійності та потреб у модернізації.",
  local_media:
    "Локальна новина щодо водопостачання або водовідведення. Вона може бути корисною як сигнал про стан мереж, аварійність або якість комунальних послуг у громаді.",
  donor:
    "Матеріал стосується міжнародної допомоги, відновлення або WASH-напряму. Для галузі це важливо з точки зору фінансування, технічної підтримки та модернізації інфраструктури.",
  international_tech:
    "Міжнародний досвід або технологія у сфері водопостачання та водовідведення. Такі рішення можуть бути корисними для зменшення втрат води, енергоефективності, цифровізації або очищення стічних вод.",
  general_news:
    "Матеріал стосується водного сектору та може мати значення для громад, водоканалів або інфраструктурного планування.",
};

function trimContext(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
}

function responseText(payload) {
  for (const output of payload.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  throw new Error("OpenAI context response did not contain output_text");
}

export function fallbackProfessionalContext(material) {
  return factualExtract(material);
}

export function contextForDisplay(material) {
  const context = trimContext(
    material?.professionalContextUk ??
    material?.professional_context_uk ??
    material?.aiDecision?.professionalContextUk ??
    material?.ai_decision?.professionalContextUk ??
    material?.aiDecision?.whyImportant ??
    material?.ai_decision?.whyImportant ??
    material?.aiDecision?.summary ??
    material?.ai_decision?.summary ??
    fallbackProfessionalContext(material),
  );
  return validatePublicContext(context, material) ? context : "";
}

export async function generateProfessionalContext(
  material,
  { apiKey, model = "gpt-5.4-mini", fetchImpl = fetch, logger = console } = {},
) {
  if (!apiKey) {
    return { context: fallbackProfessionalContext(material), generated: false, failed: true };
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
              "Write 1-3 concise professional Ukrainian sentences explaining why this water-sector news matters for vodokanals, regulators, local governments, or infrastructure experts. Use only the provided title, source, category and snippet. No hype. 300-600 characters.",
          },
          {
            role: "user",
            content: JSON.stringify({
              title: material?.displayTitleUk ?? material?.title,
              source: material?.source_name ?? material?.sourceName,
              category: materialCategory(material),
              snippet: material?.content || material?.summary || material?.snippet || "",
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(`OpenAI API error ${response.status}: ${payload.error?.message ?? "unknown"}`);
    }
    const context = trimContext(responseText(payload));
    const validContext = validatePublicContext(context, material) ? context : fallbackProfessionalContext(material);
    return { context: validContext, generated: Boolean(validContext && context === validContext), failed: !validContext };
  } catch (error) {
    logger.warn?.("Professional context generation failed", error);
    return { context: fallbackProfessionalContext(material), generated: false, failed: true };
  }
}

export async function prepareMaterialContext(material, options = {}) {
  if (material?.professionalContextUk || material?.professional_context_uk) return material;

  const decision = decisionOf(material);
  const deterministic = decision.titleKeywordFallback || decision.priorityLevel || decision.materialCategory;
  if (deterministic && !options.forceOpenAiContext) {
    const context = fallbackProfessionalContext(material);
    return {
      ...material,
      professionalContextUk: context,
      contextBasis: context ? (material?.content ? "source_excerpt" : "rss_snippet") : "title_only",
      contextGeneration: { generated: false, failed: !context },
    };
  }

  const result = await generateProfessionalContext(material, options);
  return {
    ...material,
    professionalContextUk: result.context,
    contextGeneration: { generated: result.generated, failed: result.failed },
  };
}
