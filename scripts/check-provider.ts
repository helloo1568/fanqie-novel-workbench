import { decryptSecret } from "../server/crypto.js";
import { sqlite } from "../server/db.js";

type Provider = {
  base_url: string;
  model: string;
  encrypted_key: string;
};

const provider = sqlite.prepare(
  "SELECT base_url, model, encrypted_key FROM providers WHERE enabled=1 ORDER BY created_at LIMIT 1",
).get() as Provider | undefined;

if (!provider?.encrypted_key) {
  throw new Error("没有找到已启用且保存了密钥的供应商");
}

const response = await fetch(`${provider.base_url.replace(/\/$/, "")}/chat/completions`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${decryptSecret(provider.encrypted_key)}`,
  },
  body: JSON.stringify({
    model: provider.model,
    stream: true,
    max_tokens: 256,
    messages: [{ role: "user", content: "只回复两个大写字母：OK" }],
  }),
});

const raw = await response.text();
let eventCount = 0;
let content = "";
let reasoningLength = 0;
let hasDone = false;
const shapes = new Set<string>();

for (const line of raw.split(/\r?\n/)) {
  if (!line.startsWith("data:")) continue;
  const data = line.slice(5).trim();
  if (data === "[DONE]") {
    hasDone = true;
    continue;
  }
  if (!data) continue;
  eventCount += 1;
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    const choice = (parsed.choices as Array<Record<string, unknown>> | undefined)?.[0];
    const delta = choice?.delta as Record<string, unknown> | undefined;
    shapes.add(Object.keys(delta ?? {}).sort().join(",") || "no-delta");
    if (typeof delta?.content === "string") content += delta.content;
    if (typeof delta?.reasoning_content === "string") reasoningLength += delta.reasoning_content.length;
  } catch {
    shapes.add("non-json-data");
  }
}

console.log(JSON.stringify({
  status: response.status,
  contentType: response.headers.get("content-type"),
  eventCount,
  reasoningLength,
  content,
  hasDone,
  eventShapes: [...shapes],
  rawLength: raw.length,
}, null, 2));
