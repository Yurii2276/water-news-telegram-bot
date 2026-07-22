import { normalizeTitle } from "./dedup.js";

const SOURCE_SUFFIX_PATTERN =
  /\s+(?:[-–—|]\s*)?(?:Новини|News|ZAXID\.NET|Zaxid\.net|Суспільне(?:\s*\|\s*Новини)?|Укрінформ|Liga\.Biz|Politeka|Google News)\s*$/iu;

export const FORBIDDEN_GENERIC_CONTEXT_PATTERNS = [
  /матеріал\s+стосується/iu,
  /може\s+мати\s+значення/iu,
  /це\s+важливо\s+для\s+розуміння/iu,
  /може\s+бути\s+корисн(?:им|ою)\s+сигналом/iu,
  /локальна\s+новина\s+щодо/iu,
  /стану\s+мереж,\s*втрат\s+води,\s*аварійності\s+та\s+потреб\s+у\s+модернізації/iu,
];

const PUBLIC_CATEGORY_LABELS = {
  regulator: "Регулювання",
  government: "Регулювання",
  parliament: "Регулювання",
  association: "Водоканали",
  vodokanal: "Водоканали",
  local_media: "Ситуація в громаді",
  donor: "Міжнародна співпраця",
  international_tech: "Технології",
  general_news: "Водна безпека",
  personnel_change: "Кадрові рішення",
  tariffs: "Тарифи",
  technology: "Технології",
  donors: "Міжнародна співпраця",
  recovery: "Інвестиції",
  infrastructure: "Інвестиції",
  water_supply: "Водоканали",
  wastewater: "Водоканали",
};

const CATEGORY_EMOJI = {
  personnel_change: "👤",
  tariffs: "💰",
  regulator: "⚖️",
  government: "⚖️",
  parliament: "⚖️",
  recovery: "🏗️",
  infrastructure: "🏗️",
  technology: "⚙️",
  international_tech: "⚙️",
  donor: "🤝",
  donors: "🤝",
  vodokanal: "💧",
  association: "💧",
  local_media: "📍",
};

export const SOURCE_LINK_TEXT = "Читати джерело";

const TARIFF_PATTERN =
  /тариф|тарифи|тарифоутворення|вартість води|ціна на воду|плата за водопостачання|плата за водовідведення|підвищення тарифу|зниження тарифу|коригування тарифу|абонентська плата|економічно обґрунтований тариф/iu;

const REGULATION_PATTERN =
  /нкрекп|постанова|законопроєкт|законопроект|верховн\p{L}+\s+рад|кабмін|кабінет міністрів|регулятор|ліцензій|інвестиційна програма/iu;

const INVESTMENT_PATTERN =
  /інвестиці|грант|донор|кредит|позик|відновлен|реконструкц|модернізац|інфраструктур/iu;

const TECHNOLOGY_PATTERN =
  /smart water|leak detection|non[- ]revenue water|water supply technology|wastewater treatment|digital twin|smart metering|pressure management|water utility technology|очисн\p{L}+ споруд|стічн\p{L}+ вод|технолог/iu;

const INTERNATIONAL_PATTERN =
  /unicef|undp|un-water|who|world bank|ebrd|eib|european commission|oecd|unep|wash|міжнародн|донор|грант|технічна допомога/iu;

const VODOKANAL_PATTERN =
  /водоканал|водопостачання|водовідведення|питна вода|питне водопостачання|втрати води|зношені мережі/iu;

const LOCAL_SITUATION_PATTERN =
  /без води|відключенн|аварі|громад|район|міст[оаі]|селищ|обміління|дністер|каламутна вода/iu;

const RUSSIAN_TITLE_REPLACEMENTS = [
  [/\bКиеві\b/g, "Києві"],
  [/\bКиєві\b/g, "Києві"],
  [/\bКиеві\b/g, "Києві"],
  [/\bКиев\b/g, "Київ"],
  [/\bКиевский\b/gi, "київський"],
  [/\bкиевский\b/gi, "київський"],
  [/\bстоимость\b/gi, "вартість"],
  [/\bвырастет\b/gi, "зросте"],
  [/\bповышение\b/gi, "підвищення"],
  [/\bводоснабжение\b/gi, "водопостачання"],
  [/\bводоотведение\b/gi, "водовідведення"],
  [/\bотключение\b/gi, "відключення"],
  [/\bназначен\b/gi, "призначений"],
  [/\bуволен\b/gi, "звільнений"],
  [/\bтарифов\b/gi, "тарифів"],
];

const OBVIOUS_RUSSIAN_WORDS =
  /\b(?:Киев|Киеві|Киеві|киевский|стоимость|вырастет|повышение|водоснабжение|водоотведение|отключение|назначен|уволен|тарифов)\b/iu;

