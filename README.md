# Yuntu visible-UI collector

This collector attaches to a Chrome window that you already opened and signed in to manually. It gathers information exposed through the configured, visible Yuntu UI, verifies playback, downloads verified player media to disk, and writes local JSONL or CSV metadata output.

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

In that Chrome window, open Yuntu and sign in yourself. For the safest workflow, keep this debugging window to one Yuntu tab. The collector does not sign in, navigate to a page, read cookies or storage directly, or close Chrome; it only disconnects its own CDP client when finished.

Copy the example configuration and adapt its selectors to the currently visible Yuntu UI:

```sh
cp config.example.json config.json
```

Use selectors that identify visible filter controls, result cards, the detail panel, its player/play control, and visible text fields. Keep `pageUrlPrefix` on the trusted Yuntu HTTPS origin and choose safe relative output paths.

Run the collector against the already-open debugging instance:

```sh
npm start -- --config config.json --cdp-url http://127.0.0.1:9222
```

When the debugging browser has more than one tab, the collector deliberately refuses to scan tab URLs. Pass an explicit, already-known zero-based page index instead, or use a dedicated one-tab debugging window:

```sh
npm start -- --config config.json --cdp-url http://127.0.0.1:9222 --page-index 0
```

The tool does not list tab URLs to help choose an index, because that could expose unrelated tabs. Prefer the one-tab window when the index is not already known.

Use `--dry-run` to collect metadata and verify playback without downloading videos:

```sh
npm start -- --config config.json --cdp-url http://127.0.0.1:9222 --dry-run
```

## Output

The `output` object controls metadata format and path:

- `jsonl` writes one material record per line, which is convenient for streaming and further processing.
- `csv` writes a header row plus one material record per row for spreadsheet import.

The `download` object controls where verified videos are saved:

- `directory` is a safe relative folder such as `output/videos`.
- `filenameExtension` defaults to `mp4`.

After playback is verified, the collector reads the visible player source and downloads the media through the authenticated browser context. Records contain visible metadata, playback status, and a relative download path or failure code. No raw media URL is persisted.

## Selector maintenance

Yuntu UI selectors can become fragile when the site layout or DOM changes. If a configured control is hidden, missing, or no longer matches the intended visible element, the collector records a safe selector-related error for that material and continues with later materials where possible. Review and update `config.json` after UI changes.

## Limits

This version does **not**:

- persist media URLs in metadata output;
- read cookies or browser storage directly;
- write to Feishu Base; or
- download HLS (`.m3u8`) streams.

Obtain approval for any workflow that bypasses the platform's visible UI controls.
