import { APP_CONFIG } from "../../config/project.config.mjs";

const CATEGORY_RULES = APP_CONFIG.categorization.rules;

export function stripHtml(value) {
  return decodeHtmlEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function buildSummary(text, maxSentences = 2) {
  const normalized = text.replace(/\s+/g, " ").trim();
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
  if (corpus.includes("release") || corpus.includes("launch")) {
    score += 15;
  }
  if (corpus.includes("research") || corpus.includes("paper")) {
    score += 10;
  }
  if (corpus.includes("github") || corpus.includes("open source")) {
    score += 8;
  }

  return Math.max(0, Math.min(100, score));
}

export function slugDate(date = new Date()) {
  return formatDateParts(date).day;
}

export function slugHour(date = new Date()) {
  return formatDateParts(date).hour;
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
