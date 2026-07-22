import { factualExtract, publicCategoryLabel, uniqueStoryMaterials } from "./editorial.js";
import { escapeHtml, formatPublication, formatSourceLink } from "./telegram.js";
import { titleForDisplay } from "./translation.js";
import { formatWeeklyAnalysis } from "./weeklyAnalysis.js";

const HELP_MESSAGE = [
  "<b>Команди редактора</b>",
  "/scan — запустити збір і автопублікацію",
  "/retry_failed_publish — повторно поставити в чергу невдалі публікації за 48 годин",
  "/publish_queue_now — вручну запустити публікацію черги",
  "/daily_digest — підсумок дня для водного сектору",
  "/weekly_analysis — тижневий секторний аналіз",
  "/queue — показати чергу автопублікації",
  "/news — останні опубліковані матеріали",
].join("\n");

const CATEGORY_ORDER = [
  "regulator",
  "government",
  "parliament",
  "personnel_change",
  "association",
  "vodokanal",
  "local_media",
  "donor",
  "international_tech",
  "general_news",
];

const CATEGORY_LABELS = {
  regulator: "regulator",
  government: "government",
  parliament: "parliament",
  personnel_change: "personnel_change",
  association: "association",
  vodokanal: "vodokanal",
  local_media: "local_media",
  donor: "donor",
  international_tech: "international_tech",
  general_news: "general_news",
};

function commandFrom(text) {
  return text?.trim().split(/\s+/, 1)[0].toLowerCase().split("@", 1)[0];
}

function decisionOf(material) {
  return material?.ai_decision ?? material?.aiDecision ?? {};
}

function priorityValue(material) {
  const decision = decisionOf(material);
  if (decision.normativeAct === true || decision.normative_act === true) return 0;
  const category = decision.materialCategory ?? decision.sourceCategory ?? material.sourceCategory ?? material.source_category ?? "general_news";
  const categoryOrder = {
    regulator: 1,
    government: 2,
    parliament: 3,
    personnel_change: 4,
    association: 5,
    donor: 6,
    international_tech: 7,
    vodokanal: 8,
    general_news: 9,
    local_media: 10,
  };
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return (categoryOrder[category] ?? 9) * 10 + (priorityOrder[decision.priorityLevel] ?? 1);
}