const SOURCE_QUALITY_ORDER = {
  official_regulator: 0,
  official_government: 1,
  official_parliament: 2,
  official_local_authority: 3,
  official_utility: 4,
  international_institution: 5,
  national_public_media: 6,
  national_media: 7,
  local_media: 8,
  aggregator: 9,
};

const EVENT_PATTERNS = [
  ["personnel", /признач|звільн|кадров|обрано|очолив|виконувач/i],
  ["tariff", /тариф|вартість води|абонплат/i],
  ["outage", /без води|відключенн|немає води|авар/i],
  ["investment", /інвестиц|грант|донор|відновлен|реконструкц|модернізац/i],
  ["technology", /smart water|leak detection|non[- ]revenue|wastewater treatment|digital water/i],
  ["regulation", /нкрекп|постанова|законопроєкт|рішення|кабмін|рада/i],
];

const LOCAL_INCIDENT_SIGNIFICANT =
  /район|міст[оаі]|кілька\s+населених|громад|тисяч|доб|дн[іья]|критичн|військ|обстріл|пошкоджен|забруднен|якість\s+вод|питн[аої]\s+вод|водоканал|магістральн|втрат[аи]\s+вод|зношен[і]\s+мереж/i;

const PERSONNEL_DECISION =
  /признач|звільн|погодив\s+призначення|поклав\s+обов'язки|виконувач|обрано|очолив/i;

const PERSONNEL_SCOPE =
  /кабінет\s+міністрів|кму|міністр|заступник\s+міністра|центральн[ийого]+\s+орган|нкрекп|держводагентств|давр|мінрозвитк|міндовкіл|комітет\s+верховної\s+ради|водоканал/i;

const GENERAL_POLITICS =
  /парті|вибор|кампані|скандал|суперечк|заява\s+депутат/i;

export function cleanTitle(title, sourceName = "") {
  let text = String(title ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return text;

  for (let index = 0; index < 4; index += 1) {
    const next = text
      .replace(SOURCE_SUFFIX_PATTERN, "")
      .replace(/\s+[-–—|]\s*(?:[A-ZА-ЯІЇЄҐ][\p{L}\d. ]{2,30})$/u, "")
      .trim();
    if (next === text) break;
    text = next;
  }

  if (sourceName) {
    const escaped = sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(`\\s+[-–—|]\\s*${escaped}\\s*$`, "iu"), "").trim();
  }

  return text;
}

export function deterministicUkrainianTitle(title, sourceName = "") {
  const cleaned = correctUkrainianTitle(cleanTitle(title, sourceName));
  if (/\p{Script=Latin}/u.test(cleaned) && !/\p{Script=Cyrillic}/u.test(cleaned)) {
    if (/smart water|leak detection|non[- ]revenue water/i.test(cleaned)) {
      return "Технології smart water для зменшення втрат води";
    }
    if (/wastewater/i.test(cleaned)) return "Нові технології очищення стічних вод";
    return cleaned;
  }
  if (/[ыэъё]/iu.test(cleaned)) {
    return cleaned
      .replace(/повышени[ея]/iu, "підвищення")
      .replace(/тарифов/iu, "тарифів")
      .replace(/на воду/iu, "на воду")
      .replace(/стоимость/iu, "вартість")
      .replace(/как/iu, "як");
  }
  return cleaned;
}

