# zhCN automation

This fork keeps Simplified Chinese current without a manual ZIP for every
release. The workflow lives in `.github/workflows/zhcn.yml`.

## What runs automatically

Every 15 minutes (GitHub may delay scheduled jobs) and whenever manually triggered:

1. Checks `dayightt/DaylightUI:main` and reuses an existing run for the same SHA, so one author commit triggers one update.
2. Scans every shipped Lua source file for visible UI text.
3. Reuses existing reviewed translations as translation memory.
4. Sends only the remaining missing strings to an OpenAI-compatible endpoint.
5. Rejects empty values and changed `%s`, `%d`, color or texture codes.
6. Runs `tests/test_zhcn_tool.js` to prove the approved glossary is in the AI request and transient request failures are retried with backoff.
7. Runs the author's own `luajit tests/run.lua --only test_locale` test against the generated locale.
8. Commits `Locales/zhCN.lua` to `automation/zhcn` only when it changed and the native locale test passed.
9. Merges the author's latest `main` into the automation branch without force-pushing and creates or updates the pull request to the author's `main`.
10. Keeps the same PR current on later author commits; if a new upstream release adds no visible text, the locale diff stays unchanged.

The bot never pushes directly to upstream and never merges its own PR.

## One-time GitHub setup

In the fork `levis0792/DaylightUI`:

1. Open **Settings > Secrets and variables > Actions**.
2. Add repository secret `OPENAI_API_KEY`.
3. Optionally add repository variables:
   - `OPENAI_BASE_URL` — defaults to `https://api.openai.com/v1`.
   - `OPENAI_MODEL` — defaults to `gpt-4.1-mini`.
4. Open **Actions > Update zhCN translation > Run workflow** for the first run.

The workflow uses the repository's built-in `GITHUB_TOKEN`; no personal token is
needed. `contents: write` and `pull-requests: write` are explicitly enabled.

## Translation quality controls

The translation prompt fixes common WoW terminology:

- 爆击, 微缩地图, 鼠标提示, 潜行者
- PvP, PvE, RP, DPS, HPS, NPC and UI stay in English
- complete sentences are translated as complete sentences
- slash commands, font names and code identifiers stay unchanged

The script validates placeholders before writing anything. A failed or partial
AI response is retried up to three times by default; server errors, rate limits
and timeouts use exponential backoff. Authentication and malformed-input errors
are not retried, because repeating the same request cannot fix them.

`tools/zhcn-glossary.json` is loaded from the maintenance checkout, not from the
author's PR branch. `ZHCN_TOOL_ROOT` and `ZHCN_ROOT` are separate, so the workflow can read tools from one directory and the generated locale from another. The workflow fails if the glossary is missing, invalid or empty, and includes it in every AI request.

The workflow also runs the author's own locale suite after writing the file and
before creating the commit or PR. That suite loads every language file, checks
keys, placeholders and color codes, draws every options page and setup guide,
and runs the pseudo-language sweeps. A failed native locale test blocks the PR.

## Local commands

```powershell
node tools/zhcn.js check
node tools/zhcn.js missing
node tools/zhcn.js translate
node tools/zhcn.js apply translations/zhCN-<version>.json
node tests/test_zhcn_tool.js
```

`check` must report:

```text
Untranslated: 0
Duplicate keys: 0
Format/empty errors: 0
```

The scanner covers the repository root and all `DaylightUI_*` modules, not only
the folders that happen to contain literal `L[...]` calls. This catches dynamic
option labels and stat tooltips that the author's basic scanner can miss.

## Review policy

Automation can prepare the PR, but a human should review new long sentences,
Focus/Focus Target terminology and mouseover text in game. The author must still
review and merge the PR. This keeps the workflow useful without granting it
permission to publish unreviewed text.