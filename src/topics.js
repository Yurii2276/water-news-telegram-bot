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

export function titleKeywordFallback(title) {
  const normalizedTitle = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!normalizedTitle) return { accepted: false, keyword: null };
  if (HOT_WATER_OR_HEATING.test(normalizedTitle) && !WATER_UTILITY_EXCEPTION.test(normalizedTitle)) {
    return { accepted: false, keyword: null };
  }
  const match = STRONG_TITLE_KEYWORDS.find(([, pattern]) => pattern.test(normalizedTitle));
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
  const relevant =
    directWaterContext ||
    nercContext ||
    communityInfrastructure ||
    recoveryInfrastructure ||
    donorProject ||
    waterLegislation;

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
