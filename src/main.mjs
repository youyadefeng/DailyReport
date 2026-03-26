import { addFavorite, findEntryForFavorite, loadFavorites, removeFavorite, renderFavoriteList } from "./lib/favorites.mjs";
import { loadStore, runPipeline } from "./lib/pipeline.mjs";

const options = parseArgs(process.argv.slice(2));

try {
  if (options.favoriteTarget || options.unfavoriteTarget || options.listFavorites) {
    await handleFavoritesCommand(options);
  } else {
    const result = await runPipeline(options);
    console.log(`执行完成时间: ${result.fetchedAt}`);
    console.log(`信息源数量: ${result.sources}`);
    if (result.selectedSourceNames?.length > 0) {
      console.log(`本次运行信息源: ${result.selectedSourceNames.join(" | ")}`);
    }
    console.log(`本轮抓取条数: ${result.newEntries}`);
    console.log(`本轮新增条数: ${result.createdEntries}`);
    console.log(`本轮刷新条数: ${result.refreshedEntries}`);
    console.log(`当前总条数: ${result.totalEntries}`);
    console.log(`日报路径: ${result.reportPath}`);
    console.log(`中文翻译: ${result.translationEnabled ? `已启用 (${result.translationModel})` : "未启用"}`);
    console.log(
      `LLM重点排序: ${result.llmHighlightScoringEnabled ? `已启用 (${result.llmHighlightModel})` : "未启用"}`
    );

    if (result.translationEnabled) {
      console.log(`已翻译条数: ${result.translatedEntries}`);
      console.log(`跳过翻译条数: ${result.translationSkippedEntries}`);
      console.log(`实际调用翻译 LLM 条数: ${result.translationRequestedEntries}`);
      console.log(`实际调用翻译 LLM 批次: ${result.translationRequestBatchCount}`);
      console.log(`已有中文字段跳过: ${result.translationExistingFieldSkips}`);
      console.log(`翻译缓存命中: ${result.translationCacheHits}`);
      console.log(`当天翻译失败缓存跳过: ${result.translationFailureCacheSkips}`);
      console.log(`本轮翻译失败: ${result.translationFailedEntries}`);
      console.log(
        `翻译 Token 消耗: 输入 ${result.translationUsage.inputTokens} | 输出 ${result.translationUsage.outputTokens} | 合计 ${result.translationUsage.totalTokens}`
      );
      if (result.translationMissingContentSkips > 0) {
        console.log(`缺少标题或摘要跳过: ${result.translationMissingContentSkips}`);
      }
    }

    if (result.llmHighlightScoringEnabled) {
      console.log(`LLM打分候选数: ${result.llmHighlightScoredCount}`);
      console.log(`Highlights 缓存命中: ${result.llmHighlightCacheHits}`);
      console.log(`实际调用 Highlights LLM 条数: ${result.llmHighlightRequestedEntries}`);
      console.log(`实际调用 Highlights LLM 批次: ${result.llmHighlightRequestBatchCount}`);
      console.log(
        `Highlights Token 消耗: 输入 ${result.llmHighlightUsage.inputTokens} | 输出 ${result.llmHighlightUsage.outputTokens} | 合计 ${result.llmHighlightUsage.totalTokens}`
      );
    }

    if (result.createdEntryPreview.length > 0) {
      console.log("新增条目预览:");
      for (const [index, entry] of result.createdEntryPreview.entries()) {
        console.log(`${index + 1}. ${entry.titleZh ?? entry.title} [${entry.source}]`);
      }
    }

    if (result.githubCreatedEntryPreview.length > 0) {
      console.log("GitHub 新增项目预览:");
      for (const [index, entry] of result.githubCreatedEntryPreview.entries()) {
        console.log(`${index + 1}. ${entry.titleZh ?? entry.title} [${entry.category}]`);
        if (entry.github) {
          const stars = Number(entry.github.stars ?? 0);
          const watchers = Number(entry.github.watchers ?? 0);
          const forks = Number(entry.github.forks ?? 0);
          const popularityScore = stars * 5 + forks * 3 + watchers;
          console.log(
            `   热度分: ${popularityScore} | Stars: ${entry.github.stars ?? "unknown"} | Watchers: ${entry.github.watchers ?? "unknown"} | Forks: ${entry.github.forks ?? "unknown"} | Contributors: ${entry.github.contributors ?? "unknown"}`
          );
          console.log(`   最近更新: ${entry.github.updatedAtCn ?? entry.github.updatedAt ?? entry.publishedAt ?? "unknown"}`);
        }
      }
    }

    if (result.failures.length > 0) {
      console.log(`失败源数量: ${result.failures.length}`);
      for (const failure of result.failures) {
        console.log(`- ${failure.source}: ${failure.message} (类型: ${failure.category ?? "unknown"}, 尝试次数: ${failure.attempts ?? 1})`);
      }
    }

    if (result.reportHighlightsPractice?.length > 0) {
      console.log("实践类型今日重点预览:");
      for (const [index, entry] of result.reportHighlightsPractice.entries()) {
        console.log(`${index + 1}. ${entry.titleZh ?? entry.title} [${entry.category}]`);
        if (entry.highlightReasonZh) {
          console.log(`   入选理由: ${entry.highlightReasonZh}`);
        }
      }
    }

    if (result.reportHighlightsNonGithub?.length > 0) {
      console.log("新闻资讯今日重点预览:");
      for (const [index, entry] of result.reportHighlightsNonGithub.entries()) {
        console.log(`${index + 1}. ${entry.titleZh ?? entry.title} [${entry.category}]`);
        if (entry.highlightReasonZh) {
          console.log(`   入选理由: ${entry.highlightReasonZh}`);
        }
      }
    }

    if (result.reportHighlightsGithub?.length > 0) {
      console.log("GitHub 今日重点预览:");
      for (const [index, entry] of result.reportHighlightsGithub.entries()) {
        const stars = Number(entry.github?.stars ?? 0);
        const watchers = Number(entry.github?.watchers ?? 0);
        const forks = Number(entry.github?.forks ?? 0);
        const popularityScore = stars * 5 + forks * 3 + watchers;
        console.log(`${index + 1}. ${entry.titleZh ?? entry.title} [${entry.category}] | 热度分 ${popularityScore}`);
      }
    }

    if (result.practiceReadGeneratedCount > 0) {
      console.log("工程实践精读已生成:");
      for (const [index, item] of result.practiceReadItems.entries()) {
        console.log(`${index + 1}. ${item.title} -> ${item.path}`);
      }
      console.log(
        `实践精读 Token 消耗: 输入 ${result.practiceReadUsage.inputTokens} | 输出 ${result.practiceReadUsage.outputTokens} | 合计 ${result.practiceReadUsage.totalTokens}`
      );
    }
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

async function handleFavoritesCommand(options) {
  if (options.listFavorites) {
    const favorites = await loadFavorites();
    console.log(renderFavoriteList(favorites));
    return;
  }

  if (options.unfavoriteTarget) {
    const removed = await removeFavorite(options.unfavoriteTarget);
    if (removed > 0) {
      console.log(`已取消收藏 ${removed} 条。`);
    } else {
      console.log("没有找到匹配的收藏条目。");
    }
    return;
  }

  const store = await loadStore();
  const { matches } = findEntryForFavorite(store.entries ?? [], options.favoriteTarget);

  if (matches.length === 0) {
    console.log("没有在本地库存里找到匹配条目。你可以传完整链接、id、原标题或中文标题。");
    return;
  }

  if (matches.length > 1) {
    console.log("匹配到多条内容，请给更精确一点的链接或标题：");
    for (const [index, entry] of matches.entries()) {
      console.log(`${index + 1}. ${entry.titleZh ?? entry.title} [${entry.source}]`);
      console.log(`   ${entry.url}`);
    }
    return;
  }

  const saved = await addFavorite(matches[0]);
  console.log(`已收藏: ${saved.titleZh ?? saved.title}`);
  console.log(`来源: ${saved.source}`);
  console.log(`原文: ${saved.url}`);
}

function parseArgs(args) {
  const options = {
    verbose: false,
    sourceFilters: [],
    tagFilters: [],
    favoriteTarget: null,
    unfavoriteTarget: null,
    listFavorites: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--verbose") {
      options.verbose = true;
      continue;
    }

    if (arg === "--source" && args[index + 1]) {
      options.sourceFilters.push(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--source=")) {
      options.sourceFilters.push(arg.slice("--source=".length));
      continue;
    }

    if (arg === "--tag" && args[index + 1]) {
      options.tagFilters.push(args[index + 1]);
      index += 1;
      continue;
    }

    if (arg.startsWith("--tag=")) {
      options.tagFilters.push(arg.slice("--tag=".length));
      continue;
    }

    if (arg === "--favorite" && args[index + 1]) {
      options.favoriteTarget = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--favorite=")) {
      options.favoriteTarget = arg.slice("--favorite=".length);
      continue;
    }

    if (arg === "--unfavorite" && args[index + 1]) {
      options.unfavoriteTarget = args[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--unfavorite=")) {
      options.unfavoriteTarget = arg.slice("--unfavorite=".length);
      continue;
    }

    if (arg === "--favorites") {
      options.listFavorites = true;
    }
  }

  return options;
}
