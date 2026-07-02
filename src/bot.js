import { escapeHtml, formatPublication } from "./telegram.js";

const HELP_MESSAGE = [
  "<b>Команди редактора</b>",
  "/scan — запустити збір і автопублікацію",
  "/queue — показати чергу автопублікації",
  "/news — останні опубліковані матеріали",
].join("\n");

function commandFrom(text) {
  return text?.trim().split(/\s+/, 1)[0].toLowerCase().split("@", 1)[0];
}

export function formatScanReport(report) {
  const rejected = report.rejectedBy ?? {};
  const lines = [
    `Готово: знайдено ${report.discovered}, у черзі ${report.queued}, дублів ${report.duplicates}, відхилено ${report.rejected}.`,
    `Прийнято за ключовими словами заголовка: ${report.accepted_title_keyword_fallback ?? 0}`,
    "",
    "<b>Причини відхилення</b>",
    `Нерелевантність: ${rejected.irrelevant ?? 0}`,
    `Помилки OpenAI: ${rejected.openaiError ?? 0}`,
    `Немає тексту/посилання: ${rejected.missingContentOrLink ?? 0}`,
    `Відсутній URL: ${rejected.rejected_missing_url ?? 0}`,
    `Некоректний URL: ${rejected.rejected_invalid_url ?? 0}`,
    `Інше: ${rejected.other ?? 0}`,
  ];
  if (report.rejectedItems?.length) {
    lines.push("", "<b>Перші відхилені матеріали</b>");
    for (const [index, item] of report.rejectedItems.entries()) {
      lines.push(`${index + 1}. ${escapeHtml(item.title)} — ${escapeHtml(item.reason)}`);
    }
  }
  return lines.join("\n").slice(0, 4096);
}

export function createUpdateHandler({ telegram, repository, pipeline, publisher, adminTelegramId, logger = console }) {
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
    if (command === "/queue") {
      const materials = await repository.getQueue(20);
      if (materials.length === 0) await telegram.sendMessage(chatId, "Черга автопублікації порожня.");
      else {
        const rows = materials.map((material) => {
          const decision = material.ai_decision ?? {};
          return `#${material.id} · ${escapeHtml(material.title)} · ${decision.relevanceScore ?? "?"}%/${decision.confidenceScore ?? "?"}%`;
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
