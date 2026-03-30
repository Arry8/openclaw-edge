import fs from "fs";
import os from "os";
import path from "path";
import type * as Lark from "@larksuiteoapi/node-sdk";
import type { OpenClawPluginApi } from "../runtime-api.js";
import { listEnabledFeishuAccounts } from "./accounts.js";
import { FeishuDriveSchema, type FeishuDriveParams } from "./drive-schema.js";
import { createFeishuToolClient, resolveAnyEnabledFeishuToolsConfig } from "./tool-account.js";
import {
  jsonToolResult,
  toolExecutionErrorResult,
  unknownToolActionResult,
} from "./tool-result.js";

// ============ Actions ============

type FeishuExplorerRootFolderMetaResponse = {
  code: number;
  msg?: string;
  data?: {
    token?: string;
  };
};

type FeishuDriveInternalClient = Lark.Client & {
  domain?: string;
  httpInstance: Pick<Lark.HttpInstance, "get">;
};

function getDriveInternalClient(client: Lark.Client): FeishuDriveInternalClient {
  return client as FeishuDriveInternalClient;
}

async function getRootFolderToken(client: Lark.Client): Promise<string> {
  // Use generic HTTP client to call the root folder meta API
  // as it's not directly exposed in the SDK
  const internalClient = getDriveInternalClient(client);
  const domain = internalClient.domain ?? "https://open.feishu.cn";
  const res = (await internalClient.httpInstance.get(
    `${domain}/open-apis/drive/explorer/v2/root_folder/meta`,
  )) as FeishuExplorerRootFolderMetaResponse;
  if (res.code !== 0) {
    throw new Error(res.msg ?? "Failed to get root folder");
  }
  const token = res.data?.token;
  if (!token) {
    throw new Error("Root folder token not found");
  }
  return token;
}

