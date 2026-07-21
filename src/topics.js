export const TOPIC_CATEGORIES = [
  "water_supply",
  "wastewater",
  "tariffs",
  "utilities",
  "drinking_water",
  "treatment",
  "legislation",
  "recovery",
  "donors",
  "events",
  "technology",
  "infrastructure",
  "outages",
];

export const SOURCE_CATEGORIES = [
  "regulator",
  "government",
  "parliament",
  "association",
  "personnel_change",
  "vodokanal",
  "local_media",
  "donor",
  "international_tech",
  "general_news",
];

export const PRIORITY_LEVELS = ["high", "medium", "low"];

export const PUBLICATION_CATEGORY_ORDER = [
  "normative_act",
  "regulator",
  "government",
  "parliament",
  "association",
  "donor",
  "international_tech",
  "vodokanal",
  "general_news",
  "local_media",
];

const TOPIC_PATTERNS = {
  water_supply: [
    /водопостач/i,
    /водозаб/i,
    /водог[іо]н/i,
    /водопров/i,
    /водозабезпеч/i,
    /vodopostach|vodogon/i,
  ],
  wastewater: [/водовідвед/i, /стічн\p{L}*\s+вод/iu, /каналізац/i, /vodovidved/i],
  tariffs: [/тариф/i, /абонплат/i, /вартіст\p{L}*\s+послуг/iu, /taryf/i],
  utilities: [/водоканал/i, /водопровідно-каналізаці/i, /vodokanal/i],
  drinking_water: [
    /питн\p{L}*\s+вод/iu,
    /якіст\p{L}*\s+вод/iu,
    /pyt\w*[- ]vod/i,
  ],
  treatment: [
    /очисн\p{L}*\s+споруд/iu,
    /очищенн\p{L}*\s+вод/iu,
    /фільтрувальн/i,
    /ochysn/i,
  ],
  legislation: [
    /законопроєкт|законопроект/i,
    /законодав/i,
    /постанов\p{L}*\s+(?:уряду|кабінет)/iu,
    /регулюван/i,
    /ліцензі/i,
  ],
  recovery: [
    /відновлен/i,
    /відбудов/i,
    /модерніз/i,
    /реконструкц/i,
    /інфраструктур/i,
  ],
  donors: [
    /донор/i,
    /грант/i,
    /міжнародн\p{L}*\s+(?:допомог|фінансув|партнер)/iu,
    /юнісеф/i,
    /єіб/i,
    /світов\p{L}*\s+банк/iu,
    /water recovery/i,
  ],
  events: [
    /форум/i,
    /конференц/i,
    /вебінар/i,
    /кругл\p{L}*\s+стіл/iu,
    /семінар/i,
  ],
  technology: [
    /smart water/i,
    /leak detection/i,
    /non[- ]revenue water/i,
    /wastewater treatment/i,
    /wastewater technology/i,
    /water supply technology/i,
    /water supply infrastructure/i,
    /water infrastructure/i,
    /digital water/i,
  ],
};

const DIRECT_WATER_CONTEXT = [
  /водопостач/i,
  /водовідвед/i,
  /водоканал/i,
  /водог[іо]н/i,
  /водопров/i,
  /питн\p{L}*\s+вод/iu,
  /стічн\p{L}*\s+вод/iu,
  /очисн\p{L}*\s+споруд/iu,
  /водопровідно-каналізаці/i,
  /vodopostach|vodovidved|vodokanal|vodogon|ochysn/i,
  /pyt\w*[- ]vod/i,
];

