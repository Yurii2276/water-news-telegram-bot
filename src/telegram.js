import { titleForDisplay } from "./translation.js";

const API_BASE_URL = "https://api.telegram.org";

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function decisionOf(material) {
  return material.ai_decision ?? material.aiDecision ?? {};
}

export const CATEGORY_LABELS_UK = {
  regulator: "Регулювання",
  government: "Уряд / міністерства",
  parliament: "Законодавство",
  association: "Професійна спільнота",
  vodokanal: "Водоканал",
  local_media: "Ситуація в громаді",
  donor: "Відновлення / донори",
  international_tech: "Технології",
  general_news: "Новини сектору",
};

function materialCategory(material) {
  const decision = decisionOf(material);
  return decision.materialCategory ??
    decision.sourceCategory ??
    material.sourceCategory ??
    material.source_category ??
    "general_news";
}

export function formatPublication(material) {
  if (material.editor_text) return material.editor_text;
  const category = materialCategory(material);
  const label = CATEGORY_LABELS_UK[category] ?? CATEGORY_LABELS_UK.general_news;
  const source = material.source_name ?? material.sourceName ?? "Джерело";
  const url = material.url ?? "";
  const displayTitle = titleForDisplay(material);
  return [
    `💧 <b>${escapeHtml(label)}</b>`,
    "",
    `<b>${escapeHtml(displayTitle)}</b>`,
    "",
    `Джерело: ${escapeHtml(source)}`,
    `🔗 ${escapeHtml(url)}`,
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
