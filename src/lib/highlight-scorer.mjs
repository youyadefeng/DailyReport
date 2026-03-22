import { APP_CONFIG } from "../../config/project.config.mjs";

const OPENAI_DEFAULT_BASE_URL = APP_CONFIG.highlights.openai.defaultBaseUrl;
const OPENAI_DEFAULT_MODEL = APP_CONFIG.highlights.openai.defaultModel;
const MINIMAX_DEFAULT_BASE_URL = APP_CONFIG.highlights.minimax.defaultBaseUrl;
const MINIMAX_DEFAULT_MODEL = APP_CONFIG.highlights.minimax.defaultModel;
const MAX_CANDIDATES = APP_CONFIG.highlights.maxCandidates;

const HIGHLIGHT_SYSTEM_PROMPT =
  "You are ranking AI news items for a daily intelligence brief. " +
  "Score each candidate by importance, novelty, AI relevance, and credibility on a 1-5 scale. " +
  "Then provide an overall_score from 0-100, a short Chinese reason, and a short Chinese highlight summary. " +
  "Prefer official announcements, major research, impactful industry moves, major product launches, or high-signal ecosystem shifts. " +
  "Avoid low-information chatter, duplicative community noise, or novelty without substance. " +
  "Return JSON only.";

export function getHighlightScoringConfig() {
  const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiApiKey) {
    return {
      enabled: true,
      provider: "openai",
      apiKey: openaiApiKey,
      baseUrl: normalizeBaseUrl(process.env.OPENAI_BASE_URL || OPENAI_DEFAULT_BASE_URL),
      model: process.env.OPENAI_HIGHLIGHT_MODEL || process.env.OPENAI_TRANSLATION_MODEL || OPENAI_DEFAULT_MODEL
    };
  }

  const minimaxApiKey = process.env.MINIMAX_API_KEY?.trim();
  if (minimaxApiKey) {
    return {
      enabled: true,
      provider: "minimax",
      apiKey: minimaxApiKey,
      baseUrl: normalizeBaseUrl(process.env.MINIMAX_BASE_URL || MINIMAX_DEFAULT_BASE_URL),
      model: process.env.MINIMAX_HIGHLIGHT_MODEL || process.env.MINIMAX_TRANSLATION_MODEL || MINIMAX_DEFAULT_MODEL
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

export function pickHighlightCandidates(entries, maxCandidates = MAX_CANDIDATES) {
  return entries
    .slice()
    .sort((left, right) => right.score - left.score)
    .slice(0, maxCandidates);
}

export async function scoreHighlightCandidates(entries, { config, verbose = false, cache = null } = {}) {
  if (!config?.enabled || entries.length === 0) {
    return {
      scoredEntries: entries,
      scoredCount: 0,
      cacheHitCount: 0
    };
  }

  const mergedEntries = [];
  const pendingEntries = [];
  let cacheHitCount = 0;

  for (const entry of entries) {
    const cached = cache?.getHighlight?.(entry.id);
    if (isCompatibleCache(cached, config)) {
      mergedEntries.push(mergeHighlightScore(entry, cached));
      cacheHitCount += 1;
      continue;
    }
    pendingEntries.push(entry);
  }

  if (verbose) {
    console.log(`       LLM 候选评分: ${entries.length} 条 (${config.provider} / ${config.model})`);
    if (cacheHitCount > 0) {
      console.log(`       Highlights 缓存命中: ${cacheHitCount} 条`);
    }
  }

  if (pendingEntries.length === 0) {
    return {
      scoredEntries: sortScoredEntries(mergedEntries),
      scoredCount: 0,
      cacheHitCount
    };
  }

  let scored = [];
  try {
    scored =
      config.provider === "minimax"
        ? await requestMiniMaxHighlightScores(pendingEntries, config)
        : await requestOpenAIHighlightScores(pendingEntries, config);
  } catch (error) {
    if (verbose) {
      console.log(`       Highlights 打分失败，已跳过未命中的 ${pendingEntries.length} 条: ${error.message}`);
    }
    return {
      scoredEntries: sortScoredEntries([...mergedEntries, ...pendingEntries]),
      scoredCount: 0,
      cacheHitCount
    };
  }

  const normalizedScores = normalizeScoredItems(scored);
  const byId = new Map(normalizedScores.map((item) => [item.id, item]));

  for (const entry of pendingEntries) {
    const llm = byId.get(entry.id);
    if (!llm) {
      mergedEntries.push(entry);
      continue;
    }

    const merged = mergeHighlightScore(entry, llm);
    mergedEntries.push(merged);
    cache?.setHighlight?.(entry.id, {
      id: entry.id,
      provider: config.provider,
      model: config.model,
      overall_score: llm.overall_score,
      reason_zh: llm.reason_zh || llm.reason || "",
      highlight_summary_zh: llm.highlight_summary_zh || llm.highlight_summary || "",
      importance: llm.importance ?? null,
      novelty: llm.novelty ?? null,
      ai_relevance: llm.ai_relevance ?? null,
      credibility: llm.credibility ?? null,
      scoredAt: new Date().toISOString()
    });
  }

  return {
    scoredEntries: sortScoredEntries(mergedEntries),
    scoredCount: normalizedScores.length,
    cacheHitCount
  };
}

async function requestOpenAIHighlightScores(entries, config) {
  const response = await fetch(`${config.baseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      instructions: HIGHLIGHT_SYSTEM_PROMPT,
      input: [
        {
          role: "user",
          content: JSON.stringify({ candidates: mapCandidates(entries) })
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "highlight_scores",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              scores: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    id: { type: "string" },
                    importance: { type: "integer" },
                    novelty: { type: "integer" },
                    ai_relevance: { type: "integer" },
                    credibility: { type: "integer" },
                    overall_score: { type: "integer" },
                    reason_zh: { type: "string" },
                    highlight_summary_zh: { type: "string" }
                  },
                  required: [
                    "id",
                    "importance",
                    "novelty",
                    "ai_relevance",
                    "credibility",
                    "overall_score",
                    "reason_zh",
                    "highlight_summary_zh"
                  ]
                }
              }
            },
            required: ["scores"]
          }
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Highlight scoring failed: ${response.status} ${errorText.slice(0, 200)}`);
  }

  const payload = await response.json();
  const text = extractResponsesOutputText(payload);
  if (!text) {
    throw new Error("Highlight scoring response did not include output text.");
  }

  const parsed = JSON.parse(text);
  return parsed.scores ?? parsed.items ?? parsed;
}

async function requestMiniMaxHighlightScores(entries, config) {
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
          content: HIGHLIGHT_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: JSON.stringify({ scores: mapCandidates(entries) })
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MiniMax highlight scoring failed: ${response.status} ${errorText.slice(0, 200)}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("MiniMax highlight scoring response did not include message content.");
  }

  const parsed = parseModelJson(content);
  return parsed.scores ?? parsed.items ?? parsed;
}

