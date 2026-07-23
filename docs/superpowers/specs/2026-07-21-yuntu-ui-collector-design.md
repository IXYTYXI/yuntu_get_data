# Yuntu UI Collector Design

**Status:** Approved design awaiting written-spec review

## Goal

Build a TypeScript command-line collector for the authorised, logged-in Yuntu UI workflow. It will apply configured visible filters, open material details, capture page-visible metadata, and verify that the embedded player starts playback. It will not read, save, or derive media URLs.

## Scope

- Start from a manually authenticated browser session; the tool never handles passwords, cookies, or browser storage.
- Apply configured visible filters: industry, date range, touchpoints, material type, brands, and result limit.
- Open each selected material's visible detail panel and collect page-visible fields:
  - material ID, title, duration, launch date, industry, touchpoints;
  - performance metrics shown on the page;
  - page-visible script and content-analysis text, when present.
- Verify playback by clicking the visible player control and checking that the visible player advances.
- Write collected records to JSONL or CSV.
- Define an `AuthorizedDownloader` interface for a future official download/export permission. The initial implementation is deliberately disabled and returns a clear `DOWNLOAD_NOT_AUTHORIZED` result.

## Explicit Non-goals

- Do not inspect Network/Media requests, retrieve direct media URLs, or reproduce request headers.
- Do not read or persist cookies, session storage, passwords, or temporary authorisation values.
- Do not bypass platform controls, download files through undeclared endpoints, or batch-download video files.
- Do not write to Feishu Base in this first release.

## Architecture

```text
CLI configuration
  -> visible Yuntu filter workflow
  -> material detail workflow
  -> metadata extraction + playback verification
  -> JSONL / CSV sink
  -> optional authorised-download interface (disabled by default)
```

The UI adapter owns selectors and browser interactions. The domain layer owns configuration validation, record shaping, result states, and output formatting. This keeps browser-specific code isolated from testable data logic.

## Proposed Modules

- `src/config.ts` — parse and validate JSON configuration.
- `src/domain.ts` — collection configuration, material record, result, and error types.
- `src/ui/yuntu-page.ts` — visible filtering and result-row navigation.
- `src/ui/material-detail.ts` — detail extraction and visible playback verification.
- `src/download/authorized-downloader.ts` — future official-download boundary; disabled implementation for v1.
- `src/output.ts` — JSONL and CSV serialization.
- `src/cli.ts` — command-line entry point and orchestration.
- `tests/` — unit tests for configuration, record validation, output serialization, and disabled-download behavior.

## Data Contract

Each output record contains a material ID, title, duration, visible metadata, optional script/content text, playback verification state, and a download state. It never contains a browser session value, a media URL, or a request header.

Playback is `verified` only when the visible player changes from paused at a known time to actively playing with a later playback time. Missing selectors or a stalled player yield a typed failure rather than a guessed success.

## Error Handling and Safety

- Missing login state: `AUTH_REQUIRED`.
- Changed or missing visible control: `SELECTOR_NOT_FOUND`.
- Player does not advance: `PLAYBACK_NOT_CONFIRMED`.
- Attempted download without approved implementation: `DOWNLOAD_NOT_AUTHORIZED`.
- Logs redact URL query strings and never print secrets or session material.

The command succeeds only when it can produce valid records; per-material failures are retained as structured results so one bad record does not discard other visible records.

## Testing

- Unit tests cover all pure domain and output behavior without a browser.
- Browser automation uses a headed, manually authenticated run and is not required for CI.
- A dry-run mode performs filtering, detail opening, and playback verification without invoking any downloader.

## Delivery

The repository will keep matching history on both remotes:

- GitHub: `https://github.com/IXYTYXI/yuntu_get_data.git`
- GitLab: `https://gitlab.yc345.tv/fengyang1/yuntu_get_data.git`

The GitHub remote is the primary `origin`; the GitLab remote is named `gitlab`.