const STRONG_TITLE_KEYWORDS = [
  ["водоканал", /водоканал/i],
  ["водопостачання", /водопостач/i],
  ["водовідведення", /водовідвед/i],
  ["централізоване водопостачання", /централізован\p{L}*\s+водопостач/iu],
  ["тариф на воду", /тариф\p{L}*\s+на\s+вод/iu],
  ["тарифи на воду", /тариф(?:и|ів|ами)?\s+на\s+вод/iu],
  ["вартість води", /вартіст\p{L}*\s+вод/iu],
  ["без води", /без\s+води/iu],
  ["питна вода", /питн\p{L}*\s+вод/iu],
  ["питне водопостачання", /питн\p{L}*\s+водопостач/iu],
  ["втрати води", /втрат\p{L}*\s+вод/iu],
  ["зношені мережі", /зношен\p{L}*\s+мереж/iu],
  ["каламутна вода", /каламутн\p{L}*\s+вод/iu],
  ["обміління", /обмілін/i],
  ["Дністер", /дністер/i],
  ["НКРЕКП", /нкрекп/i],
];

const HOT_WATER_OR_HEATING = /гаряч\p{L}*\s+вод|опален|теплопостач/iu;
const WATER_UTILITY_EXCEPTION = /водоканал|водопостач|водовідвед|питн\p{L}*\s+вод|тариф\p{L}*\s+на\s+вод|без\s+води|аварі\p{L}*\s+(?:на\s+)?(?:водопровод|мереж)|комунальн\p{L}*\s+послуг/iu;

const PROFESSIONAL_STRONG_KEYWORDS = [
  ["НКРЕКП", /нкрекп/i],
  ["тарифи на централізоване водопостачання", /тариф\p{L}*\s+на\s+централізован\p{L}*\s+водопостач/iu],
  ["тарифи на централізоване водовідведення", /тариф\p{L}*\s+на\s+централізован\p{L}*\s+водовідвед/iu],
  ["централізоване водопостачання", /централізован\p{L}*\s+водопостач/iu],
  ["централізоване водовідведення", /централізован\p{L}*\s+водовідвед/iu],
  ["інвестиційна програма водоканалу", /інвестиційн\p{L}*\s+програм\p{L}*.*водоканал/iu],
  ["схема водопостачання", /схем\p{L}*\s+водопостач/iu],
  ["водна стратегія", /водн\p{L}*\s+стратег/iu],
  ["питна вода", /питн\p{L}*\s+вод/iu],
  ["якість питної води", /якіст\p{L}*\s+питн\p{L}*\s+вод/iu],
  ["водна безпека", /водн\p{L}*\s+безпек/iu],
  ["WASH", /\bWASH\b/i],
  ["донорський проєкт", /донорськ\p{L}*\s+про[єе]кт/iu],
  ["реконструкція водопроводу", /реконструкці\p{L}*\s+водопровод/iu],
  ["реконструкція очисних споруд", /реконструкці\p{L}*\s+очисн\p{L}*\s+споруд/iu],
  ["каналізаційні очисні споруди", /каналізаційн\p{L}*\s+очисн\p{L}*\s+споруд/iu],
  ["водна інфраструктура", /водн\p{L}*\s+інфраструктур/iu],
  ["аварія на водогоні", /аварі\p{L}*\s+на\s+водогон/iu],
  ["магістральний водогін", /магістральн\p{L}*\s+водогін/iu],
  ["без води", /без\s+води/iu],
  ["не буде води", /не\s+буде\s+води/iu],
  ["відключення води", /відключенн\p{L}*\s+вод/iu],
  ["non-revenue water", /non[- ]revenue water/i],
  ["smart water", /smart water/i],
  ["leak detection", /leak detection/i],
  ["wastewater treatment", /wastewater treatment/i],
  ["sludge treatment", /sludge treatment/i],
  ["digital water utility", /digital water utility/i],
  ["wastewater reuse", /wastewater reuse/i],
  ["desalination technology", /desalination technology/i],
  ["energy efficiency in water utilities", /energy efficiency.*water utilit/i],
  ["smart water infrastructure", /smart water infrastructure/i],
  ["water supply technology", /water supply technology/i],
  ["water supply infrastructure", /water supply infrastructure/i],
  ["water supply innovation", /water supply innovation/i],
  ["wastewater technology", /wastewater technology/i],
  ["donor water infrastructure", /(?:donor|grant|funding|recovery).*(?:water|wastewater).*(?:infrastructure|utility|network)/i],
];

