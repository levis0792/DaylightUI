# zhCN automation

This fork keeps Simplified Chinese current without a manual ZIP for every
release. The workflow lives in `.github/workflows/zhcn.yml`.

## What runs automatically

Every day at 02:17 UTC (10:17 Asia/Shanghai) and whenever manually triggered:

1. Fast-forwards the fork to `dayightt/DaylightUI:main`.
2. Scans every shipped Lua source file for visible UI text.
3. Reuses existing reviewed translations as translation memory.
4. Sends only the remaining missing strings to an OpenAI-compatible endpoint.
5. Rejects empty values and changed `%s`, `%d`, color or texture codes.
6. Commits `Locales/zhCN.lua` to `automation/zhcn` only when it changed.
7. Creates or updates a pull request to the author's `main`.

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

The script validates placeholders before writing anything. If the model returns
invalid or incomplete JSON, the workflow fails and no commit is made. A failed
run is visible in the Actions tab and does not produce a broken PR.

## Local commands

```powershell
node tools/zhcn.js check
node tools/zhcn.js missing
node tools/zhcn.js translate
node tools/zhcn.js apply translations/zhCN-<version>.json
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
