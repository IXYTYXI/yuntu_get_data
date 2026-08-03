import { writeFileSync, unlinkSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import type { MaterialRecord } from "./domain.js";

const FEISHU_BASE = "https://open.feishu.cn/open-apis";
const UPLOAD_ALL_MAX_BYTES = 20 * 1024 * 1024;

export interface FeishuUploadConfig {
  appId: string;
  appSecret?: string;
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

interface LarkResponse {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code?: number; message?: string };
  code?: number;
  msg?: string;
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

async function tokenFetch(
  token: string,
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${FEISHU_BASE}${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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

async function tokenUploadFile(
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

async function tokenUploadChunked(
  token: string,
  appToken: string,
  fileName: string,
  filePath: string,
  fileSize: number,
): Promise<string> {
  const prepData = await tokenFetch(
    token,
    "POST",
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

  const finData = await tokenFetch(token, "POST", "/drive/v1/medias/upload_finish", {
    upload_id: uploadId,
    block_num: blockNum,
  });

  const finInner = finData.data as Record<string, unknown>;
  return finInner.file_token as string;
}

function larkApi(
  method: string,
  apiPath: string,
  data?: unknown,
  filePath?: string,
  cwd?: string,
): Record<string, unknown> {
  const args = ["api", method, apiPath, "--as", "bot", "--format", "json"];
  if (data !== undefined) {
    args.push("--data", JSON.stringify(data));
  }
  if (filePath !== undefined) {
    args.push("--file", `file=${filePath}`);
  }

  const raw = execSync(
    ["lark-cli", ...args].map(shellEscape).join(" "),
    { encoding: "utf8", timeout: 120_000, cwd, stdio: ["pipe", "pipe", "pipe"] },
  );

  const parsed = JSON.parse(raw) as LarkResponse;

  if (!parsed.ok) {
    const code = parsed.error?.code ?? 0;
    const msg = parsed.error?.message ?? "unknown error";
    throw new Error(`lark-cli ${method} ${apiPath}: code=${code} ${msg}`);
  }

  return parsed.data ?? {};
}

function shellEscape(s: string): string {
  if (process.platform === "win32") {
    if (!/["\s&|<>^%!]/.test(s)) return s;
    return '"' + s.replace(/"/g, '\\"') + '"';
  }
  if (!/[^A-Za-z0-9_./:=,{}\[\]-]/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

async function createBase(name: string): Promise<string> {
  const data = larkApi("POST", "bitable/v1/apps", {
    name,
    folder_token: "",
  });

  const app = data.app as Record<string, unknown>;
  return app.app_token as string;
}

async function getDefaultTableId(appToken: string): Promise<string> {
  const data = larkApi(
    "GET",
    `bitable/v1/apps/${appToken}/tables`,
  );

  const items = data.items as Array<Record<string, unknown>>;
  return items[0].table_id as string;
}

async function createField(
  appToken: string,
  tableId: string,
  fieldDef: FieldDef,
): Promise<void> {
  larkApi(
    "POST",
    `bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
    { field_name: fieldDef.name, type: fieldDef.type },
  );
}

async function renameField(
  appToken: string,
  tableId: string,
  fieldId: string,
  newName: string,
): Promise<void> {
  try {
    larkApi(
      "PUT",
      `bitable/v1/apps/${appToken}/tables/${tableId}/fields/${fieldId}`,
      { field_name: newName },
    );
  } catch {
    // ignore rename failures
  }
}

async function getFirstFieldId(
  appToken: string,
  tableId: string,
): Promise<string> {
  const data = larkApi(
    "GET",
    `bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
  );

  const items = data.items as Array<Record<string, unknown>>;
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
  appToken: string,
  fileName: string,
  filePath: string,
  fileSize: number,
): Promise<string> {
  const cwd = path.dirname(filePath);
  const localName = path.basename(filePath);

  const data = larkApi(
    "POST",
    "drive/v1/medias/upload_all",
    {
      file_name: fileName,
      parent_type: "bitable_file",
      parent_node: appToken,
      size: fileSize,
    },
    localName,
    cwd,
  );

  return data.file_token as string;
}

async function uploadFileChunked(
  appToken: string,
  fileName: string,
  filePath: string,
  fileSize: number,
): Promise<string> {
  const prepData = larkApi("POST", "drive/v1/medias/upload_prepare", {
    file_name: fileName,
    parent_type: "bitable_file",
    parent_node: appToken,
    size: fileSize,
  });

  const uploadId = prepData.upload_id as string;
  const blockSize = prepData.block_size as number;
  const blockNum = prepData.block_num as number;

  const { readFileSync } = await import("node:fs");
  const fileContent = readFileSync(filePath);
  const cwd = path.dirname(filePath);

  for (let seq = 0; seq < blockNum; seq++) {
    const start = seq * blockSize;
    const end = Math.min(start + blockSize, fileSize);
    const chunk = fileContent.subarray(start, end);

    const chunkFile = `_upload_chunk_${seq}.bin`;
    const chunkPath = path.join(cwd, chunkFile);
    writeFileSync(chunkPath, chunk);

    try {
      larkApi(
        "POST",
        "drive/v1/medias/upload_part",
        { upload_id: uploadId, seq, size: chunk.length },
        chunkFile,
        cwd,
      );
    } finally {
      try { unlinkSync(chunkPath); } catch {}
    }
  }

  const finData = larkApi("POST", "drive/v1/medias/upload_finish", {
    upload_id: uploadId,
    block_num: blockNum,
  });

  return finData.file_token as string;
}

async function uploadBitableFile(
  appToken: string,
  fileName: string,
  filePath: string,
): Promise<string> {
  const fileStat = await stat(filePath);
  const fileSize = fileStat.size;

  if (fileSize <= UPLOAD_ALL_MAX_BYTES) {
    return uploadFileSmall(appToken, fileName, filePath, fileSize);
  }

  return uploadFileChunked(appToken, fileName, filePath, fileSize);
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

async function uploadBitableFileWithToken(
  token: string,
  appToken: string,
  fileName: string,
  filePath: string,
): Promise<string> {
  const fileStat = await stat(filePath);
  const fileSize = fileStat.size;

  if (fileSize <= UPLOAD_ALL_MAX_BYTES) {
    return tokenUploadFile(token, appToken, fileName, filePath, fileSize);
  }

  return tokenUploadChunked(token, appToken, fileName, filePath, fileSize);
}

export async function uploadToBitable(
  records: MaterialRecord[],
  config: FeishuUploadConfig,
  downloadDir: string,
  logger: { log(msg: string): void } = console,
): Promise<FeishuUploadResult> {
  const useToken = !!config.appSecret;
  let token: string | undefined;

  if (useToken) {
    logger.log("[feishu] Authenticating with app credentials...");
    token = await getTenantAccessToken(config.appId, config.appSecret!);
  } else {
    logger.log("[feishu] Using lark-cli for authentication...");
  }

  const baseName = `云图素材采集 ${new Date().toISOString().slice(0, 10)}`;
  logger.log(`[feishu] Creating Bitable: ${baseName}`);

  let appToken: string;
  let tableId: string;

  if (useToken) {
    const baseData = await tokenFetch(token!, "POST", "/bitable/v1/apps", {
      name: baseName,
      folder_token: "",
    });
    const baseInner = baseData.data as Record<string, unknown>;
    appToken = (baseInner.app as Record<string, unknown>).app_token as string;

    const tablesRes = await tokenFetch(
      token!,
      "GET",
      `/bitable/v1/apps/${appToken}/tables`,
    );
    const tablesInner = tablesRes.data as Record<string, unknown>;
    const tables = tablesInner.items as Array<Record<string, unknown>>;
    tableId = tables[0].table_id as string;

    const fieldsRes = await tokenFetch(
      token!,
      "GET",
      `/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
    );
    const fieldsInner = fieldsRes.data as Record<string, unknown>;
    const fields = fieldsInner.items as Array<Record<string, unknown>>;
    const firstFieldId = fields[0].field_id as string;

    await tokenFetch(
      token!,
      "PUT",
      `/bitable/v1/apps/${appToken}/tables/${tableId}/fields/${firstFieldId}`,
      { field_name: "视频标题" },
    ).catch(() => undefined);
  } else {
    appToken = await createBase(baseName);
    tableId = await getDefaultTableId(appToken);
    const firstFieldId = await getFirstFieldId(appToken, tableId);
    await renameField(appToken, tableId, firstFieldId, "视频标题");
  }

  logger.log("[feishu] Creating fields...");
  for (const field of TABLE_FIELDS) {
    if (useToken) {
      await tokenFetch(
        token!,
        "POST",
        `/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
        { field_name: field.name, type: field.type },
      );
    } else {
      await createField(appToken, tableId, field);
    }
  }

  logger.log("[feishu] Creating records...");
  const recordPayloads = records.map((r) => ({
    fields: buildRecordFields(r),
  }));

  let recordIds: string[];
  if (useToken) {
    const batchRes = await tokenFetch(
      token!,
      "POST",
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
      { records: recordPayloads },
    );
    const batchInner = batchRes.data as Record<string, unknown>;
    const created = batchInner.records as Array<Record<string, unknown>>;
    recordIds = created.map((r) => r.record_id as string);
  } else {
    const batchData = larkApi(
      "POST",
      `bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
      { records: recordPayloads },
    );
    const created = batchData.records as Array<Record<string, unknown>>;
    recordIds = created.map((r) => r.record_id as string);
  }

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
      fileToken = useToken
        ? await uploadBitableFileWithToken(token!, appToken, fileName, videoPath)
        : await uploadBitableFile(appToken, fileName, videoPath);
      uploadedTokens.set(videoPath, fileToken);
    }

    if (useToken) {
      await tokenFetch(
        token!,
        "PUT",
        `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordIds[i]}`,
        { fields: { 视频文件: [{ file_token: fileToken }] } },
      );
    } else {
      larkApi(
        "PUT",
        `bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordIds[i]}`,
        { fields: { 视频文件: [{ file_token: fileToken }] } },
      );
    }

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
