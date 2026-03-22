import { APP_CONFIG } from "../../config/project.config.mjs";

const CATEGORY_RULES = APP_CONFIG.categorization.rules;
const PRACTICE_SOURCE_NAMES = new Set([
  "Anthropic Engineering",
  "Anthropic Research",
  "Google Developers AI",
  "Google Cloud Developers"
]);
const STRONG_PRACTICE_KEYWORDS = [
  "engineering",
  "developers",
  "developer",
  "guide",
  "guides",
  "tutorial",
  "tutorials",
  "workflow",
  "workflows",
  "best practices",
  "how to",
  "building",
  "build ",
  "api",
  "tooling",
  "agentic",
  "agents",
  "harness",
  "cookbook",
  "ai studio"
];
const PRACTICE_HINT_KEYWORDS = [
  "implementation",
  "implementing",
  "technique",
  "techniques",
  "evaluation",
  "evaluations",
  "structured outputs",
  "prompt injection",
  "computer use",
  "grounding",
  "integration",
  "integrations",
  "full-stack"
];

export function stripHtml(value) {
  return decodeHtmlEntities(
    String(value ?? "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function buildSummary(text, maxSentences = 2) {
  const normalized = sanitizeFeedNoise(text).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "No summary available.";
  }

  const sentences = normalized
    .split(/(?<=[.!?。！？])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length === 0) {
    return normalized.slice(0, 180);
  }

  return sentences.slice(0, maxSentences).join(" ").slice(0, 220);
}

export function sanitizeFeedNoise(text) {
  return String(text ?? "")
    .replace(/Comments URL:\s*\S+/gi, " ")
    .replace(/Article URL:\s*\S+/gi, " ")
    .replace(/Points:\s*\d+/gi, " ")
    .replace(/#\s*Comments:\s*\d+/gi, " ")
    .replace(/\bComments:\s*\d+/gi, " ")
    .replace(/\s+\|\s+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function prepareTranslationText(text, maxLength = 600) {
  const normalized = sanitizeFeedNoise(stripHtml(decodeHtmlEntities(String(text ?? ""))))
    .replace(/\s+/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .trim();

  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

export function categorizeText(...values) {
  const corpus = values.join(" ").toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => corpus.includes(keyword))) {
      return rule.category;
    }
  }
  return "Other";
}

export function scoreEntry({ title, summary, source }) {
  let score = 40;
  const corpus = `${title} ${summary}`.toLowerCase();

  if (source?.priority) {
    score += source.priority * 10;
  }
  if (PRACTICE_SOURCE_NAMES.has(source?.name)) {
    score += 30;
  }
  if (corpus.includes("release") || corpus.includes("launch")) {
    score += 15;
  }
  if (corpus.includes("research") || corpus.includes("paper")) {
    score += 10;
  }
  if (corpus.includes("github") || corpus.includes("open source")) {
    score += 8;
  }
  if (STRONG_PRACTICE_KEYWORDS.some((keyword) => corpus.includes(keyword))) {
    score += 25;
  }
  if (PRACTICE_HINT_KEYWORDS.some((keyword) => corpus.includes(keyword))) {
    score += 12;
  }
  if (source?.tags?.includes("engineering") || source?.tags?.includes("developers")) {
    score += 12;
  }

  return Math.max(0, Math.min(100, score));
}

export function slugDate(date = new Date()) {
  return formatDateParts(date).day;
}

export function slugHour(date = new Date()) {
  return formatDateParts(date).hour;
}

export function localDateSlugFromValue(value) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return formatDateParts(parsed).day;
}

function formatDateParts(date) {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    timeZone: APP_CONFIG.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const day = `${lookup.year}-${lookup.month}-${lookup.day}`;
  const hour = `${day}_${lookup.hour}`;

  return { day, hour };
}
