import { escapeHtml, formatPublication } from "./telegram.js";
import { titleForDisplay } from "./translation.js";

const HELP_MESSAGE = [
  "<b>Команди редактора</b>",
  "/scan — запустити збір і автопублікацію",
  "/retry_failed_publish — повторно поставити в чергу невдалі публікації за 48 годин",
  "/publish_queue_now — вручну запустити публікацію черги",
  "/daily_digest — підсумок опублікованих і прийнятих матеріалів за добу",
  "/queue — показати чергу автопублікації",
  "/news — останні опубліковані матеріали",
].join("\n");

const CATEGORY_ORDER = [
  "regulator",
  "government",
  "parliament",
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
  association: "association",
  vodokanal: "vodokanal",
  local_media: "local_media",
  donor: "donor",
  international_tech: "international_tech",
  general_news: "general_news",
};

const DIGEST_SECTIONS = [
  {
    title: "Нормативка / регулювання",
    matches: (decision) =>
      decision.normativeAct === true || decision.normative_act === true,
  },
  {
    title: "Регулювання / НКРЕКП / законодавство",
    matches: (decision) =>
      ["regulator", "parliament"].includes(decision.materialCategory ?? decision.sourceCategory) ||
      decision.category === "legislation",
  },
  {
    title: "Тарифи та інвестпрограми",
    matches: (decision, material) =>
      decision.category === "tariffs" || /тариф|інвест/i.test(`${material.title} ${material.status_reason ?? ""}`),
  },
  {
    title: "Водоканали та інфраструктура",
    matches: (decision) =>
      ["vodokanal", "government", "association"].includes(decision.materialCategory ?? decision.sourceCategory) ||
      ["utilities", "treatment", "infrastructure"].includes(decision.category),
  },
  {
    title: "Аварії та відключення",
    matches: (decision, material) =>
      decision.materialCategory === "local_media" || /без\s+води|відключенн|авар/i.test(material.title ?? ""),
  },
  {
    title: "Відновлення / донори",
    matches: (decision) =>
      decision.materialCategory === "donor" || decision.sourceCategory === "donor" || ["recovery", "donors"].includes(decision.category),
  },
  {
    title: "Технології та міжнародна практика",
    matches: (decision) =>
      decision.materialCategory === "international_tech" || decision.sourceCategory === "international_tech" || decision.category === "technology",
  },
];

function commandFrom(text) {
  return text?.trim().split(/\s+/, 1)[0].toLowerCase().split("@", 1)[0];
}

function decisionOf(material) {
  return material.ai_decision ?? material.aiDecision ?? {};
}

function priorityValue(material) {
  const decision = decisionOf(material);
  if (decision.normativeAct === true || decision.normative_act === true) return 0;
  const category = decision.materialCategory ?? decision.sourceCategory ?? material.sourceCategory ?? material.source_category ?? "general_news";
  const categoryOrder = {
    regulator: 1,
    government: 2,
    parliament: 3,
    association: 4,
    donor: 5,
    international_tech: 6,
    vodokanal: 7,
    general_news: 8,
    local_media: 9,
  };
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return (categoryOrder[category] ?? 8) * 10 + (priorityOrder[decision.priorityLevel] ?? 1);
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

function formatDigestItem(material, index) {
  const decision = decisionOf(material);
  const score = decision.priorityLevel ? ` · ${decision.priorityLevel}` : "";
  return `${index}. ${escapeHtml(titleForDisplay(material))} — ${escapeHtml(material.source_name ?? material.sourceName ?? "джерело")}${score}`;
}

export function formatDailyDigest(materials) {
  const important = materials
    .filter((material) => {
      const decision = decisionOf(material);
      return decision.priorityLevel === "high" ||
        decision.normativeAct === true ||
        decision.normative_act === true ||
        ["regulator", "government", "parliament", "association", "donor", "international_tech"].includes(decision.materialCategory ?? decision.sourceCategory);
    })
    .sort((left, right) => priorityValue(left) - priorityValue(right));
  const lines = [
    "💧 <b>Вода UA: підсумок дня</b>",
    "",
    important.length
      ? `За день відібрано ${important.length} важливих повідомлень для водного сектору. Нижче — ключові оновлення за пріоритетами.`
      : "Станом на сьогодні суттєвих регуляторних або галузевих змін не виявлено. У стрічці переважали локальні повідомлення щодо відключень та ремонтів.",
  ];
  const used = new Set();

  for (const section of DIGEST_SECTIONS) {
    const sectionMaterials = materials
      .filter((material) => !used.has(material.id) && section.matches(decisionOf(material), material))
      .sort((left, right) => priorityValue(left) - priorityValue(right))
      .slice(0, 7);
    sectionMaterials.forEach((material) => used.add(material.id));
    lines.push("", `<b>${section.title}</b>`);
    if (sectionMaterials.length === 0) {
      lines.push("Немає важливих повідомлень.");
    } else {
      lines.push(...sectionMaterials.map((material, index) => formatDigestItem(material, index + 1)));
    }
  }

  return lines.join("\n").slice(0, 4096);
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
    if (command === "/queue") {
      const materials = await repository.getQueue(20);
      if (materials.length === 0) await telegram.sendMessage(chatId, "Черга автопублікації порожня.");
      else {
        const rows = materials.map((material) => {
          const decision = decisionOf(material);
          return `#${material.id} · ${escapeHtml(material.title)} · ${decision.priorityLevel ?? "medium"} · ${decision.relevanceScore ?? "?"}%/${decision.confidenceScore ?? "?"}%`;
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
