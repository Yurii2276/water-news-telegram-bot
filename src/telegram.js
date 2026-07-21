import { contextForDisplay } from "./context.js";
import { publicCategoryEmoji, publicCategoryLabel } from "./editorial.js";
import { titleForDisplay } from "./translation.js";

const API_BASE_URL = "https://api.telegram.org";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function escapeHtmlAttribute(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function decisionOf(material) {
  return material?.ai_decision ?? material?.aiDecision ?? {};
}

export const CATEGORY_LABELS_UK = {
  regulator: "Регуляторика",
  government: "Державна політика",
  parliament: "Законодавство",
  association: "Професійна спільнота",
  vodokanal: "Водоканали",
  local_media: "Ситуація в громаді",
  donor: "Відновлення та донори",
  international_tech: "Технології",
  personnel_change: "Кадрові зміни",
  general_news: "Новини сектору",
};

function materialCategory(material) {
  const decision = decisionOf(material);
  return decision.materialCategory ??
    decision.sourceCategory ??
    material?.sourceCategory ??
    material?.source_category ??
    "general_news";
}

export function formatPublication(material) {
  if (material.editor_text) return material.editor_text;
  const label = publicCategoryLabel(material) ?? CATEGORY_LABELS_UK[materialCategory(material)] ?? CATEGORY_LABELS_UK.general_news;
  const source = material.source_name ?? material.sourceName ?? "Джерело";
  const url = material.url ?? "";
  const displayTitle = titleForDisplay(material);
  const context = contextForDisplay(material);

  return [
    `${publicCategoryEmoji(material)} <b>${escapeHtml(label)}</b>`,
    "",
    `<b>${escapeHtml(displayTitle)}</b>`,
    "",
    context ? escapeHtml(context) : null,
    "",
    `Джерело: ${escapeHtml(source)}`,
    url ? `🔗 <a href="${escapeHtmlAttribute(url)}">${escapeHtml(url)}</a>` : null,
  ]
    .filter((line) => line !== undefined && line !== null)
    .join("\n")
    .slice(0, 4096);
}

export function createTelegramClient(token, { fetchImpl = fetch } = {}) {
  async function call(method, payload = {}, signal) {
    const response = await fetchImpl(`${API_BASE_URL}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });

    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(
        `Telegram ${method} failed: ${result.description ?? response.status}`,
      );
    }
    return result.result;
  }

  return {
    getUpdates: (offset, timeout, signal) =>
      call(
        "getUpdates",
        { offset, timeout, allowed_updates: ["message"] },
        signal,
      ),
    sendMessage: (chatId, text, extra = {}) =>
      call("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...extra,
      }),
  };
}
