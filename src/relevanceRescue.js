const HOT_WATER_OR_HEATING = /гаряч\p{L}*\s+вод|опален|теплопостач/iu;
const CENTRAL_WATER_EXCEPTION = /водоканал|водопостач|водовідвед|питн\p{L}*\s+вод|тариф\p{L}*.*вод|ціна\p{L}*.*вод|вартіст\p{L}*.*вод|комунальн\p{L}*\s+послуг/iu;

const RESCUE_PATTERNS = [
  {
    keyword: "вартість або тариф на воду",
    category: "tariffs",
    pattern: /(?:скільки\s+кошту\p{L}*\s+вод|вод\p{L}*\s+подорожча|ціна\p{L}*\s+на\s+вод|вартіст\p{L}*\s+вод|тариф\p{L}*(?:.{0,40})\s+вод)/iu,
  },
  {
    keyword: "якість води",
    category: "drinking_water",
    pattern: /(?:якіст\p{L}*\s+(?:питн\p{L}*\s+)?вод|лабораторн\p{L}*\s+перевір\p{L}*(?:.{0,60})\s+вод|безпечн\p{L}*\s+питн\p{L}*\s+вод)/iu,
  },
  {
    keyword: "відключення або перекриття води",
    category: "outages",
    pattern: /(?:перекрил\p{L}*\s+вод|припин\p{L}*(?:.{0,30})\s+подач\p{L}*\s+вод|відключ\p{L}*\s+вод|нема\p{L}*\s+вод|залиш\p{L}*(?:.{0,30})\s+без\s+вод)/iu,
  },
  {
    keyword: "забруднення або небезпечна вода",
    category: "drinking_water",
    pattern: /(?:забруднен\p{L}*(?:.{0,50})\s+вод|вод\p{L}*(?:.{0,30})\s+забруднен|отруєн\p{L}*(?:.{0,50})\s+вод|колодязн\p{L}*\s+вод|перевищенн\p{L}*(?:.{0,50})(?:хлорид|сульфат|мікробіолог))/iu,
  },
  {
    keyword: "водні ресурси та водокористування",
    category: "water_supply",
    pattern: /(?:водокористуван|водн\p{L}*\s+ресурс|водност\p{L}*\s+річ|обмеженн\p{L}*\s+водокористуван|охорон\p{L}*(?:.{0,50})\s+вод|збереженн\p{L}*(?:.{0,50})\s+водност|басейн\p{L}*\s+річ|управлінн\p{L}*\s+водн\p{L}*\s+ресурс)/iu,
  },
  {
    keyword: "водне законодавство",
    category: "legislation",
    pattern: /(?:законопро[єе]кт|закон|комітет\s+ВРУ|екокомітет)(?:.{0,120})(?:водн\p{L}*\s+ресурс|водност|водокористуван|охорон\p{L}*\s+вод|забруднен\p{L}*\s+вод)/iu,
  },
  {
    keyword: "водні комунальні послуги",
    category: "utilities",
    pattern: /комунальн\p{L}*\s+послуг\p{L}*(?:.{0,80})(?:вод|водопостач|водовідвед)|(?:вод|водопостач|водовідвед)(?:.{0,80})комунальн\p{L}*\s+послуг/iu,
  },
];

export function rescueTitleFallback(material) {
  const text = [material?.title, material?.summary, material?.snippet]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return { accepted: false, keyword: null, category: null };
  if (HOT_WATER_OR_HEATING.test(text) && !CENTRAL_WATER_EXCEPTION.test(text)) {
    return { accepted: false, keyword: null, category: null };
  }
  const match = RESCUE_PATTERNS.find((item) => item.pattern.test(text));
  return match
    ? { accepted: true, keyword: match.keyword, category: match.category }
    : { accepted: false, keyword: null, category: null };
}
