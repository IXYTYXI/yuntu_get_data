import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import type { MaterialRecord } from "./domain.js";

const FEISHU_BASE = "https://open.feishu.cn/open-apis";
const UPLOAD_ALL_MAX_BYTES = 20 * 1024 * 1024;

export interface FeishuUploadConfig {
  appId: string;
  appSecret: string;
}

export interface FeishuUploadResult {
  baseUrl: string;
  appToken: string;
  tableId: string;
  recordCount: number;
  attachmentCount: number;
}

interface FieldDef {
  name: string;
  type: number;
}

async function getTenantAccessToken(
  appId: string,
  appSecret: string,
): Promise<string> {
  const res = await fetch(
    `${FEISHU_BASE}/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to get tenant token: HTTP ${res.status}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  if (data.code !== 0) {
    throw new Error(
      `Failed to get tenant token: code=${data.code} msg=${data.msg}`,
    );
  }

  return data.tenant_access_token as string;
}

async function feishuPost(
  token: string,
  apiPath: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${FEISHU_BASE}${apiPath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Feishu API ${apiPath} HTTP ${res.status}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  if ((data.code as number) !== 0) {
    throw new Error(
      `Feishu API ${apiPath} code=${data.code} msg=${data.msg}`,
    );
  }

  return data;
}

async function feishuPut(
  token: string,
  apiPath: string,
  body: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${FEISHU_BASE}${apiPath}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Feishu API ${apiPath} HTTP ${res.status}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  if ((data.code as number) !== 0) {
    throw new Error(
      `Feishu API ${apiPath} code=${data.code} msg=${data.msg}`,
    );
  }

  return data;
}

async function createBase(token: string, name: string): Promise<string> {
  const data = await feishuPost(token, "/bitable/v1/apps", {
    name,
    folder_token: "",
  });

  const inner = data.data as Record<string, unknown>;
  return inner.app_token as string;
}

async function getDefaultTableId(
  token: string,
  appToken: string,
): Promise<string> {
  const res = await fetch(
    `${FEISHU_BASE}/bitable/v1/apps/${appToken}/tables?page_size=1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  const data = (await res.json()) as Record<string, unknown>;
  const inner = data.data as Record<string, unknown>;
  const items = inner.items as Array<Record<string, unknown>>;
  return items[0].table_id as string;
}

async function createField(
  token: string,
  appToken: string,
  tableId: string,
  fieldDef: FieldDef,
): Promise<void> {
  await feishuPost(
    token,
    `/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
    { field_name: fieldDef.name, type: fieldDef.type },
  );
}

async function renameField(
  token: string,
  appToken: string,
  tableId: string,
  fieldId: string,
  newName: string,
): Promise<void> {
  await feishuPut(
    token,
    `/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${fieldId}`,
    { field_name: newName },
  ).catch(() => undefined);
}

async function getFirstFieldId(
  token: string,
  appToken: string,
  tableId: string,
): Promise<string> {
  const res = await fetch(
    `${FEISHU_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );

  const data = (await res.json()) as Record<string, unknown>;
  const inner = data.data as Record<string, unknown>;
  const items = inner.items as Array<Record<string, unknown>>;
  return items[0].field_id as string;
}

function parseMetricsField(
  visibleText: string,
  pattern: RegExp,
): string | undefined {
  const match = pattern.exec(visibleText);
  return match?.[1]?.trim();
}

function buildRecordFields(
  record: MaterialRecord,
): Record<string, unknown> {
  const vt = record.metrics?.visibleText ?? "";

  const videoId = parseMetricsField(vt, /视频ID\n([^\n]+)/);
  const industry = parseMetricsField(vt, /行业\n([^\n]+)/);
  const touchpoint = parseMetricsField(vt, /触点\n([^\n]+)/);
  const exposure = parseMetricsField(vt, /曝光量\n([^\n]+)/);
  const completionRate = parseMetricsField(vt, /完播率\n([^\n]+)/);
  const fiveSecRate = parseMetricsField(vt, /5S完播率\n([^\n]+)/);
  const ctr = parseMetricsField(vt, /CTR\n([^\n]+)/);
  const cvr = parseMetricsField(vt, /CVR\n([^\n]+)/);
  const pvr = parseMetricsField(vt, /PVR\n([^\n]+)/);

  const fields: Record<string, unknown> = {
    视频标题: record.title ?? "",
  };

  if (record.launchDate) {
    const ts = Date.parse(record.launchDate);
    if (!isNaN(ts)) {
      fields["首投日期"] = ts;
    }
  }

  if (videoId) fields["视频ID"] = videoId;
  if (industry) fields["行业"] = industry;
  if (touchpoint) fields["触点"] = touchpoint;
  if (exposure) fields["曝光量"] = exposure;
  if (completionRate) fields["完播率"] = completionRate;
  if (fiveSecRate) fields["5S完播率"] = fiveSecRate;
  if (ctr) fields["CTR"] = ctr;
  if (cvr) fields["CVR"] = cvr;
  if (pvr) fields["PVR"] = pvr;

  const scriptText = record.script ?? record.transcript ?? "";
  if (scriptText) fields["视频脚本"] = scriptText;

  return fields;
}

async function uploadFileSmall(
  token: string,
  appToken: string,
  fileName: string,
  filePath: string,
  fileSize: number,
): Promise<string> {
  const fileBuffer = await readFile(filePath);
  const formData = new FormData();
  formData.append("file_name", fileName);
  formData.append("parent_type", "bitable_file");
  formData.append("parent_node", appToken);
  formData.append("size", String(fileSize));
  formData.append(
    "file",
    new Blob([fileBuffer], { type: "application/octet-stream" }),
    fileName,
  );

  const res = await fetch(`${FEISHU_BASE}/drive/v1/medias/upload_all`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Upload failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  if ((data.code as number) !== 0) {
    throw new Error(`Upload failed: code=${data.code} msg=${data.msg}`);
  }

  const inner = data.data as Record<string, unknown>;
  return inner.file_token as string;
}

async function uploadFileChunked(
  token: string,
  appToken: string,
  fileName: string,
  filePath: string,
  fileSize: number,
): Promise<string> {
  const prepData = await feishuPost(
    token,
    "/drive/v1/medias/upload_prepare",
    {
      file_name: fileName,
      parent_type: "bitable_file",
      parent_node: appToken,
      size: fileSize,
    },
  );

  const prepInner = prepData.data as Record<string, unknown>;
  const uploadId = prepInner.upload_id as string;
  const blockSize = prepInner.block_size as number;
  const blockNum = prepInner.block_num as number;

  const fileContent = await readFile(filePath);

  for (let seq = 0; seq < blockNum; seq++) {
    const start = seq * blockSize;
    const end = Math.min(start + blockSize, fileSize);
    const chunk = fileContent.subarray(start, end);

    const formData = new FormData();
    formData.append("upload_id", uploadId);
    formData.append("seq", String(seq));
    formData.append("size", String(chunk.length));
    formData.append(
      "file",
      new Blob([chunk], { type: "application/octet-stream" }),
      "part.bin",
    );

    const res = await fetch(`${FEISHU_BASE}/drive/v1/medias/upload_part`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`Upload part ${seq} failed: HTTP ${res.status}`);
    }

    const partData = (await res.json()) as Record<string, unknown>;
    if ((partData.code as number) !== 0) {
      throw new Error(
        `Upload part ${seq} failed: code=${partData.code} msg=${partData.msg}`,
      );
    }
  }

  const finData = await feishuPost(token, "/drive/v1/medias/upload_finish", {
    upload_id: uploadId,
    block_num: blockNum,
  });

  const finInner = finData.data as Record<string, unknown>;
  return finInner.file_token as string;
}

async function uploadBitableFile(
  token: string,
  appToken: string,
  fileName: string,
  filePath: string,
): Promise<string> {
  const fileStat = await stat(filePath);
  const fileSize = fileStat.size;

  if (fileSize <= UPLOAD_ALL_MAX_BYTES) {
    return uploadFileSmall(token, appToken, fileName, filePath, fileSize);
  }

  return uploadFileChunked(token, appToken, fileName, filePath, fileSize);
}

const TABLE_FIELDS: FieldDef[] = [
  { name: "视频ID", type: 1 },
  { name: "首投日期", type: 5 },
  { name: "视频文件", type: 17 },
  { name: "行业", type: 1 },
  { name: "触点", type: 1 },
  { name: "曝光量", type: 1 },
  { name: "完播率", type: 1 },
  { name: "5S完播率", type: 1 },
  { name: "CTR", type: 1 },
  { name: "CVR", type: 1 },
  { name: "PVR", type: 1 },
  { name: "视频脚本", type: 1 },
];

export async function uploadToBitable(
  records: MaterialRecord[],
  config: FeishuUploadConfig,
  downloadDir: string,
  logger: { log(msg: string): void } = console,
): Promise<FeishuUploadResult> {
  logger.log("[feishu] Authenticating...");
  const token = await getTenantAccessToken(config.appId, config.appSecret);

  const baseName = `云图素材采集 ${new Date().toISOString().slice(0, 10)}`;
  logger.log(`[feishu] Creating Bitable: ${baseName}`);
  const appToken = await createBase(token, baseName);
  const tableId = await getDefaultTableId(token, appToken);

  const firstFieldId = await getFirstFieldId(token, appToken, tableId);
  await renameField(token, appToken, tableId, firstFieldId, "视频标题");

  logger.log("[feishu] Creating fields...");
  for (const field of TABLE_FIELDS) {
    await createField(token, appToken, tableId, field);
  }

  logger.log("[feishu] Creating records...");
  const recordPayloads = records.map((r) => ({
    fields: buildRecordFields(r),
  }));

  const batchRes = await feishuPost(
    token,
    `/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
    { records: recordPayloads },
  );

  const batchInner = batchRes.data as Record<string, unknown>;
  const createdRecords = batchInner.records as Array<
    Record<string, unknown>
  >;
  const recordIds = createdRecords.map((r) => r.record_id as string);

  let attachmentCount = 0;
  const uploadedTokens = new Map<string, string>();

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (
      record.download.state !== "downloaded" ||
      !record.download.path
    ) {
      continue;
    }

    const videoPath = path.resolve(downloadDir, record.download.path);
    const fileName = path.basename(videoPath);

    try {
      await stat(videoPath);
    } catch {
      logger.log(`[feishu] Video not found: ${fileName}, skipping`);
      continue;
    }

    let fileToken = uploadedTokens.get(videoPath);
    if (!fileToken) {
      logger.log(`[feishu] Uploading video: ${fileName}...`);
      fileToken = await uploadBitableFile(
        token,
        appToken,
        fileName,
        videoPath,
      );
      uploadedTokens.set(videoPath, fileToken);
    }

    await feishuPut(
      token,
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordIds[i]}`,
      { fields: { 视频文件: [{ file_token: fileToken }] } },
    );

    attachmentCount++;
    logger.log(`[feishu] Attached ${fileName} to record ${i + 1}`);
  }

  const baseUrl = `https://guanghe.feishu.cn/base/${appToken}`;
  logger.log(`[feishu] Done! Bitable URL: ${baseUrl}`);

  return {
    baseUrl,
    appToken,
    tableId,
    recordCount: records.length,
    attachmentCount,
  };
}
