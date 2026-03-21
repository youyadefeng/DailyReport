import { runPipeline } from "./lib/pipeline.mjs";

const verbose = process.argv.includes("--verbose");

try {
  const result = await runPipeline({ verbose });
  console.log(`Pipeline finished at ${result.fetchedAt}`);
  console.log(`Sources: ${result.sources}`);
  console.log(`New entries: ${result.newEntries}`);
  console.log(`Total entries: ${result.totalEntries}`);
  console.log(`Report: ${result.reportPath}`);
  if (result.failures.length > 0) {
    console.log(`Failures: ${result.failures.length}`);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
