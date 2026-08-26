const HOT_WATER_ONLY = /гаряч\p{L}*\s+вод|теплопостач|опален/iu;
const CENTRAL_WATER_EXCEPTION = /водоканал|водопостач|водовідвед|питн\p{L}*\s+вод|холодн\p{L}*\s+вод|тариф\p{L}*.*вод|водопров|водогін|каналіз|очисн\p{L}*\s+споруд/iu;
const FLOOD_ONLY = /повін|павод|затоплен|злива|дощ|ураган|шторм/iu;
const INFRASTRUCTURE_OR_SERVICE = /водоканал|водопостач|водовідвед|водопров|водогін|каналіз|очисн\p{L}*\s+споруд|питн\p{L}*\s+вод|комунальн\p{L}*\s+послуг|мереж|насосн|станці|резервуар|скважин|свердловин/iu;

const STRONG_SECTOR_SIGNAL = /водоканал|водопостач|водовідвед|водопров|водогін|каналіз|очисн\p{L}*\s+споруд|питн\p{L}*\s+вод|водн\p{L}*\s+безпек|водн\p{L}*\s+інфраструктур|водн\p{L}*\s+ресурс|колодязн\p{L}*\s+вод|втрат\p{L}*\s+вод|non[- ]revenue water|smart water|leak detection|water supply|wastewater|water utility|WASH|sanitation|sewer|drinking water/iu;
const WATER_WORD = /вод\p{L}*|water/iu;
const WATER_ACTION_OR_POLICY = /тариф|ціна|вартіст|подорожча|якіст|безпечн|забруднен|лаборатор|аналіз|моніторинг|відключ|перекрил|припинен|подач|авар|витік|ремонт|реконструкц|модерніз|відновлен|інвестиц|грант|кредит|фінансув|донор|програм|проєкт|проект|стратег|закон|постанова|регулюван|ліцензі|енергоефектив|цифров|лічильник|облік|очищенн|санітар|хлорид|сульфат|мікробіолог|дефіцит|посух|забір|водозабір/iu;
const WATER_RESOURCE_SIGNAL = /річк|водосховищ|підземн\p{L}*\s+вод|басейн\p{L}*\s+річ|водн\p{L}*\s+ресурс|водозабір|водокористув/iu;
const RESOURCE_ACTION = /якіст|забруднен|моніторинг|управлін|стратег|дефіцит|посух|відновлен|очищенн|забір|ліміт|дозвіл|програм/iu;

const WATER_NATIVE_SOURCE_IDS = new Set(["davr", "ukrvodokanal"]);

function textOf(material) {
  return [material?.title, material?.summary, material?.snippet, material?.sourceName, material?.source_name]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isWaterNativeSource(material) {
  return WATER_NATIVE_SOURCE_IDS.has(String(material?.sourceId ?? material?.source_id ?? ""));
}

export function isBroadWaterSectorCandidate(material) {
  const text = textOf(material);
  if (!text) return false;

  if (HOT_WATER_ONLY.test(text) && !CENTRAL_WATER_EXCEPTION.test(text)) return false;
  if (FLOOD_ONLY.test(text) && !INFRASTRUCTURE_OR_SERVICE.test(text)) return false;
  if (isWaterNativeSource(material)) return true;
  if (STRONG_SECTOR_SIGNAL.test(text)) return true;
  if (WATER_WORD.test(text) && WATER_ACTION_OR_POLICY.test(text)) return true;
  if (WATER_RESOURCE_SIGNAL.test(text) && RESOURCE_ACTION.test(text)) return true;
  return false;
}

export function shouldDeepInspectCandidate(material) {
  const sourceId = String(material?.sourceId ?? material?.source_id ?? "");
  const discoveryMethod = String(material?.discoveryMethod ?? material?.discovery_method ?? "");
  if (sourceId === "google_news" || discoveryMethod.startsWith("google_news")) return true;
  return isBroadWaterSectorCandidate(material);
}