const HIGH_PRIORITY_CONTEXT = /нкрекп|тариф|інвестиційн\p{L}*\s+програм|законопро[єе]кт|законодав|кабінет|міністерств|відновлен|реконструкц|WASH|донор|грант|world bank|ebrd|unicef|undp|usaid|ukraine facility|очисн\p{L}*\s+споруд|водн\p{L}*\s+безпек/iu;
const MEDIUM_PRIORITY_CONTEXT = /водоканал|водопостач|водовідвед|питн\p{L}*\s+вод|якіст\p{L}*\s+вод|ремонт|інфраструктур|smart water|wastewater treatment|leak detection|non[- ]revenue water|sludge treatment|digital water/iu;
const LOCAL_OUTAGE_CONTEXT = /без\s+води|відключенн\p{L}*\s+вод|не\s+буде\s+води|водопостачанн\p{L}*\s+відсутн/iu;
const LARGE_OUTAGE_CONTEXT = /район|міст[оаі]|обласн\p{L}*\s+центр|тисяч\p{L}*\s+(?:жител|мешкан)|доб\p{L}|дні|критичн\p{L}*\s+інфраструктур|питн\p{L}*\s+вод|якіст\p{L}*\s+вод|водоканал|водн\p{L}*\s+безпек/iu;
const ROUTINE_SMALL_REPAIR = /одн\p{L}*\s+вулиц|кільк\p{L}*\s+годин|планов\p{L}*\s+ремонт|тимчасов\p{L}*\s+ремонт|ремонтн\p{L}*\s+робот/iu;
const FLOOD_EMERGENCY_ONLY = /потоп|повін|затоплен|загинув|смерт|рятувальник|дснс/iu;
const WATER_INFRASTRUCTURE_EXCEPTION = /водопостач|водовідвед|питн\p{L}*\s+вод|водоканал|водогін|водопров|стічн\p{L}*\s+вод|очисн\p{L}*\s+споруд|комунальн\p{L}*\s+послуг|водн\p{L}*\s+інфраструктур/iu;
const ENERGY_ONLY_TARIFF = /електроенерг|енергетик|газ|тепло|опален/iu;
const NORMATIVE_ACT_CONTEXT = /постанова|проєкт постанови|проект постанови|рішення\s+НКРЕКП|порядок денний\s+НКРЕКП|засідання\s+НКРЕКП|законопро[єе]кт|проєкт закону|проект закону|комітет Верховної Ради|рішення\s+КМУ|КМУ.*рішення|постанова\s+КМУ|КМУ.*постанов|розпорядження\s+КМУ|КМУ.*розпорядження|наказ міністерства|регуляторний акт|тариф|інвестиційна програма|resolution|draft resolution|bill|draft law|regulatory act|tariff|investment program/iu;

function hasRoutineSmallRepairText(text) {
  const normalized = text.toLowerCase();
  return (
    normalized.includes("одній вулиці") ||
    normalized.includes("одна вулиця") ||
    normalized.includes("кілька годин") ||
    normalized.includes("плановий ремонт") ||
    normalized.includes("тимчасовий ремонт")
  );
}

export function titleKeywordFallback(title) {
  const normalizedTitle = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!normalizedTitle) return { accepted: false, keyword: null };
  if (HOT_WATER_OR_HEATING.test(normalizedTitle) && !WATER_UTILITY_EXCEPTION.test(normalizedTitle)) {
    return { accepted: false, keyword: null };
  }
  if (ENERGY_ONLY_TARIFF.test(normalizedTitle) && !WATER_INFRASTRUCTURE_EXCEPTION.test(normalizedTitle)) {
    return { accepted: false, keyword: null };
  }
  const match = [...PROFESSIONAL_STRONG_KEYWORDS, ...STRONG_TITLE_KEYWORDS]
    .find(([, pattern]) => pattern.test(normalizedTitle));
  return match
    ? { accepted: true, keyword: match[0] }
    : { accepted: false, keyword: null };
}