export function correctUkrainianTitle(title) {
  let text = String(title ?? "").replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of RUSSIAN_TITLE_REPLACEMENTS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

export function hasObviousRussianTitleWords(title) {
  return OBVIOUS_RUSSIAN_WORDS.test(String(title ?? ""));
}

function publicCategoryText(material) {
  const decision = material?.ai_decision ?? material?.aiDecision ?? {};
  return [
    material?.title,
    material?.displayTitleUk,
    material?.translatedTitle,
    material?.titleUk,
    material?.content,
    material?.summary,
    material?.snippet,
    material?.sourceName,
    material?.source_name,
    decision.materialCategory,
    decision.sourceCategory,
    decision.category,
  ]
    .filter(Boolean)
    .join(" ");
}

export function publicCategoryKey(material) {
  const decision = material?.ai_decision ?? material?.aiDecision ?? {};
  const text = publicCategoryText(material);
  if (isPersonnelChange(material) || decision.materialCategory === "personnel_change" || decision.category === "personnel_change") {
    return "personnel_change";
  }
  if (TARIFF_PATTERN.test(text) || decision.materialCategory === "tariffs" || decision.category === "tariffs") return "tariffs";
  if (REGULATION_PATTERN.test(text) || ["regulator", "government", "parliament"].includes(decision.materialCategory ?? decision.sourceCategory ?? material?.sourceCategory ?? material?.source_category)) {
    return decision.materialCategory === "personnel_change" ? "personnel_change" : (decision.materialCategory ?? decision.sourceCategory ?? material?.sourceCategory ?? material?.source_category ?? "regulator");
  }
  if (INVESTMENT_PATTERN.test(text) || ["recovery", "infrastructure"].includes(decision.materialCategory ?? decision.category)) return "recovery";
  if (TECHNOLOGY_PATTERN.test(text) || ["technology", "international_tech"].includes(decision.materialCategory ?? decision.category)) return "technology";
  if (INTERNATIONAL_PATTERN.test(text) || ["donor", "donors"].includes(decision.materialCategory ?? decision.sourceCategory ?? material?.sourceCategory ?? material?.source_category)) return "donor";
  if (VODOKANAL_PATTERN.test(text) || ["vodokanal", "association", "water_supply", "wastewater"].includes(decision.materialCategory ?? decision.sourceCategory ?? material?.sourceCategory ?? material?.source_category)) return "vodokanal";
  if (LOCAL_SITUATION_PATTERN.test(text) || (decision.materialCategory ?? decision.sourceCategory ?? material?.sourceCategory ?? material?.source_category) === "local_media") return "local_media";
  return "general_news";
}

export function publicCategoryLabel(material) {
  const category = publicCategoryKey(material);
  return PUBLIC_CATEGORY_LABELS[category] ?? PUBLIC_CATEGORY_LABELS.general_news;
}

export function publicCategoryEmoji(material) {
  const category = publicCategoryKey(material);
  return CATEGORY_EMOJI[category] ?? "💧";
}

export function hasForbiddenGenericContext(text) {
  return FORBIDDEN_GENERIC_CONTEXT_PATTERNS.some((pattern) => pattern.test(String(text ?? "")));
}

function words(value) {
  return normalizeTitle(value)
    .split(" ")
    .filter((word) => word.length > 3);
}

export function contextHasSourceFacts(context, sourceText) {
  const contextWords = new Set(words(context));
  const sourceWords = new Set(words(sourceText));
  let overlap = 0;
  for (const word of contextWords) if (sourceWords.has(word)) overlap += 1;
  return overlap >= Math.min(4, Math.max(2, contextWords.size));
}

export function validatePublicContext(context, material) {
  const text = String(context ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (hasForbiddenGenericContext(text)) return "";
  const sourceText = [material?.title, material?.content, material?.summary, material?.snippet]
    .filter(Boolean)
    .join(" ");
  if (!contextHasSourceFacts(text, sourceText)) return "";
  return text.slice(0, 650);
}

export function factualExtract(material) {
  const basis = material?.contextBasis ?? material?.context_basis ?? "title";
  const sourceText =
    basis === "title_only"
      ? ""
      : String(material?.content || material?.summary || material?.snippet || "");
  if (!sourceText.trim()) return "";
  const sentences = sourceText
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|(?<=\.)\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 35 && sentence.length <= 260)
    .filter((sentence) => contextHasSourceFacts(sentence, sourceText))
    .slice(0, 3);
  return validatePublicContext(sentences.join(" "), material);
}

export function publicDescriptionSentences(material, maxSentences = 10) {
  const basis = material?.contextBasis ?? material?.context_basis ?? "title";
  if (basis === "title_only") return [];
  const sourceText = String(material?.content || material?.summary || material?.snippet || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!sourceText) return [];
  const seen = new Set();
  return sourceText
    .split(/(?<=[.!?])\s+|(?<=\.)\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 35 && sentence.length <= 360)
    .filter((sentence) => !hasForbiddenGenericContext(sentence))
    .filter((sentence) => contextHasSourceFacts(sentence, sourceText))
    .filter((sentence) => {
      const key = normalizeTitle(sentence).slice(0, 120);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxSentences);
}

export function buildPublicDescription(material, { minSentences = 5, maxSentences = 10 } = {}) {
  const sentences = publicDescriptionSentences(material, maxSentences);
  if (sentences.length < minSentences) return "";
  return sentences.join(" ").slice(0, 1800);
}

export function standalonePublicationEligibility(material) {
  const basis = material?.contextBasis ?? material?.context_basis ?? "title";
  const description = buildPublicDescription(material);
  if (description) return { eligible: true, description, basis };
  return {
    eligible: false,
    reason: basis === "title_only" ? "title_only" : "insufficient_public_context",
    basis,
  };
}

export function visibleTextFromHtml(html) {
  return String(html ?? "")
    .replace(/<a\b[^>]*href=(["'])https?:\/\/[^"']+\1[^>]*>(.*?)<\/a>/giu, "$2")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasVisibleRawUrl(html) {
  return /https?:\/\//iu.test(visibleTextFromHtml(html));
}

export function validatePublicMessage(html) {
  if (hasVisibleRawUrl(html)) {
    throw new Error("Public Telegram message contains a visible raw URL");
  }
  return html;
}

export function inferSourceQuality(material) {
  const haystack = `${material?.sourceId ?? material?.source_id ?? ""} ${material?.sourceName ?? material?.source_name ?? ""} ${material?.url ?? ""}`.toLowerCase();
  if (/nerc|нкрекп/.test(haystack)) return "official_regulator";
  if (/kmu|cabinet|mindev|mepr|davr|gov\.ua|міністер|держвод/.test(haystack)) return "official_government";
  if (/rada|комітет/.test(haystack)) return "official_parliament";
  if (/city|rada\.gov\.ua|міськ|селищ|сільськ/.test(haystack)) return "official_local_authority";
  if (/vodokanal|водоканал/.test(haystack)) return "official_utility";
  if (/unicef|undp|worldbank|world bank|ebrd|usaid|europa/.test(haystack)) return "international_institution";
  if (/suspilne|суспільне|ukrinform|укрінформ/.test(haystack)) return "national_public_media";
  if (/liga|epravda|interfax|forbes|nv\.ua/.test(haystack)) return "national_media";
  if (/google news|google_news|politeka|aggregator/.test(haystack)) return "aggregator";
  return "local_media";
}

export function sourceQualityRank(material) {
  return SOURCE_QUALITY_ORDER[inferSourceQuality(material)] ?? SOURCE_QUALITY_ORDER.local_media;
}

function eventType(text) {
  return EVENT_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? "general";
}

function cityToken(text) {
  const match = text.match(/\b(?:у|в)\s+([А-ЯІЇЄҐ][а-яіїєґ'-]{3,})/u);
  return match?.[1]?.toLocaleLowerCase("uk") ?? "";
}

function organizationToken(text) {
  const match = text.match(/(?:НКРЕКП|КМУ|Кабмін|Верховн\w+\s+Рад\w+|[А-ЯІЇЄҐ][\p{L}'-]*водоканал)/u);
  return match?.[0]?.toLocaleLowerCase("uk") ?? "";
}

function numberToken(text) {
  return [...text.matchAll(/\b\d+(?:[,.]\d+)?\s*(?:грн|%|млн|тис|куб|м³)?/giu)]
    .map((match) => match[0].toLocaleLowerCase("uk"))
    .slice(0, 3)
    .join("-");
}

export function createStoryKey(material) {
  const text = [cleanTitle(material?.title), material?.content, material?.summary, material?.snippet]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
  const titleTokens = words(text)
    .filter((word) => !["новини", "повідомили", "розповіли", "сьогодні"].includes(word))
    .slice(0, 8)
    .join("-");
  return [
    eventType(text),
    organizationToken(text),
    cityToken(text),
    numberToken(text),
    titleTokens,
  ]
    .filter(Boolean)
    .join(":")
    .slice(0, 220);
}

export function choosePrimaryStoryMaterial(materials) {
  return [...materials].sort((left, right) => {
    const source = sourceQualityRank(left) - sourceQualityRank(right);
    if (source !== 0) return source;
    const leftPriority = left.ai_decision?.priorityScore ?? left.aiDecision?.priorityScore ?? 0;
    const rightPriority = right.ai_decision?.priorityScore ?? right.aiDecision?.priorityScore ?? 0;
    return rightPriority - leftPriority;
  })[0];
}

export function uniqueStoryMaterials(materials, limit = Infinity) {
  const groups = new Map();
  for (const material of materials) {
    const key = material.story_key ?? material.storyKey ?? createStoryKey(material);
    const group = groups.get(key) ?? [];
    group.push(material);
    groups.set(key, group);
  }
  return [...groups.values()].map(choosePrimaryStoryMaterial).slice(0, limit);
}

export function isSignificantLocalIncident(material) {
  const decision = material?.ai_decision ?? material?.aiDecision ?? {};
  const category = decision.materialCategory ?? material?.sourceCategory ?? material?.source_category;
  if (category !== "local_media") return true;
  const text = [material?.title, material?.content, material?.summary, material?.snippet].filter(Boolean).join(" ");
  if (/одн\p{L}*\s+вулиц|кільк\p{L}*\s+годин|планов\p{L}*\s+ремонт|тимчасов\p{L}*\s+ремонт/iu.test(text)) return false;
  return LOCAL_INCIDENT_SIGNIFICANT.test(text);
}

export function isPersonnelChange(material) {
  const text = [material?.title, material?.content, material?.summary, material?.snippet].filter(Boolean).join(" ");
  return PERSONNEL_DECISION.test(text) && PERSONNEL_SCOPE.test(text) && !GENERAL_POLITICS.test(text);
}
