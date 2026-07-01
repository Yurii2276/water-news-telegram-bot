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
    /vodopostach/i,
    /водозаб/i,
    /водогон/i,
    /vodogon/i,
    /водопров/i,
    /водозабезпеч/i,
  ],
  wastewater: [
    /водовідвед/i,
    /vodovidved/i,
    /стічн\p{L}*\s+вод/iu,
    /каналізац/i,
  ],
  tariffs: [/тариф/i, /taryf/i, /абонплат/i, /вартіст\p{L}*\s+послуг/iu],
  utilities: [/водоканал/i, /vodokanal/i, /водопровідно-каналізаці/i],
  drinking_water: [
    /питн\p{L}*\s+вод/iu,
    /pyt\w*[- ]vod/i,
    /якіст\p{L}*\s+вод/iu,
  ],
  treatment: [
    /очисн\p{L}*\s+споруд/iu,
    /ochysn/i,
    /очищенн\p{L}*\s+вод/iu,
    /фільтрувальн/i,
  ],
  legislation: [
    /законопроєкт/i,
    /законодав/i,
    /постанов\p{L}*\s+(?:уряду|кабінет)/iu,
    /регулюван/i,
    /ліцензі/i,
  ],
  recovery: [/відновлен/i, /відбудов/i, /модерніз/i, /реконструкц/i],
  donors: [
    /донор/i,
    /грант/i,
    /міжнародн\p{L}*\s+(?:допомог|фінансув|партнер)/iu,
    /юнісеф/i,
    /єіб/i,
    /світов\w*\s+банк/i,
  ],
  events: [
    /форум/i,
    /конференц/i,
    /вебінар/i,
    /кругл\p{L}*\s+стіл/iu,
    /семінар/i,
  ],
};

const WATER_CONTEXT_PATTERNS = [
  /водопостач/i,
  /водовідвед/i,
  /водоканал/i,
  /водогон/i,
  /питн\p{L}*\s+вод/iu,
  /стічн\p{L}*\s+вод/iu,
  /очисн\p{L}*\s+споруд/iu,
  /водопровідно-каналізаці/i,
  /vodopostach/i,
  /vodovidved/i,
  /vodokanal/i,
  /vodogon/i,
  /pyt\w*[- ]vod/i,
  /ochysn/i,
];

export function preliminaryFilter(material) {
  const haystack = [material.title, material.summary, material.content]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ");

  const categories = Object.entries(TOPIC_PATTERNS)
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(haystack)))
    .map(([category]) => category);
  const hasWaterContext = WATER_CONTEXT_PATTERNS.some((pattern) =>
    pattern.test(haystack),
  );

  return {
    relevant: hasWaterContext,
    categories,
    reason:
      hasWaterContext
        ? `Matched topics: ${categories.join(", ")}`
        : categories.length > 0
          ? "Supporting topic found without water-supply or wastewater context"
          : "No water-sector topic matched",
  };
}