function hasCategory(categories, category) {
  return categories.includes(category);
}

export function preliminaryFilter(material) {
  const haystack = [material.title, material.summary, material.content]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");

  const categories = Object.entries(TOPIC_PATTERNS)
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(haystack)))
    .map(([category]) => category);

  const directWaterContext = DIRECT_WATER_CONTEXT.some((pattern) =>
    pattern.test(haystack),
  );
  const nercContext =
    material.sourceId === "nerc" &&
    /нкрекп|тариф|регулюван|моніторинг|ліцензі/i.test(haystack);
  const communityInfrastructure =
    /громад/i.test(haystack) &&
    /(інфраструктур|відновлен|відбудов|модерніз|донор|грант|проєкт|програм)/i.test(
      haystack,
    );
  const recoveryInfrastructure =
    hasCategory(categories, "recovery") &&
    /інфраструктур|комунальн\p{L}*\s+підприємств/iu.test(haystack);
  const donorProject =
    hasCategory(categories, "donors") &&
    /проєкт|проект|програм|громад|інфраструктур/i.test(haystack);
  const waterLegislation =
    hasCategory(categories, "legislation") &&
    /вод|water|vod/i.test(haystack);
  const professionalTitleContext =
    PROFESSIONAL_STRONG_KEYWORDS.some(([, pattern]) => pattern.test(haystack)) &&
    (!ENERGY_ONLY_TARIFF.test(haystack) || WATER_INFRASTRUCTURE_EXCEPTION.test(haystack));
  const relevant =
    directWaterContext ||
    nercContext ||
    communityInfrastructure ||
    recoveryInfrastructure ||
    donorProject ||
    waterLegislation ||
    professionalTitleContext;

  return {
    relevant,
    categories,
    reason: relevant
      ? `Matched topics: ${categories.join(", ") || "sector context"}`
      : categories.length > 0
        ? "Supporting topic found without water-sector context"
        : "No water-sector topic matched",
  };
}

function textOf(material) {
  return [material?.title, material?.summary, material?.snippet, material?.content]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");
}

export function inferSourceCategory(material) {
  const explicit = material?.sourceCategory ?? material?.source_category;
  if (SOURCE_CATEGORIES.includes(explicit)) return explicit;
  const sourceId = String(material?.sourceId ?? material?.source_id ?? "");
  const sourceName = String(material?.sourceName ?? material?.source_name ?? "");
  const url = String(material?.url ?? "");
  const haystack = `${sourceId} ${sourceName} ${url}`.toLowerCase();
  if (/nerc|нкрекп/.test(haystack)) return "regulator";
  if (/rada|закон|committee|комітет/.test(haystack)) return "parliament";
  if (/kmu|cabinet|mindev|davr|ministry|міністер|держвод/.test(haystack)) return "government";
  if (/auc|association|асоціац|ukrvodokanal/.test(haystack)) return "association";
  if (/vodokanal|водоканал/.test(haystack)) return "vodokanal";
  if (/unicef|worldbank|world bank|ebrd|undp|usaid|europa|donor|wash/.test(haystack)) return "donor";
  if (/technology|smart-water|waterworld|iwa|aquatech/.test(haystack)) return "international_tech";
  if (/google_news|google news/.test(haystack)) return "general_news";
  return "general_news";
}

