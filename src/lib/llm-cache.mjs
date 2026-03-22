import path from "node:path";
import { readdir, rm } from "node:fs/promises";
import { ensureDir, readJson, writeJson } from "./fs-utils.mjs";
import { slugDate } from "./text-utils.mjs";
import { APP_CONFIG } from "../../config/project.config.mjs";

const CACHE_DIR = APP_CONFIG.paths.llmCacheDir;
const LEGACY_CACHE_FILE = APP_CONFIG.paths.llmCacheLegacyFile;
const DEFAULT_RETENTION_DAYS = APP_CONFIG.cache.retentionDays;

export async function loadLlmCache() {
  const today = slugDate();
  const retentionDays = getRetentionDays();
  await ensureDir(CACHE_DIR);

  let days = await loadCacheDaysFromFiles();
  if (Object.keys(days).length === 0) {
    days = await loadLegacyCacheDays(today, retentionDays);
  }

  days = pruneDays(days, today, retentionDays);

  if (!days[today]) {
    days[today] = createEmptyDayCache(today);
  }

  return {
    dir: CACHE_DIR,
    legacyFile: LEGACY_CACHE_FILE,
    today,
    retentionDays,
    days,
    dayCache: days[today]
  };
}

export async function saveLlmCache(cache) {
  const today = cache.today ?? slugDate();
  const retentionDays = cache.retentionDays ?? getRetentionDays();
  const days = pruneDays(cache.days ?? {}, today, retentionDays);

  await ensureDir(CACHE_DIR);

  for (const [day, value] of Object.entries(days)) {
    await writeJson(buildDayCachePath(day), {
      date: day,
      translations: value?.translations ?? {},
      highlights: value?.highlights ?? {},
      translationFailures: value?.translationFailures ?? {}
    });
  }

  await pruneCacheFiles(today, retentionDays);
  await removeLegacyCacheFile();
}

export function getCachedTranslation(cache, entryId) {
  return cache.dayCache.translations?.[entryId] ?? null;
}

export function setCachedTranslation(cache, entryId, value) {
  cache.dayCache.translations[entryId] = value;
}

export function getCachedTranslationFailure(cache, entryId) {
  return cache.dayCache.translationFailures?.[entryId] ?? null;
}

export function setCachedTranslationFailure(cache, entryId, value) {
  cache.dayCache.translationFailures[entryId] = value;
}

export function clearCachedTranslationFailure(cache, entryId) {
  delete cache.dayCache.translationFailures[entryId];
}

export function getCachedHighlight(cache, entryId) {
  return cache.dayCache.highlights?.[entryId] ?? null;
}

export function setCachedHighlight(cache, entryId, value) {
  cache.dayCache.highlights[entryId] = value;
}

async function loadCacheDaysFromFiles() {
  const files = await readdir(CACHE_DIR, { withFileTypes: true });
  const days = {};

  for (const file of files) {
    if (!file.isFile()) {
      continue;
    }

    const match = file.name.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (!match) {
      continue;
    }

    const day = match[1];
    const payload = await readJson(path.join(CACHE_DIR, file.name), null);
    if (!payload || typeof payload !== "object") {
      continue;
    }

    days[day] = {
      translations: payload.translations ?? {},
      highlights: payload.highlights ?? {},
      translationFailures: payload.translationFailures ?? {}
    };
  }

  return days;
}

async function loadLegacyCacheDays(today, retentionDays) {
  const payload = await readJson(LEGACY_CACHE_FILE, null);
  if (!payload || typeof payload !== "object") {
    return {};
  }

  return pruneDays(payload.days ?? {}, today, retentionDays);
}

async function pruneCacheFiles(today, retentionDays) {
  const threshold = shiftDate(today, -(retentionDays - 1));
  const files = await readdir(CACHE_DIR, { withFileTypes: true });

  for (const file of files) {
    if (!file.isFile()) {
      continue;
    }

    const match = file.name.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (!match) {
      continue;
    }

    const day = match[1];
    if (day < threshold || day > today) {
      await rm(path.join(CACHE_DIR, file.name), { force: true });
    }
  }
}

async function removeLegacyCacheFile() {
  await rm(LEGACY_CACHE_FILE, { force: true });
}

function createEmptyDayCache(day) {
  return {
    date: day,
    translations: {},
    highlights: {},
    translationFailures: {}
  };
}

function buildDayCachePath(day) {
  return path.join(CACHE_DIR, `${day}.json`);
}

function getRetentionDays() {
  const raw = Number(process.env.LLM_CACHE_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS);
  if (!Number.isFinite(raw) || raw < 1) {
    return DEFAULT_RETENTION_DAYS;
  }
  return Math.floor(raw);
}

function pruneDays(days, today, retentionDays) {
  const threshold = shiftDate(today, -(retentionDays - 1));
  const nextDays = {};

  for (const [day, value] of Object.entries(days)) {
    if (!isIsoDateKey(day)) {
      continue;
    }
    if (day >= threshold && day <= today) {
      nextDays[day] = {
        date: day,
        translations: value?.translations ?? {},
        highlights: value?.highlights ?? {},
        translationFailures: value?.translationFailures ?? {}
      };
    }
  }

  return nextDays;
}

function shiftDate(dateKey, offsetDays) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() + offsetDays);
  return utcDate.toISOString().slice(0, 10);
}

function isIsoDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
