# Yuntu visible-UI collector

This first-release collector attaches to a Chrome window that you already opened and signed in to manually. It gathers only information exposed through the configured, visible Yuntu UI and writes local JSONL or CSV output.

## Setup

Install dependencies:

```sh
npm install
```

Start a dedicated Chrome instance with remote debugging enabled. On Linux, for example:

```sh
google-chrome --remote-debugging-port=9222
```

On macOS, use:

```sh
open -na "Google Chrome" --args --remote-debugging-port=9222
```

In that Chrome window, open Yuntu and sign in yourself. For the safest workflow, keep this debugging window to one Yuntu tab. The collector does not sign in, navigate to a page, read cookies or storage, or close Chrome; it only disconnects its own CDP client when finished.

Copy the example configuration and adapt its selectors to the currently visible Yuntu UI:

```sh
cp config.example.json config.json
```

Use selectors that identify visible filter controls, result cards, the detail panel, its player/play control, and visible text fields. Keep `pageUrlPrefix` on the trusted Yuntu HTTPS origin and choose a safe relative output path.

Run the collector against the already-open debugging instance:

```sh
npm start -- --config config.json --cdp-url http://127.0.0.1:9222
```

When the debugging browser has more than one tab, the collector deliberately refuses to scan tab URLs. Pass an explicit, already-known zero-based page index instead, or use a dedicated one-tab debugging window:

```sh
npm start -- --config config.json --cdp-url http://127.0.0.1:9222 --page-index 0
```

The tool does not list tab URLs to help choose an index, because that could expose unrelated tabs. Prefer the one-tab window when the index is not already known.

Use `--dry-run` to run the same visible filtering, detail collection, and playback-verification workflow without invoking any future downloader:

```sh
npm start -- --config config.json --cdp-url http://127.0.0.1:9222 --dry-run
```

## Output

The `output` object in the configuration controls the local format and path:

- `jsonl` writes one material record per line, which is convenient for streaming and further processing.
- `csv` writes a header row plus one material record per row for spreadsheet import.

Records contain visible metadata, visible metrics text, playback status, and the fixed v1 download status `not-authorized` / `DOWNLOAD_NOT_AUTHORIZED`. No raw media URL is persisted.

## Selector maintenance

Yuntu UI selectors can become fragile when the site layout or DOM changes. If a configured control is hidden, missing, or no longer matches the intended visible element, the collector records a safe selector-related error for that material and continues with later materials where possible. Review and update `config.json` after UI changes.

## First-release limits

This version does **not**:

- download video;
- extract media locations;
- access cookies or browser storage;
- write to Feishu Base; or
- use direct media or download APIs.

Before any future downloader is implemented, obtain approval for the platform's official export workflow. Until then, this collector remains limited to visible UI collection and local JSONL/CSV output.