export function inferMaterialCategory(material, preliminaryCategories = []) {
  const existing = material?.ai_decision?.materialCategory ?? material?.aiDecision?.materialCategory;
  if (SOURCE_CATEGORIES.includes(existing)) return existing;
  const sourceCategory = inferSourceCategory(material);
  if (sourceCategory !== "general_news") return sourceCategory;
  const text = textOf(material);
  if (/(признач|звільн|керівник|директор|CEO|chief executive|appointed|resigned)/iu.test(text) && /(водоканал|water utility|water sector|НКРЕКП|nerc)/iu.test(text)) {
    return "personnel_change";
  }
  if (/smart water|wastewater treatment|wastewater technology|water supply technology|water supply infrastructure|non[- ]revenue water|leak detection|sludge treatment|digital water|desalination/i.test(text)) {
    return "international_tech";
  }
  if (/водоканал/iu.test(text)) return "vodokanal";
  if (LOCAL_OUTAGE_CONTEXT.test(text)) return "local_media";
  if (preliminaryCategories.includes("donors")) return "donor";
  if (preliminaryCategories.includes("legislation")) return "parliament";
  return "general_news";
}

export function isNoiseOnly(material) {
  const text = textOf(material);
  if (HOT_WATER_OR_HEATING.test(text) && !WATER_UTILITY_EXCEPTION.test(text)) return true;
  if (FLOOD_EMERGENCY_ONLY.test(text) && !WATER_INFRASTRUCTURE_EXCEPTION.test(text)) return true;
  return false;
}

export function isNormativeAct(material) {
  return NORMATIVE_ACT_CONTEXT.test(textOf(material));
}

export function classifyMaterialProfile(material, preliminaryCategories = []) {
  const text = textOf(material);
  const sourceCategory = inferSourceCategory(material);
  const materialCategory = inferMaterialCategory(material, preliminaryCategories);
  const normativeAct = isNormativeAct(material);
  const localOutageOnly = LOCAL_OUTAGE_CONTEXT.test(text) &&
    !HIGH_PRIORITY_CONTEXT.test(text) &&
    !LARGE_OUTAGE_CONTEXT.test(text);
  const routineSmallRepair = ROUTINE_SMALL_REPAIR.test(text) &&
    (LOCAL_OUTAGE_CONTEXT.test(text) || /ремонт/iu.test(text)) &&
    !HIGH_PRIORITY_CONTEXT.test(text) &&
    !LARGE_OUTAGE_CONTEXT.test(text);
  const routineSmallRepairText =
    hasRoutineSmallRepairText(text) &&
    (LOCAL_OUTAGE_CONTEXT.test(text) || /ремонт/iu.test(text)) &&
    !HIGH_PRIORITY_CONTEXT.test(text);

  let priorityLevel = "medium";
  let priorityScore = 60;

  if (normativeAct) {
    priorityLevel = "high";
    priorityScore = 98;
  } else if (
    ["regulator", "government", "parliament", "association", "donor"].includes(sourceCategory) ||
    HIGH_PRIORITY_CONTEXT.test(text)
  ) {
    priorityLevel = "high";
    priorityScore = 90;
  } else if (materialCategory === "international_tech" || MEDIUM_PRIORITY_CONTEXT.test(text)) {
    priorityLevel = "medium";
    priorityScore = 65;
  }

  if (localOutageOnly || routineSmallRepair || routineSmallRepairText || materialCategory === "local_media") {
    priorityLevel = "low";
    priorityScore = routineSmallRepair || routineSmallRepairText ? 25 : 35;
  }

  if (LOCAL_OUTAGE_CONTEXT.test(text) && LARGE_OUTAGE_CONTEXT.test(text) && !(routineSmallRepair || routineSmallRepairText)) {
    priorityLevel = priorityLevel === "high" ? "high" : "medium";
    priorityScore = Math.max(priorityScore, 60);
  }

  return {
    sourceCategory,
    materialCategory,
    priorityLevel,
    priorityScore,
    normativeAct,
    normative_act: normativeAct,
    localOutageOnly,
    routineSmallRepair: routineSmallRepair || routineSmallRepairText,
  };
}

export function enrichDecisionWithProfile(decision, material, preliminaryCategories = []) {
  const profile = classifyMaterialProfile(material, preliminaryCategories);
  return {
    ...decision,
    ...profile,
    importance: Math.max(decision?.importance ?? 0, profile.priorityScore),
  };
}
