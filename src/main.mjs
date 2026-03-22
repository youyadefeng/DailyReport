import { runPipeline } from "./lib/pipeline.mjs";

const options = parseArgs(process.argv.slice(2));

try {
  const result = await runPipeline(options);
  console.log(`\u6267\u884c\u5b8c\u6210\u65f6\u95f4: ${result.fetchedAt}`);
  console.log(`\u4fe1\u606f\u6e90\u6570\u91cf: ${result.sources}`);
  if (result.selectedSourceNames?.length > 0) {
    console.log(`\u672c\u6b21\u8fd0\u884c\u4fe1\u606f\u6e90: ${result.selectedSourceNames.join(" | ")}`);
  }
  console.log(`\u672c\u8f6e\u6293\u53d6\u6761\u6570: ${result.newEntries}`);
  console.log(`\u672c\u8f6e\u65b0\u589e\u6761\u6570: ${result.createdEntries}`);
  console.log(`\u672c\u8f6e\u5237\u65b0\u6761\u6570: ${result.refreshedEntries}`);
  console.log(`\u5f53\u524d\u603b\u6761\u6570: ${result.totalEntries}`);
  console.log(`\u65e5\u62a5\u8def\u5f84: ${result.reportPath}`);
  console.log(
    `\u4e2d\u6587\u7ffb\u8bd1: ${
      result.translationEnabled ? `\u5df2\u542f\u7528 (${result.translationModel})` : "\u672a\u542f\u7528"
    }`
  );
  console.log(
    `LLM\u91cd\u70b9\u6392\u5e8f: ${
      result.llmHighlightScoringEnabled ? `\u5df2\u542f\u7528 (${result.llmHighlightModel})` : "\u672a\u542f\u7528"
    }`
  );
  if (result.translationEnabled) {
    console.log(`\u5df2\u7ffb\u8bd1\u6761\u6570: ${result.translatedEntries}`);
    console.log(`\u8df3\u8fc7\u7ffb\u8bd1\u6761\u6570: ${result.translationSkippedEntries}`);
    console.log(`\u7ffb\u8bd1\u7f13\u5b58\u547d\u4e2d: ${result.translationCacheHits}`);
  }
  if (result.llmHighlightScoringEnabled) {
    console.log(`LLM\u6253\u5206\u5019\u9009\u6570: ${result.llmHighlightScoredCount}`);
    console.log(`Highlights \u7f13\u5b58\u547d\u4e2d: ${result.llmHighlightCacheHits}`);
  }
  if (result.createdEntryPreview.length > 0) {
    console.log("\u65b0\u589e\u6761\u76ee\u9884\u89c8:");
    for (const [index, entry] of result.createdEntryPreview.entries()) {
      console.log(`${index + 1}. ${entry.titleZh ?? entry.title} [${entry.source}]`);
    }
  }
  if (result.githubCreatedEntryPreview.length > 0) {
    console.log("GitHub \u65b0\u589e\u9879\u76ee\u9884\u89c8:");
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
        console.log(`   \u6700\u8fd1\u66f4\u65b0: ${entry.github.updatedAtCn ?? entry.github.updatedAt ?? entry.publishedAt ?? "unknown"}`);
      }
    }
  }
  if (result.failures.length > 0) {
    console.log(`\u5931\u8d25\u6e90\u6570\u91cf: ${result.failures.length}`);
    for (const failure of result.failures) {
      console.log(
        `- ${failure.source}: ${failure.message} (\u7c7b\u578b: ${failure.category ?? "unknown"}, \u5c1d\u8bd5\u6b21\u6570: ${failure.attempts ?? 1})`
      );
    }
  }
  if (result.reportHighlightsNonGithub?.length > 0) {
    console.log("\u975e GitHub \u4eca\u65e5\u91cd\u70b9\u9884\u89c8:");
    for (const [index, entry] of result.reportHighlightsNonGithub.entries()) {
      console.log(`${index + 1}. ${entry.titleZh ?? entry.title} [${entry.category}]`);
      if (entry.highlightReasonZh) {
        console.log(`   \u5165\u9009\u7406\u7531: ${entry.highlightReasonZh}`);
      }
    }
  }
  if (result.reportHighlightsGithub?.length > 0) {
    console.log("GitHub \u4eca\u65e5\u91cd\u70b9\u9884\u89c8:");
    for (const [index, entry] of result.reportHighlightsGithub.entries()) {
      const stars = Number(entry.github?.stars ?? 0);
      const watchers = Number(entry.github?.watchers ?? 0);
      const forks = Number(entry.github?.forks ?? 0);
      const popularityScore = stars * 5 + forks * 3 + watchers;
      console.log(`${index + 1}. ${entry.titleZh ?? entry.title} [${entry.category}] | \u70ed\u5ea6\u5206 ${popularityScore}`);
    }
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

function parseArgs(args) {
  const options = {
    verbose: false,
    sourceFilters: [],
    tagFilters: []
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
    }
  }

  return options;
}
