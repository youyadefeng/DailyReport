const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
const MINIMAX_DEFAULT_BASE_URL = "https://api.minimax.io/v1";
const MINIMAX_DEFAULT_MODEL = "MiniMax-M2.5";
const OPENAI_TRANSLATION_CHUNK_SIZE = 8;
const MINIMAX_TRANSLATION_CHUNK_SIZE = 1;
const TRANSLATION_SYSTEM_PROMPT =
  "You are translating AI news items into Simplified Chinese for a daily intelligence brief. " +
  "For each item, output a concise Chinese title and a Chinese summary that reads like a news brief. " +
  "The summary should usually be 1-2 sentences, mention the concrete event or claim, preserve proper nouns, product names, model names, URLs, and technical acronyms, and avoid vague filler like 'the article discusses'. " +
  "If the source summary contains metadata like Comments URL, points, or comment counts, ignore that noise and focus on the actual content topic when possible. " +
  "Reply with JSON only.";

export function getTranslationConfig() {
  const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiApiKey) {
    return {
      enabled: true,
      provider: "openai",
      apiKey: openaiApiKey,
      baseUrl: normalizeBaseUrl(process.env.OPENAI_BASE_URL || OPENAI_DEFAULT_BASE_URL),
      model: process.env.OPENAI_TRANSLATION_MODEL || OPENAI_DEFAULT_MODEL
    };
  }

  const minimaxApiKey = process.env.MINIMAX_API_KEY?.trim();
  if (minimaxApiKey) {
    return {
      enabled: true,
      provider: "minimax",
      apiKey: minimaxApiKey,
      baseUrl: normalizeBaseUrl(process.env.MINIMAX_BASE_URL || MINIMAX_DEFAULT_BASE_URL),
      model: process.env.MINIMAX_TRANSLATION_MODEL || MINIMAX_DEFAULT_MODEL
    };
  }

  return {
    enabled: false,
    provider: null,
    apiKey: null,
    baseUrl: null,
    model: null
  };
}

export async function translateEntries(entries, { config, verbose = false } = {}) {
  if (!config?.enabled || entries.length === 0) {
    return {
      translatedCount: 0,
      skippedCount: entries.length
    };
  }

  let translatedCount = 0;
  let skippedCount = 0;
  const chunkSize = config.provider === "minimax" ? MINIMAX_TRANSLATION_CHUNK_SIZE : OPENAI_TRANSLATION_CHUNK_SIZE;

  for (let index = 0; index < entries.length; index += chunkSize) {
    const chunk = entries.slice(index, index + chunkSize);
    const chunkLabel = `${Math.floor(index / chunkSize) + 1}/${Math.ceil(entries.length / chunkSize)}`;
    const pending = chunk.filter((entry) => entry.title && entry.summary && (!entry.titleZh || !entry.summaryZh));

    if (pending.length === 0) {
      skippedCount += chunk.length;
      continue;
    }

    if (verbose) {
      console.log(`       Translation batch ${chunkLabel}: ${pending.length} item(s)`);
    }

    let translated = [];
    try {
      translated =
        config.provider === "minimax"
          ? await requestMiniMaxTranslations(pending, config)
          : await requestOpenAITranslations(pending, config);
    } catch (error) {
      skippedCount += pending.length;
      if (verbose) {
        console.log(`       Translation batch failed: ${error.message}`);
      }
      continue;
    }

    const byId = new Map(translated.map((item) => [item.id, item]));

    for (const entry of pending) {
      const match = byId.get(entry.id);
      if (!match) {
        skippedCount += 1;
        continue;
      }

      const titleZh = match.title_zh || match.title;
      const summaryZh = match.summary_zh || match.summary;

      if (!titleZh || !summaryZh) {
        skippedCount += 1;
        continue;
      }

      entry.titleZh = titleZh;
      entry.summaryZh = summaryZh;
      entry.translationProvider = config.provider;
      entry.translationModel = config.model;
      entry.translatedAt = new Date().toISOString();
      translatedCount += 1;
    }
  }

  return {
    translatedCount,
    skippedCount
  };
}

async function requestOpenAITranslations(entries, config) {
  const response = await fetch(`${config.baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      instructions: TRANSLATION_SYSTEM_PROMPT,
      input: [
        {
          role: "user",
          content: JSON.stringify({
            items: entries.map((entry) => ({
              id: entry.id,
              title: entry.title,
              summary: entry.summary
            }))
          })
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "translation_batch",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              translations: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    id: { type: "string" },
                    title_zh: { type: "string" },
                    summary_zh: { type: "string" }
                  },
                  required: ["id", "title_zh", "summary_zh"]
                }
              }
            },
            required: ["translations"]
          }
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Translation request failed: ${response.status} ${errorText.slice(0, 200)}`);
  }

  const payload = await response.json();
  const text = extractResponsesOutputText(payload);
  if (!text) {
    throw new Error("Translation response did not include output text.");
  }

  const parsed = parseModelJson(text);
  return parsed.translations ?? [];
}

async function requestMiniMaxTranslations(entries, config) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: TRANSLATION_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: JSON.stringify({
            translations: entries.map((entry) => ({
              id: entry.id,
              title: entry.title,
              summary: entry.summary
            }))
          })
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MiniMax translation failed: ${response.status} ${errorText.slice(0, 200)}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("MiniMax translation response did not include message content.");
  }

  const parsed = parseModelJson(content);
  return parsed.translations ?? [];
}

function extractResponsesOutputText(payload) {
  if (typeof payload.output_text === "string" && payload.output_text) {
    return payload.output_text;
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  const parts = [];

  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const block of content) {
      if (block.type === "output_text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
  }

  return parts.join("").trim();
}

function normalizeBaseUrl(value) {
  return value.replace(/\/$/, "");
}

function extractJsonObject(value) {
  const withoutThinking = value.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const firstBrace = withoutThinking.indexOf("{");
  if (firstBrace === -1) {
    throw new Error("No JSON object found in model response.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = firstBrace; index < withoutThinking.length; index += 1) {
    const char = withoutThinking[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return withoutThinking.slice(firstBrace, index + 1);
      }
    }
  }

  throw new Error("No complete JSON object found in model response.");
}

function parseModelJson(value) {
  const jsonText = extractJsonObject(value);

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const normalized = jsonText
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");
    try {
      return JSON.parse(normalized);
    } catch {
      throw new Error(`Unable to parse model JSON: ${error.message}`);
    }
  }
}
