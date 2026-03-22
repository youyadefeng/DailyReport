# AI Context

This file is an AI-oriented handoff document for the `ai-news-pipeline` project.
It is intended for future use by other models, coding agents, or automation tools.

## 1. Project purpose

This project builds a local AI news collection pipeline.

Current capabilities:
- Collect AI-related content from configured sources
- Normalize and store entries locally
- Translate title and summary to Chinese with LLMs
- Score and rank report highlights with LLMs
- Generate Markdown reports
- Cache translation and highlight results locally by day

Primary user goal:
- Run the pipeline locally on Windows by double-clicking `run_pipeline.bat`
- Later keep extending the pipeline while preserving low-friction local use

## 2. Runtime and entrypoints

Tech stack:
- Node.js
- ESM modules (`.mjs`)
- Local JSON files for config/data/cache

Main entrypoints:
- [bootstrap.mjs](F:/CodexProject/src/bootstrap.mjs)
  - Loads local env file, then imports main entry
- [main.mjs](F:/CodexProject/src/main.mjs)
  - CLI entry
  - Parses `--verbose`, `--source`, `--tag`
  - Prints terminal summary
- [run_pipeline.bat](F:/CodexProject/run_pipeline.bat)
  - Double-click launcher
- [run_pipeline.ps1](F:/CodexProject/run_pipeline.ps1)
  - Actual Windows runner with terminal output and log capture

Useful npm scripts:
- `npm run run:pipeline`
- `npm run run:pipeline:verbose`
- `npm run run:pipeline:github`
- `npm run run:pipeline:github:verbose`

## 3. High-level data flow

Pipeline flow:
1. Load config and enabled sources
2. Fetch source content
3. Normalize items into internal entries
4. Merge with local store
5. Translate title/summary if configured
6. Re-rank report highlights with LLM if configured
7. Write hourly report under daily folder
8. Save daily cache

Core orchestrator:
- [pipeline.mjs](F:/CodexProject/src/lib/pipeline.mjs)

## 4. Config files

All user-facing config files are intentionally centralized in:
- [config](F:/CodexProject/config)

Main config files:
- [project.config.mjs](F:/CodexProject/config/project.config.mjs)
  - Global defaults
  - Paths
  - Network timeouts
  - Retry counts
  - Cache retention
  - Default model values
- [sources.json](F:/CodexProject/config/sources.json)
  - Active source list
  - Per-source `enabled` switch
- [sources.example.json](F:/CodexProject/config/sources.example.json)
  - Template/examples for adding sources
- [.env.local](F:/CodexProject/config/.env.local)
  - Private local secrets and provider overrides
- [.env.example](F:/CodexProject/config/.env.example)
  - Template for `.env.local`

Important note:
- `config/.env.local` is gitignored and should not be committed

## 5. Current source types

Currently supported source types:
- `rss`
- `github-api-search`

Current production sources live in:
- [sources.json](F:/CodexProject/config/sources.json)

Each source supports:
- `name`
- `enabled`
- `type`
- `url`
- `limit`
- `priority`
- `tags`

Source loading behavior:
- `enabled: false` means the source stays in config but is skipped
- Disabled sources are reported in verbose startup output

## 6. Storage layout

Local data:
- [entries.json](F:/CodexProject/data/entries.json)
  - Long-lived merged item store
  - One entry per unique item id
  - Entry id is usually the source URL/link

Daily LLM cache:
- [llm-cache](F:/CodexProject/data/llm-cache)
  - One JSON file per day, e.g. `2026-03-22.json`
  - Stores both:
    - `translations`
    - `highlights`
  - Old cache is automatically pruned
  - Retention default: 7 days

Reports:
- [reports](F:/CodexProject/reports)
  - Reports are grouped by day
  - Current structure:
    - `reports/YYYY-MM-DD/YYYY-MM-DD_HH.md`

Logs:
- [logs](F:/CodexProject/logs)

## 7. Core modules

Main library modules:
- [pipeline.mjs](F:/CodexProject/src/lib/pipeline.mjs)
  - Source loading
  - Fetch loop
  - Merge/store
  - Report writing
  - GitHub ordering logic
- [translator.mjs](F:/CodexProject/src/lib/translator.mjs)
  - Translation provider selection
  - Batch translation
  - Translation cache integration
- [highlight-scorer.mjs](F:/CodexProject/src/lib/highlight-scorer.mjs)
  - Highlight candidate selection
  - LLM scoring
  - Highlight cache integration
- [llm-cache.mjs](F:/CodexProject/src/lib/llm-cache.mjs)
  - Daily per-file cache load/save
  - Legacy cache migration
  - Retention pruning