export function formatScanReport(report) {
  const rejected = report.rejectedBy ?? {};
  const categories = report.categories ?? {};
  const priorities = report.priorities ?? {};
  const lines = [
    `Готово: знайдено ${report.discovered}, у черзі ${report.queued}, дублів ${report.duplicates}, відхилено ${report.rejected}.`,
    `Прийнято за ключовими словами заголовка: ${report.accepted_title_keyword_fallback ?? 0}`,
    "",
    "<b>Категорії прийнятих матеріалів</b>",
    ...CATEGORY_ORDER.map((category) => `${CATEGORY_LABELS[category]}: ${categories[category] ?? 0}`),
    "",
    "<b>Пріоритет</b>",
    `High priority: ${priorities.high ?? 0}`,
    `Medium priority: ${priorities.medium ?? 0}`,
    `Low priority: ${priorities.low ?? 0}`,
    `Нормативні/регуляторні матеріали: ${report.normative_act ?? 0}`,
    `Google News URL розкрито: ${report.google_news_resolved_url ?? 0}`,
    `Google News URL не розкрито: ${report.google_news_unresolved_url ?? 0}`,
    `Google News запитів: ${report.google_queries_executed ?? 0}`,
    `Direct sources attempted: ${report.direct_sources_attempted ?? 0}`,
    `Direct skipped google_news_only: ${report.direct_sources_skipped_google_news_only ?? 0}`,
    `Direct skipped cooldown: ${report.direct_sources_skipped_cooldown ?? 0}`,
    `Transient failures: ${report.transient_failures ?? 0}`,
    `Permanent failures: ${report.permanent_failures ?? 0}`,
    `Recovered sources: ${report.recovered_sources ?? 0}`,
    `Candidates discovered: ${report.candidates_discovered ?? report.found ?? 0}`,
    `Story clusters: ${report.story_clusters ?? 0}`,
    `Standalone eligible: ${report.standalone_eligible ?? 0}`,
    `Insufficient public context: ${report.insufficient_public_context ?? 0}`,
    `Помилок джерел: ${report.source_fetch_failures ?? 0}`,
    `Повторів HTTP: ${report.transient_retries ?? 0}`,
    "",
    "<b>Причини відхилення</b>",
    `Нерелевантність: ${rejected.irrelevant ?? 0}`,
    `Помилки OpenAI: ${rejected.openaiError ?? 0}`,
    `Немає тексту/посилання: ${rejected.missingContentOrLink ?? 0}`,
    `Відсутній URL: ${rejected.rejected_missing_url ?? 0}`,
    `Некоректний URL: ${rejected.rejected_invalid_url ?? 0}`,
    `Інше: ${rejected.other ?? 0}`,
  ];
  if (report.translated_titles !== undefined || report.translation_failed !== undefined) {
    lines.push(
      "",
      "<b>Переклад заголовків</b>",
      `Перекладено: ${report.translated_titles ?? 0}`,
      `Помилок перекладу: ${report.translation_failed ?? 0}`,
    );
  }
  if (report.rejectedItems?.length) {
    lines.push("", "<b>Перші відхилені матеріали</b>");
    for (const [index, item] of report.rejectedItems.entries()) {
      lines.push(`${index + 1}. ${escapeHtml(item.title)} — ${escapeHtml(item.reason)}`);
    }
  }
  return lines.join("\n").slice(0, 4096);
}

export function formatDailyDigest(materials) {
  const important = uniqueStoryMaterials(
    materials
      .filter((material) => {
        const decision = decisionOf(material);
        return decision.priorityLevel !== "low" ||
          decision.normativeAct === true ||
          decision.normative_act === true ||
          ["regulator", "government", "parliament", "association", "donor", "international_tech", "personnel_change", "vodokanal"].includes(decision.materialCategory ?? decision.sourceCategory);
      })
      .sort((left, right) => priorityValue(left) - priorityValue(right)),
    5,
  );

  const lines = [
    "💧 <b>Вода UA: головне за день</b>",
    "",
    important.length
      ? `За добу відібрано ${important.length} ключових сюжетів для водного сектору.`
      : "За добу немає достатньо підтверджених матеріалів для дайджесту.",
  ];

  for (const [index, material] of important.entries()) {
    const source = material.source_name ?? material.sourceName ?? "джерело";
    const extract = factualExtract(material);
    const category = publicCategoryLabel(material);
    lines.push(
      "",
      `${index + 1}. <b>${escapeHtml(titleForDisplay(material))}</b>`,
      category ? `   ${escapeHtml(category)}` : null,
      `   Джерело: ${escapeHtml(source)}${material.url ? ` ${formatSourceLink(material.url)}` : ""}`,
      extract ? `   Факт: ${escapeHtml(extract)}` : null,
    );
  }

  lines.push("", "Висновок: фокус дня — підтверджені першоджерелами рішення, інфраструктура та технології без дублювання однотипних локальних повідомлень.");

  return lines.filter((line) => line !== null).join("\n").slice(0, 4096);
}

async function prepareDigestMaterials(materials, prepareDisplayTitle, prepareContext) {
  const prepared = [];
  for (const material of materials) {
    prepared.push(await prepareContext(await prepareDisplayTitle(material)));
  }
  return prepared;
}