function mapCandidates(entries) {
  return entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    title_zh: entry.titleZh || "",
    summary: entry.summary,
    summary_zh: entry.summaryZh || "",
    source: entry.source,
    category: entry.category,
    rule_score: entry.score,
    published_at: entry.publishedAt
  }));
}

function mergeHighlightScore(entry, llm) {
  const llmScore = normalizeScore(llm.overall_score);
  const blendedScore = Math.round(entry.score * 0.4 + llmScore * 0.6);

  return {
    ...entry,
    llmScore,
    blendedScore,
    highlightReasonZh: llm.reason_zh || llm.reason || entry.highlightReasonZh,
    highlightSummaryZh: llm.highlight_summary_zh || llm.highlight_summary || entry.highlightSummaryZh,
    llmDimensions: {
      importance: llm.importance ?? null,
      novelty: llm.novelty ?? null,
      aiRelevance: llm.ai_relevance ?? null,
      credibility: llm.credibility ?? null
    }
  };
}

function sortScoredEntries(entries) {
  return entries
    .slice()
    .sort((left, right) => (right.blendedScore ?? right.score) - (left.blendedScore ?? left.score));
}

function isCompatibleCache(cached, config) {
  return Boolean(
    cached &&
      cached.provider === config.provider &&
      cached.model === config.model &&
      Number.isFinite(Number(cached.overall_score))
  );
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

function extractJsonObject(value) {
  const withoutThinking = value.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const firstBrace = withoutThinking.indexOf("{");
  const firstBracket = withoutThinking.indexOf("[");
  const startsWithArray =
    firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace);
  const startIndex = startsWithArray ? firstBracket : firstBrace;

  if (startIndex === -1) {
    throw new Error("No JSON value found in model response.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  const openChar = startsWithArray ? "[" : "{";
  const closeChar = startsWithArray ? "]" : "}";

  for (let index = startIndex; index < withoutThinking.length; index += 1) {
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

    if (char === openChar) {
      depth += 1;
      continue;
    }

    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return withoutThinking.slice(startIndex, index + 1);
      }
    }
  }

  throw new Error("No complete JSON value found in model response.");
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
      throw new Error(`Unable to parse highlight JSON: ${error.message}`);
    }
  }
}

function normalizeBaseUrl(value) {
  return value.replace(/\/$/, "");
}

function normalizeScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function normalizeScoredItems(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    if (Array.isArray(value.scores)) {
      return value.scores;
    }
    if (Array.isArray(value.items)) {
      return value.items;
    }
    if (typeof value.id === "string" && value.scores && typeof value.scores === "object") {
      return [
        {
          id: value.id,
          importance: value.scores.importance,
          novelty: value.scores.novelty,
          ai_relevance: value.scores.ai_relevance,
          credibility: value.scores.credibility,
          overall_score: value.overall_score,
          reason_zh: value.reason_zh,
          highlight_summary_zh: value.highlight_summary_zh || value.highlight_zh
        }
      ];
    }
  }

  return [];
}
