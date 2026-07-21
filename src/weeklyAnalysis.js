import {
  factualExtract,
  publicCategoryLabel,
  sourceQualityRank,
  uniqueStoryMaterials,
} from "./editorial.js";
import { escapeHtml, escapeHtmlAttribute } from "./telegram.js";
import { titleForDisplay } from "./translation.js";

function decisionOf(material) {
  return material?.ai_decision ?? material?.aiDecision ?? {};
}

function sortForAnalysis(left, right) {
  const leftDecision = decisionOf(left);
  const rightDecision = decisionOf(right);
  const leftScore = leftDecision.priorityScore ?? leftDecision.importance ?? 0;
  const rightScore = rightDecision.priorityScore ?? rightDecision.importance ?? 0;
  return sourceQualityRank(left) - sourceQualityRank(right) || rightScore - leftScore;
}

function sectionMaterials(materials, categories, limit = 5) {
  const selected = materials
    .filter((material) => categories.includes(decisionOf(material).materialCategory ?? decisionOf(material).sourceCategory ?? material.sourceCategory ?? material.source_category))
    .sort(sortForAnalysis);
  return uniqueStoryMaterials(selected, limit);
}

function itemLine(material, index) {
  const title = escapeHtml(titleForDisplay(material));
  const source = escapeHtml(material.source_name ?? material.sourceName ?? "джерело");
  const url = material.url ? ` — <a href="${escapeHtmlAttribute(material.url)}">джерело</a>` : "";
  const extract = factualExtract(material);
  return [
    `${index}. <b>${title}</b>`,
    `   Джерело: ${source}${url}`,
    extract ? `   Факт: ${escapeHtml(extract)}` : null,
  ].filter(Boolean).join("\n");
}

function addSection(lines, title, materials) {
  if (!materials.length) return;
  lines.push("", `<b>${escapeHtml(title)}</b>`);
  materials.forEach((material, index) => lines.push(itemLine(material, index + 1)));
}

export function formatWeeklyAnalysis(materials, { now = new Date() } = {}) {
  const stories = uniqueStoryMaterials(materials, 30).sort(sortForAnalysis);
  const lines = [
    "💧 <b>Вода UA: тижневий аналіз сектору</b>",
    "",
    `Період: останні 7 днів. Відібрано ${stories.length} унікальних сюжетів із черги та опублікованих матеріалів.`,
  ];

  addSection(lines, "Регулювання, тарифи та законодавство", sectionMaterials(stories, ["regulator", "government", "parliament"], 6));
  addSection(lines, "Водоканали та інфраструктура", sectionMaterials(stories, ["vodokanal", "association"], 6));
  addSection(lines, "Відновлення, донори та технології", sectionMaterials(stories, ["donor", "international_tech"], 6));
  addSection(lines, "Кадрові рішення", sectionMaterials(stories, ["personnel_change"], 4));

  const local = sectionMaterials(stories, ["local_media"], 3);
  addSection(lines, "Сигнали з громад", local);

  const topCategories = [...new Set(stories.map((material) => publicCategoryLabel(material)).filter(Boolean))].slice(0, 4);
  lines.push(
    "",
    "<b>Редакційний висновок</b>",
    topCategories.length
      ? `Ключові теми тижня: ${escapeHtml(topCategories.join(", "))}. Для каналу варто тримати фокус на рішеннях регулятора, фінансуванні відновлення та повторюваних інфраструктурних проблемах, підтверджених першоджерелами.`
      : "За тиждень не накопичено достатньо підтверджених матеріалів для змістовного секторного висновку.",
    "",
    `Сформовано: ${escapeHtml(now.toISOString())}`,
  );

  return lines.join("\n").slice(0, 4096);
}

export async function sendWeeklyAnalysis({
  repository,
  telegram,
  chatId,
  prepareDisplayTitle = async (material) => material,
  prepareContext = async (material) => material,
  now = new Date(),
}) {
  const materials = await repository.getWeeklyAnalysisMaterials();
  const prepared = [];
  for (const material of materials) {
    prepared.push(await prepareContext(await prepareDisplayTitle(material)));
  }
  await telegram.sendMessage(chatId, formatWeeklyAnalysis(prepared, { now }));
  return prepared.length;
}