async function listFolder(client: Lark.Client, folderToken?: string) {
  // Filter out invalid folder_token values (empty, "0", etc.)
  const validFolderToken = folderToken && folderToken !== "0" ? folderToken : undefined;
  const res = await client.drive.file.list({
    params: validFolderToken ? { folder_token: validFolderToken } : {},
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return {
    files:
      res.data?.files?.map((f) => ({
        token: f.token,
        name: f.name,
        type: f.type,
        url: f.url,
        created_time: f.created_time,
        modified_time: f.modified_time,
        owner_id: f.owner_id,
      })) ?? [],
    next_page_token: res.data?.next_page_token,
  };
}

async function getFileInfo(client: Lark.Client, fileToken: string, type?: string) {
  // Use batch_query meta API to look up file metadata directly by token.
  // This works for any file the bot has access to, regardless of folder membership.
  const docType = (type || "file") as
    | "doc"
    | "docx"
    | "sheet"
    | "bitable"
    | "file"
    | "wiki"
    | "mindnote"
    | "folder"
    | "synced_block"
    | "slides";
  const res = await client.drive.meta.batchQuery({
    data: {
      request_docs: [{ doc_token: fileToken, doc_type: docType }],
      with_url: true,
    },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  const failed = res.data?.failed_list?.find(
    (f: { token?: string }) => f.token === fileToken,
  );
  if (failed) {
    throw new Error(
      `File not accessible (token: ${fileToken}, code: ${(failed as { code?: number }).code})`,
    );
  }

  const meta = res.data?.metas?.[0];
  if (!meta) {
    throw new Error(`File not found: ${fileToken}`);
  }

  return {
    token: meta.doc_token,
    name: meta.title,
    type: meta.doc_type,
    url: meta.url,
    owner_id: meta.owner_id,
    created_time: meta.create_time,
    modified_time: meta.latest_modify_time,
    latest_modify_user: meta.latest_modify_user,
  };
}

async function createFolder(client: Lark.Client, name: string, folderToken?: string) {
  // Feishu supports using folder_token="0" as the root folder.
  // We *try* to resolve the real root token (explorer API), but fall back to "0"
  // because some tenants/apps return 400 for that explorer endpoint.
  let effectiveToken = folderToken && folderToken !== "0" ? folderToken : "0";
  if (effectiveToken === "0") {
    try {
      effectiveToken = await getRootFolderToken(client);
    } catch {
      // ignore and keep "0"
    }
  }

  const res = await client.drive.file.createFolder({
    data: {
      name,
      folder_token: effectiveToken,
    },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return {
    token: res.data?.token,
    url: res.data?.url,
  };
}

async function moveFile(client: Lark.Client, fileToken: string, type: string, folderToken: string) {
  const res = await client.drive.file.move({
    path: { file_token: fileToken },
    data: {
      type: type as
        | "doc"
        | "docx"
        | "sheet"
        | "bitable"
        | "folder"
        | "file"
        | "mindnote"
        | "slides",
      folder_token: folderToken,
    },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return {
    success: true,
    task_id: res.data?.task_id,
  };
}

async function deleteFile(client: Lark.Client, fileToken: string, type: string) {
  const res = await client.drive.file.delete({
    path: { file_token: fileToken },
    params: {
      type: type as
        | "doc"
        | "docx"
        | "sheet"
        | "bitable"
        | "folder"
        | "file"
        | "mindnote"
        | "slides"
        | "shortcut",
    },
  });
  if (res.code !== 0) {
    throw new Error(res.msg);
  }

  return {
    success: true,
    task_id: res.data?.task_id,
  };
}

// ============ PDF Text Extraction ============

async function extractPdfText(filePath: string): Promise<string | undefined> {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(await fs.promises.readFile(filePath));
    const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs item type
      const text = content.items
        .filter((item: { str?: string }) => "str" in item)
        .map((item: { str?: string }) => item.str)
        .join(" ");
      if (text.trim()) pages.push(text);
    }
    return pages.length > 0 ? pages.join("\n\n") : undefined;
  } catch {
    return undefined;
  }
}

// ============ File Extension Detection ============

const MIME_EXTENSION_MAP: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "application/zip": ".zip",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};

function detectFileExtension(headers: Record<string, string | undefined>): string {
  try {
    const disposition = headers["content-disposition"] ?? "";
    const fnMatch = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
    if (fnMatch) {
      const ext = path.extname(decodeURIComponent(fnMatch[1]));
      if (ext) return ext;
    }

    const ct = headers["content-type"] ?? "";
    for (const [mime, extension] of Object.entries(MIME_EXTENSION_MAP)) {
      if (ct.includes(mime)) return extension;
    }
  } catch {
    // ignore header parsing errors
  }
  return "";
}

function detectFileName(headers: Record<string, string | undefined>): string {
  try {
    const disposition = headers["content-disposition"] ?? "";
    const fnMatch = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
    if (fnMatch) return decodeURIComponent(fnMatch[1]);
  } catch {
    // ignore
  }
  return "";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK response type varies
function resolveResponseHeaders(resAny: any): Record<string, string | undefined> {
  const headers = resAny.headers ?? {};
  // Handle both plain-object and Headers (fetch-style) APIs
  if (typeof headers.get === "function") {
    return {
      "content-disposition": headers.get("content-disposition") ?? undefined,
      "content-type": headers.get("content-type") ?? undefined,
    };
  }
  return headers;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK response type varies
async function writeResponseToFile(resAny: any, filePath: string): Promise<void> {
  if (typeof resAny.writeFile === "function") {
    await resAny.writeFile(filePath);
  } else if (typeof resAny.getReadableStream === "function") {
    const stream = resAny.getReadableStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    await fs.promises.writeFile(filePath, Buffer.concat(chunks));
  } else if (Buffer.isBuffer(resAny)) {
    await fs.promises.writeFile(filePath, resAny);
  } else if (resAny.data && Buffer.isBuffer(resAny.data)) {
    await fs.promises.writeFile(filePath, resAny.data);
  } else {
    throw new Error("Unexpected download response format");
  }
}

async function resolveDownloadsDir(): Promise<string> {
  const homeDir = os.homedir();
  const dlDir = path.join(homeDir, ".openclaw", "workspace", "downloads");
  await fs.promises.mkdir(dlDir, { recursive: true });
  return dlDir;
}

/** Try to extract readable text from a downloaded file. */
async function tryExtractText(
  filePath: string,
  ext: string,
  sizeBytes: number,
): Promise<string | undefined> {
  if (ext === ".pdf") {
    const text = await extractPdfText(filePath);
    if (text) return text;
  }

  // Try reading small files as UTF-8 text
  if (sizeBytes < 512 * 1024) {
    try {
      const buf = await fs.promises.readFile(filePath);
      const text = buf.toString("utf-8");
      const nonPrintable = text.replace(/[\x09\x0A\x0D\x20-\x7E\u00A0-\uFFFF]/g, "");
      if (nonPrintable.length / text.length < 0.05) {
        return text;
      }
    } catch {
      // not text, ignore
    }
  }
  return undefined;
}

// ============ Download Actions ============

async function downloadFile(client: Lark.Client, fileToken: string, fileType?: string) {
  // For native Lark docs (docx, doc, sheet, bitable), use export task API
  const nativeTypes = ["doc", "docx", "sheet", "bitable"];
  if (fileType && nativeTypes.includes(fileType)) {
    return await downloadViaExport(client, fileToken, fileType);
  }

  // For uploaded files (PDF, images, etc.), use direct download
  const res = await client.drive.file.download({
    path: { file_token: fileToken },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK response type
  const resAny = res as any;
  if (resAny.code !== undefined && resAny.code !== 0) {
    throw new Error(resAny.msg || `Download failed with code ${resAny.code}`);
  }

  const headers = resolveResponseHeaders(resAny);
  const ext = detectFileExtension(headers);
  const dlDir = await resolveDownloadsDir();
  const tmpPath = path.join(dlDir, `${fileToken}_${Date.now()}${ext}`);

  await writeResponseToFile(resAny, tmpPath);

  const stat = await fs.promises.stat(tmpPath);
  const textContent = await tryExtractText(tmpPath, ext, stat.size);

  return {
    file_path: tmpPath,
    size_bytes: stat.size,
    text_content: textContent,
    note: textContent
      ? "File content extracted and included as text_content."
      : `Binary file saved to ${tmpPath}.`,
  };
}

async function downloadViaExport(client: Lark.Client, fileToken: string, fileType: string) {
  const exportType = fileType as "doc" | "sheet" | "bitable" | "docx";
  const createRes = await client.drive.exportTask.create({
    data: {
      file_extension: "pdf",
      token: fileToken,
      type: exportType,
    },
  });
  if (createRes.code !== 0) {
    throw new Error(createRes.msg || `Export task creation failed with code ${createRes.code}`);
  }
  const ticket = createRes.data?.ticket;
  if (!ticket) {
    throw new Error("No export task ticket returned");
  }

  // Poll for export task completion (max ~30 seconds)
  let exportToken: string | undefined;
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const getRes = await client.drive.exportTask.get({
      params: { token: fileToken },
      path: { ticket },
    });
    if (getRes.code !== 0) {
      throw new Error(getRes.msg || `Export task query failed with code ${getRes.code}`);
    }
    const status = getRes.data?.result?.job_status;
    if (status === 0) {
      exportToken = getRes.data?.result?.file_token;
      break;
    } else if (status === 1 || status === 2) {
      continue;
    } else {
      throw new Error(
        `Export task failed with status ${status}: ${getRes.data?.result?.job_error_msg || "unknown error"}`,
      );
    }
  }
  if (!exportToken) {
    throw new Error("Export task timed out after 30 seconds");
  }

  const dlRes = await client.drive.exportTask.download({
    path: { file_token: exportToken },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK response type
  const dlAny = dlRes as any;
  const dlDir = await resolveDownloadsDir();
  const tmpPath = path.join(dlDir, `${fileToken}_export_${Date.now()}.pdf`);

  await writeResponseToFile(dlAny, tmpPath);

  const stat = await fs.promises.stat(tmpPath);
  return {
    file_path: tmpPath,
    size_bytes: stat.size,
    exported_as: "pdf",
    note: `Native ${fileType} exported as PDF and saved to ${tmpPath}. Use the read tool to view it.`,
  };
}

// ============ Message Attachment Download ============

async function downloadMessageAttachment(
  client: Lark.Client,
  messageId: string,
  fileKey: string,
  resourceType: "image" | "file" = "file",
) {
  const response = await client.im.messageResource.get({
    path: { message_id: messageId, file_key: fileKey },
    params: { type: resourceType },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK response type
  const resAny = response as any;
  if (resAny.code !== undefined && resAny.code !== 0) {
    throw new Error(resAny.msg || `Message resource download failed with code ${resAny.code}`);
  }

  const headers = resolveResponseHeaders(resAny);
  const ext = detectFileExtension(headers);
  const fileName = detectFileName(headers);
  const dlDir = await resolveDownloadsDir();
  const tmpPath = path.join(dlDir, `${fileKey}_${Date.now()}${ext}`);

  await writeResponseToFile(resAny, tmpPath);

  const stat = await fs.promises.stat(tmpPath);
  const textContent = await tryExtractText(tmpPath, ext, stat.size);

  return {
    file_path: tmpPath,
    file_name: fileName || undefined,
    size_bytes: stat.size,
    text_content: textContent,
    note: textContent
      ? "File content extracted and included as text_content."
      : `Binary file saved to ${tmpPath}.`,
  };
}

// ============ Tool Registration ============

export function registerFeishuDriveTools(api: OpenClawPluginApi) {
  if (!api.config) {
    api.logger.debug?.("feishu_drive: No config available, skipping drive tools");
    return;
  }

  const accounts = listEnabledFeishuAccounts(api.config);
  if (accounts.length === 0) {
    api.logger.debug?.("feishu_drive: No Feishu accounts configured, skipping drive tools");
    return;
  }

  const toolsCfg = resolveAnyEnabledFeishuToolsConfig(accounts);
  if (!toolsCfg.drive) {
    api.logger.debug?.("feishu_drive: drive tool disabled in config");
    return;
  }

  type FeishuDriveExecuteParams = FeishuDriveParams & { accountId?: string };

  api.registerTool(
    (ctx) => {
      const defaultAccountId = ctx.agentAccountId;
      return {
        name: "feishu_drive",
        label: "Feishu Drive",
        description:
          "Feishu cloud storage and message attachment operations. Actions: list, info, download, create_folder, move, delete, download_message_attachment. Use download_message_attachment with message_id + file_key for files shared in chat messages (file_v3_xxx tokens).",
        parameters: FeishuDriveSchema,
        async execute(_toolCallId, params) {
          const p = params as FeishuDriveExecuteParams;
          try {
            const client = createFeishuToolClient({
              api,
              executeParams: p,
              defaultAccountId,
            });
            switch (p.action) {
              case "list":
                return jsonToolResult(await listFolder(client, p.folder_token));
              case "info":
                return jsonToolResult(await getFileInfo(client, p.file_token, p.type));
              case "create_folder":
                return jsonToolResult(await createFolder(client, p.name, p.folder_token));
              case "move":
                return jsonToolResult(await moveFile(client, p.file_token, p.type, p.folder_token));
              case "delete":
                return jsonToolResult(await deleteFile(client, p.file_token, p.type));
              case "download":
                return jsonToolResult(await downloadFile(client, p.file_token, p.type));
              case "download_message_attachment":
                return jsonToolResult(
                  await downloadMessageAttachment(
                    client,
                    p.message_id,
                    p.file_key,
                    (p.resource_type as "image" | "file") ?? "file",
                  ),
                );
              default:
                return unknownToolActionResult((p as { action?: unknown }).action);
            }
          } catch (err) {
            return toolExecutionErrorResult(err);
          }
        },
      };
    },
    { name: "feishu_drive" },
  );

  api.logger.debug?.(`feishu_drive: Registered feishu_drive tool`);
}
