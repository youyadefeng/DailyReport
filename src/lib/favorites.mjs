import path from "node:path";
import { writeFile } from "node:fs/promises";
import { APP_CONFIG } from "../../config/project.config.mjs";
import { ensureDir, readJson, writeJson } from "./fs-utils.mjs";

const FAVORITES_FILE = APP_CONFIG.paths.favoritesFile;
const FAVORITES_INDEX_FILE = APP_CONFIG.paths.favoritesIndexFile;

export async function loadFavorites() {
  return await readJson(FAVORITES_FILE, {
    updatedAt: null,
    items: []
  });
}

export async function addFavorite(entry) {
  const favorites = await loadFavorites();
  const existingIndex = favorites.items.findIndex((item) => item.id === entry.id);
  const snapshot = buildFavoriteSnapshot(entry, favorites.items[existingIndex]);

  if (existingIndex >= 0) {
    favorites.items[existingIndex] = snapshot;
  } else {
    favorites.items.push(snapshot);
  }

  favorites.updatedAt = new Date().toISOString();
  favorites.items.sort((left, right) => {
    const leftTime = left.favoritedAt || left.updatedAt || "";
    const rightTime = right.favoritedAt || right.updatedAt || "";
    return rightTime.localeCompare(leftTime);
  });

  await saveFavorites(favorites);
  return snapshot;
}

export async function removeFavorite(target) {
  const favorites = await loadFavorites();
  const before = favorites.items.length;
  favorites.items = favorites.items.filter((item) => !favoriteMatches(item, target));
  favorites.updatedAt = new Date().toISOString();
  await saveFavorites(favorites);
  return before - favorites.items.length;
}

export function findEntryForFavorite(entries, target) {
  const normalizedTarget = normalizeText(target);
  if (!normalizedTarget) {
    return { matches: [] };
  }

  const exactMatches = entries.filter((entry) =>
    [entry.id, entry.url, entry.title, entry.titleZh].some((value) => normalizeText(value) === normalizedTarget)
  );

  if (exactMatches.length > 0) {
    return { matches: dedupeEntries(exactMatches) };
  }

  const partialMatches = entries.filter((entry) =>
    [entry.id, entry.url, entry.title, entry.titleZh].some((value) => normalizeText(value).includes(normalizedTarget))
  );

  return { matches: dedupeEntries(partialMatches).slice(0, 10) };
}

export function renderFavoriteList(favorites) {
  if (!favorites.items || favorites.items.length === 0) {
    return "当前还没有收藏条目。";
  }

  return favorites.items
    .map((item, index) => {
      const title = item.titleZh || item.title || item.id;
      return `${index + 1}. ${title} [${item.source}]`;
    })
    .join("\n");
}

async function saveFavorites(favorites) {
  await writeJson(FAVORITES_FILE, favorites);
  await writeFavoritesIndex(favorites);
}

async function writeFavoritesIndex(favorites) {
  const lines = [
    "# 收藏资讯",
    "",
    `- 条目数: ${favorites.items.length}`,
    `- 更新时间: ${favorites.updatedAt ?? "unknown"}`,
    ""
  ];

  if (favorites.items.length === 0) {
    lines.push("当前还没有收藏条目。");
    lines.push("");
  } else {
    for (const item of favorites.items) {
      lines.push(`## ${item.titleZh || item.title}`);
      lines.push("");
      lines.push(`- 来源: ${item.source}`);
      lines.push(`- 原文: ${item.url}`);
      lines.push(`- 收藏时间: ${item.favoritedAt ?? "unknown"}`);
      if (item.publishedAt) {
        lines.push(`- 发布时间: ${item.publishedAt}`);
      }
      if (item.category) {
        lines.push(`- 分类: ${item.category}`);
      }
      if (item.summaryZh || item.summary) {
        lines.push("");
        lines.push(item.summaryZh || item.summary);
      }
      lines.push("");
    }
  }

  await ensureDir(path.dirname(FAVORITES_INDEX_FILE));
  await writeFile(FAVORITES_INDEX_FILE, `${lines.join("\n")}\n`, "utf8");
}

function buildFavoriteSnapshot(entry, existing = null) {
  return {
    id: entry.id,
    url: entry.url,
    title: entry.title,
    titleZh: entry.titleZh || existing?.titleZh || null,
    summary: entry.summary || existing?.summary || null,
    summaryZh: entry.summaryZh || existing?.summaryZh || null,
    source: entry.source,
    category: entry.category || existing?.category || null,
    publishedAt: entry.publishedAt || existing?.publishedAt || null,
    favoritedAt: existing?.favoritedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tags: entry.tags || existing?.tags || [],
    github: entry.github || existing?.github || null
  };
}

function favoriteMatches(item, target) {
  const normalizedTarget = normalizeText(target);
  return [item.id, item.url, item.title, item.titleZh].some((value) => normalizeText(value) === normalizedTarget);
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function dedupeEntries(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
}
