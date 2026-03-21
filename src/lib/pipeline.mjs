import { writeFile } from "node:fs/promises";
import path from "node:path";
import { readJson, writeJson, ensureDir } from "./fs-utils.mjs";
import { parseRss } from "./rss.mjs";
import { buildSummary, categorizeText, scoreEntry, slugDate } from "./text-utils.mjs";

const ROOT_DIR = process.cwd();
const SOURCES_PATH = path.join(ROOT_DIR, "sources", "sources.json");
const STORE_PATH = path.join(ROOT_DIR, "data", "entries.json");
const REPORTS_DIR = path.join(ROOT_DIR, "reports");

export async function loadSources() {
  const config = await readJson(SOURCES_PATH, { sources: [] });
  return config.sources ?? [];
}

export async function loadStore() {
  return readJson(STORE_PATH, { entries: [] });
}

export async function saveStore(store) {
  await writeJson(STORE_PATH, store);
}

export async function fetchSource(source) {
  if (source.type !== "rss") {
    throw new Error(`Unsupported source type: ${source.type}`);
  }

  const response = await fetch(source.url, {
    headers: {
      "user-agent": "ai-news-pipeline/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${source.name}: ${response.status}`);
  }

  const xml = await response.text();
  return parseRss(xml).slice(0, source.limit ?? 20);
}

function normalizeEntry(item, source, fetchedAt) {
  const summarySource = item.description || item.rawContent || item.title;
  const summary = buildSummary(summarySource);
  const category = categorizeText(item.title, summary, source.name);

  return {
    id: item.link,
    title: item.title,
    url: item.link,
    source: source.name,
    sourceType: source.type,
    fetchedAt,
    publishedAt: item.publishedAt,
    summary,
    category,
    score: scoreEntry({ title: item.title, summary, source }),
    rawText: item.rawContent || item.description || "",
    tags: source.tags ?? []
  };
}

function mergeEntries(existingEntries, incomingEntries) {
  const byId = new Map(existingEntries.map((entry) => [entry.id, entry]));

  for (const entry of incomingEntries) {
    const existing = byId.get(entry.id);
    byId.set(entry.id, existing ? { ...existing, ...entry } : entry);
  }

  return [...byId.values()].sort((left, right) => {
    const leftTime = left.publishedAt || left.fetchedAt;
    const rightTime = right.publishedAt || right.fetchedAt;
    return rightTime.localeCompare(leftTime);
  });
}

function groupByCategory(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const bucket = groups.get(entry.category) ?? [];
    bucket.push(entry);
    groups.set(entry.category, bucket);
  }

  return [...groups.entries()].sort((left, right) => right[1].length - left[1].length);
}

export async function runPipeline({ verbose = false } = {}) {
  const sources = await loadSources();
  const store = await loadStore();
  const fetchedAt = new Date().toISOString();
  const incomingEntries = [];
  const failures = [];

  for (const source of sources) {
    try {
      const items = await fetchSource(source);
      const normalized = items.map((item) => normalizeEntry(item, source, fetchedAt));
      incomingEntries.push(...normalized);
      if (verbose) {
        console.log(`Fetched ${normalized.length} items from ${source.name}`);
      }
    } catch (error) {
      failures.push({ source: source.name, message: error.message });
      if (verbose) {
        console.warn(`Source failed: ${source.name} - ${error.message}`);
      }
    }
  }

  const mergedEntries = mergeEntries(store.entries ?? [], incomingEntries);
  await saveStore({ updatedAt: fetchedAt, entries: mergedEntries });
  const reportPath = await writeDailyReport(mergedEntries, failures);

  return {
    fetchedAt,
    sources: sources.length,
    newEntries: incomingEntries.length,
    totalEntries: mergedEntries.length,
    failures,
    reportPath
  };
}

export async function writeDailyReport(entries, failures = []) {
  await ensureDir(REPORTS_DIR);
  const dateSlug = slugDate();
  const reportPath = path.join(REPORTS_DIR, `${dateSlug}.md`);
  const recentEntries = entries.filter((entry) => (entry.publishedAt || entry.fetchedAt).startsWith(dateSlug));
  const topEntries = recentEntries.slice().sort((left, right) => right.score - left.score).slice(0, 5);
  const groupedEntries = groupByCategory(recentEntries);

  const lines = [
    `# AI Digest - ${dateSlug}`,
    "",
    `- Generated at: ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    `- Today's items: ${recentEntries.length}`,
    `- Failed sources: ${failures.length}`,
    "",
    "## Highlights",
    ""
  ];

  if (topEntries.length === 0) {
    lines.push("No new entries were collected today.");
    lines.push("");
  } else {
    for (const entry of topEntries) {
      lines.push(`- [${entry.title}](${entry.url}) | ${entry.source} | ${entry.category} | score ${entry.score}`);
      lines.push(`  ${entry.summary}`);
    }
    lines.push("");
  }

  for (const [category, categoryEntries] of groupedEntries) {
    lines.push(`## ${category}`);
    lines.push("");
    for (const entry of categoryEntries) {
      lines.push(`### [${entry.title}](${entry.url})`);
      lines.push(`- Source: ${entry.source}`);
      lines.push(`- Published: ${entry.publishedAt ?? "unknown"}`);
      lines.push(`- Tags: ${entry.tags.join(", ") || "none"}`);
      lines.push(`- Summary: ${entry.summary}`);
      lines.push("");
    }
  }

  if (failures.length > 0) {
    lines.push("## Failures");
    lines.push("");
    for (const failure of failures) {
      lines.push(`- ${failure.source}: ${failure.message}`);
    }
    lines.push("");
  }

  await writeFile(reportPath, `${lines.join("\n")}\n`, "utf8");
  return reportPath;
}
