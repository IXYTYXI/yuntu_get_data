import assert from "node:assert/strict";
import test from "node:test";

import { DisabledAuthorizedDownloader } from "../src/download/authorized-downloader.js";

test("returns the exact disabled result for an identified material", async () => {
  const downloader = new DisabledAuthorizedDownloader();

  const result = await downloader.download({
    materialId: "material-123",
    title: "Campaign video",
  });

  assert.deepEqual(result, {
    state: "not-authorized",
    code: "DOWNLOAD_NOT_AUTHORIZED",
  });
});
