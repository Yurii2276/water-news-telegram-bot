import {
  contextHasSourceFacts,
  factualExtract,
  hasForbiddenGenericContext,
  hasVisibleRawUrl,
  publicDescriptionSentenceCount,
  publicDescriptionSourceBasis,
  validatePublicContext,
} from "./editorial.js";

function decisionOf(material) {
  return material?.ai_decision ?? material?.aiDecision ?? {};
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sentenceFragments(value) {
  return clean(value)
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 35 && sentence.length <= 360);
}

function numericTokens(value) {
  return [...clean(value).matchAll(/\b\d+(?:[,.]\d+)?\s*(?:%|грн|млн|млрд|тис|км|м³|куб\p{L}*)?/giu)]
    .map((match) => match[0].toLocaleLowerCase("uk"));
}

function dateTokens(value) {
  return [
    ...clean(value).matchAll(/\b\d{1,2}\s+(?:січня|лютого|березня|квітня|травня|червня|липня|серпня|вересня|жовтня|листопада|грудня)(?:\s+\d{4}\s+року)?/giu),
    ...clean(value).matchAll(/\b\d{4}-\d{2}-\d{2}\b/gu),
    ...clean(value).matchAll(/\b\d{1,2}\.\d{1,2}\.\d{4}\b/gu),
  ].map((match) => match[0].toLocaleLowerCase("uk"));
}

function supportedValues(fragment, sourceBasis) {
  const sourceNumbers = new Set(numericTokens(sourceBasis));
  const sourceDates = new Set(dateTokens(sourceBasis));
  return numericTokens(fragment).every((value) => sourceNumbers.has(value)) &&
    dateTokens(fragment).every((value) => sourceDates.has(value));
}

function appendUnique(target, seen, value, sourceBasis) {
  for (const sentence of sentenceFragments(value)) {
    const normalized = sentence.toLocaleLowerCase("uk").replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
    if (!normalized || seen.has(normalized)) continue;
    if (hasVisibleRawUrl(sentence) || hasForbiddenGenericContext(sentence)) continue;
    if (!contextHasSourceFacts(sentence, sourceBasis)) continue;
    if (!supportedValues(sentence, sourceBasis)) continue;
    seen.add(normalized);
    target.push(sentence);
  }
}

export function buildCompactPublicDescription(material, {
  minimumCharacters = 180,
  minimumSentences = 2,
  maximumSentences = 6,
} = {}) {
  const basis = material?.contextBasis ?? material?.context_basis ?? "title";
  if (basis === "title_only") return "";

  const sourceBasis = publicDescriptionSourceBasis(material);
  if (!sourceBasis || sourceBasis.length < 180) return "";

  const decision = decisionOf(material);
  const fragments = [];
  const seen = new Set();
  appendUnique(fragments, seen, decision.summary, sourceBasis);
  appendUnique(fragments, seen, decision.whyImportant, sourceBasis);
  appendUnique(fragments, seen, factualExtract(material), sourceBasis);

  const description = fragments.slice(0, maximumSentences).join(" ").slice(0, 1600);
  if (description.length < minimumCharacters) return "";
  const sentenceCount = publicDescriptionSentenceCount(description);
  if (sentenceCount < minimumSentences || sentenceCount > maximumSentences) return "";
  if (!validatePublicContext(description, material)) return "";
  return description;
}

export function compactStandalonePublicationEligibility(material) {
  const description = buildCompactPublicDescription(material);
  if (!description) {
    return {
      eligible: false,
      reason: (material?.contextBasis ?? material?.context_basis) === "title_only"
        ? "title_only"
        : "insufficient_compact_public_context",
    };
  }
  return {
    eligible: true,
    description,
    basis: material?.contextBasis ?? material?.context_basis ?? "source_excerpt",
    compact: true,
  };
}