export function createUpdateHandler({
  telegram,
  repository,
  pipeline,
  publisher,
  adminTelegramId,
  logger = console,
  prepareDisplayTitle = async (material) => material,
  prepareContext = async (material) => material,
}) {
  return async function handleUpdate(update) {
    const message = update?.message;
    const chatId = message?.chat?.id;
    if (!chatId || !message?.text) return;
    if (Number(message.from?.id) !== Number(adminTelegramId)) {
      await telegram.sendMessage(chatId, "Цей бот доступний лише адміну.");
      return;
    }
    const command = commandFrom(message.text);
    if (command === "/start" || command === "/help") {
      await telegram.sendMessage(chatId, HELP_MESSAGE);
      return;
    }
    if (command === "/scan") {
      await telegram.sendMessage(chatId, "Сканування запущено.");
      try {
        const report = await pipeline.scan();
        publisher.kick();
        await telegram.sendMessage(chatId, formatScanReport(report));
      } catch (error) {
        logger.error("Manual scan failed", error);
        await telegram.sendMessage(chatId, "Сканування завершилося помилкою.");
      }
      return;
    }
    if (command === "/retry_failed_publish") {
      const count = await repository.retryFailedPublications(48);
      await telegram.sendMessage(chatId, `Повторно поставлено в чергу: ${count}`);
      return;
    }
    if (command === "/publish_queue_now") {
      const result = await publisher.drain();
      await telegram.sendMessage(
        chatId,
        `Публікація запущена. Опубліковано: ${result.publishedNow ?? 0}. DRY_RUN: ${Boolean(result.dryRun)}. Ліміт: ${result.limit}.`,
      );
      return;
    }
    if (command === "/daily_digest") {
      const materials = await repository.getDailyDigestMaterials();
      await telegram.sendMessage(chatId, formatDailyDigest(await prepareDigestMaterials(materials, prepareDisplayTitle, prepareContext)));
      return;
    }
    if (command === "/weekly_analysis") {
      const materials = await repository.getWeeklyAnalysisMaterials();
      await telegram.sendMessage(chatId, formatWeeklyAnalysis(await prepareDigestMaterials(materials, prepareDisplayTitle, prepareContext)));
      return;
    }
    if (command === "/queue") {
      const materials = await repository.getQueue(20);
      if (materials.length === 0) await telegram.sendMessage(chatId, "Черга автопублікації порожня.");
      else {
        const rows = materials.map((material) => {
          const decision = decisionOf(material);
          return `#${material.id} · ${escapeHtml(titleForDisplay(material))} · ${decision.priorityLevel ?? "medium"} · ${decision.relevanceScore ?? "?"}%/${decision.confidenceScore ?? "?"}%`;
        });
        await telegram.sendMessage(chatId, `<b>Черга автопублікації</b>\n\n${rows.join("\n")}`);
      }
      return;
    }
    if (command === "/news") {
      const materials = await repository.getPublished(10);
      if (materials.length === 0) await telegram.sendMessage(chatId, "Опублікованих матеріалів ще немає.");
      else for (const material of materials) await telegram.sendMessage(chatId, formatPublication(material));
      return;
    }
    if (command?.startsWith("/")) await telegram.sendMessage(chatId, HELP_MESSAGE);
  };
}

export async function sendDailyDigest({
  repository,
  telegram,
  channelId,
  prepareDisplayTitle = async (material) => material,
  prepareContext = async (material) => material,
}) {
  const materials = await repository.getDailyDigestMaterials();
  const prepared = await prepareDigestMaterials(materials, prepareDisplayTitle, prepareContext);
  await telegram.sendMessage(channelId, formatDailyDigest(prepared));
  return prepared.length;
}

export async function runPolling({ telegram, handleUpdate, timeoutSeconds, signal, logger = console }) {
  let offset = 0;
  while (!signal.aborted) {
    try {
      const updates = await telegram.getUpdates(offset, timeoutSeconds, signal);
      for (const update of updates) {
        offset = update.update_id + 1;
        await handleUpdate(update);
      }
    } catch (error) {
      if (signal.aborted) break;
      logger.error("Polling error", error);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}
