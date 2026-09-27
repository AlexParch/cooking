// Минимальная обёртка над Telegram Bot API и проверка подписи WebApp.

export interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
}

export class Telegram {
  constructor(private token: string) {}

  async call<T = unknown>(method: string, body: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description}`);
    return data.result;
  }

  send(chatId: number, text: string, extra: Record<string, unknown> = {}) {
    return this.call<{ message_id: number }>("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
  }

  edit(chatId: number, messageId: number, text: string, extra: Record<string, unknown> = {}) {
    return this.call("editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", ...extra });
  }

  async downloadFile(fileId: string): Promise<ArrayBuffer> {
    const file = await this.call<{ file_path: string }>("getFile", { file_id: fileId });
    const res = await fetch(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`);
    if (!res.ok) throw new Error(`Не удалось скачать файл: ${res.status}`);
    return res.arrayBuffer();
  }
}

const enc = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Проверяет initData из Telegram.WebApp по алгоритму из документации:
 * secret = HMAC_SHA256("WebAppData", bot_token); hash = HMAC_SHA256(secret, data_check_string).
 */
export async function verifyInitData(initData: string, botToken: string, maxAgeSec = 7 * 86400): Promise<TgUser | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  const expected = toHex(await hmac(secret, dataCheck));
  if (expected !== hash) return null;
  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  try {
    return JSON.parse(params.get("user") ?? "null") as TgUser | null;
  } catch {
    return null;
  }
}

/** Для тестов: подписывает initData так же, как это делает Telegram. */
export async function signInitData(fields: Record<string, string>, botToken: string): Promise<string> {
  const dataCheck = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  const hash = toHex(await hmac(secret, dataCheck));
  return new URLSearchParams({ ...fields, hash }).toString();
}

export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