- [github-api.mjs](F:/CodexProject/src/lib/github-api.mjs)
  - Parses GitHub Search API results
  - Enriches contributor counts
- [rss.mjs](F:/CodexProject/src/lib/rss.mjs)
  - RSS/Atom parsing
- [text-utils.mjs](F:/CodexProject/src/lib/text-utils.mjs)
  - Summary generation
  - Categorization
  - Date/hour slug generation
- [http-utils.mjs](F:/CodexProject/src/lib/http-utils.mjs)
  - HTTP GET helpers

## 8. Current ranking behavior

### General entries

Base rule score is generated in:
- [text-utils.mjs](F:/CodexProject/src/lib/text-utils.mjs)

Signals include:
- Source priority
- Certain keywords like releases/research/open source

### Highlights

Highlights are selected in two stages:
1. Rule-based preselection
2. LLM re-ranking

Highlight scoring logic:
- [highlight-scorer.mjs](F:/CodexProject/src/lib/highlight-scorer.mjs)

### GitHub ordering

GitHub items are intentionally sorted differently from general entries.

GitHub section ordering currently uses a weighted popularity score:
- `stars * 5 + forks * 3 + watchers`

If popularity ties:
- More recent updates come first

This affects:
- GitHub section ordering in report
- GitHub preview ordering in terminal output

## 9. Current translation behavior

Translation is optional and provider-driven.

Supported providers:
- OpenAI
- MiniMax

Selection logic:
- If `OPENAI_API_KEY` exists, OpenAI is preferred
- Otherwise if `MINIMAX_API_KEY` exists, MiniMax is used
- If neither exists, translation is skipped

Translation behavior:
- Only translates entries that do not already have Chinese fields
- Same-day cache can satisfy repeated requests
- Current MiniMax usage is optimized for smaller batches

Important files:
- [translator.mjs](F:/CodexProject/src/lib/translator.mjs)
- [project.config.mjs](F:/CodexProject/config/project.config.mjs)
- [.env.local](F:/CodexProject/config/.env.local)

## 10. Report format

Report writer:
- [pipeline.mjs](F:/CodexProject/src/lib/pipeline.mjs)

Current report includes:
- Daily summary header
- Highlight section
- Category sections
- Dedicated `GitHub / Open Source` section
- GitHub-specific metadata:
  - popularity score
  - stars
  - watchers
  - forks
  - open issues
  - contributors
  - recent update
  - primary language

## 11. Conventions and important project decisions

Project decisions already made:
- Config files are centralized under `config/`
- Reports are grouped by day, then hour
- LLM cache is stored by day, one file per day
- Source config supports `enabled` toggles
- GitHub items are ranked by popularity, not raw fetch order
- Terminal output is Chinese-first
- Prefer local JSON and simple filesystem storage over database complexity

Do not casually change these without a clear reason:
- Report folder structure
- Cache retention and cache key semantics
- Source id behavior based on URL
- Windows double-click runner flow

## 12. Testing and verification preference

Important user preference:
- Do not run the full pipeline unnecessarily during development
- Prefer the smallest relevant verification scope

Examples:
- If changing GitHub logic, prefer:
  - `npm run run:pipeline:github`
  - or `npm run run:pipeline:github:verbose`
- Only run broader tests when changing shared/global pipeline behavior

This preference exists to reduce:
- unnecessary runtime
- unnecessary API usage
- unnecessary MiniMax usage

## 13. Known rough edges

Current rough edges worth knowing:
- Some files in the repo show legacy encoding artifacts in comments or older docs
- MiniMax sometimes returns malformed JSON; parsing has partial recovery and graceful fallback
- README is not the best canonical source right now
- `AI_CONTEXT.md` should be treated as the clearer AI-oriented handoff document

## 14. Suggested extension points

Good next changes for future agents:
- Add more source types beyond RSS and GitHub API
- Improve highlight ranking with more explicit dimensions
- Add source-specific filters or quality gates
- Improve translation quality and retry logic
- Add delivery channels like email/Feishu/Obsidian export
- Add better cache observability and stats

## 15. Safe first reads for a new model

If another model is dropped into this repo, the fastest onboarding sequence is:
1. Read [AI_CONTEXT.md](F:/CodexProject/AI_CONTEXT.md)
2. Read [project.config.mjs](F:/CodexProject/config/project.config.mjs)
3. Read [sources.json](F:/CodexProject/config/sources.json)
4. Read [pipeline.mjs](F:/CodexProject/src/lib/pipeline.mjs)
5. Read [translator.mjs](F:/CodexProject/src/lib/translator.mjs)
6. Read [highlight-scorer.mjs](F:/CodexProject/src/lib/highlight-scorer.mjs)
7. Use the smallest possible verification command
