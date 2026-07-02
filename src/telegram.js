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

export function formatPublication(material) {
  if (material.editor_text) return material.editor_text;
  const decision = decisionOf(material);
  if (decision.titleKeywordFallback) {
    const snippet = String(decision.summary ?? material.content ?? "").trim();
    return [
      `<b>${escapeHtml(material.title)}</b>`,
      snippet ? `\n${escapeHtml(snippet)}` : "",
      `\n<a href="${escapeHtml(material.url)}">Джерело: ${escapeHtml(material.source_name ?? material.sourceName)}</a>`,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 4096);
  }
  const hashtags = (decision.hashtags ?? []).join(" ");
  return [
    `<b>${escapeHtml(material.title)}</b>`,
    "",
    escapeHtml(decision.summary),
    "",
    `<b>Чому це важливо</b>`,
    escapeHtml(decision.whyImportant),
    "",
    `<a href="${escapeHtml(material.url)}">Першоджерело: ${escapeHtml(material.source_name ?? material.sourceName)}</a>`,
    hashtags ? `\n${escapeHtml(hashtags)}` : "",
  ]
    .filter((line) => line !== undefined)
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
