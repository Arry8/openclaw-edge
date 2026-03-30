import { Type, type Static } from "@sinclair/typebox";

const FileType = Type.Union([
  Type.Literal("doc"),
  Type.Literal("docx"),
  Type.Literal("sheet"),
  Type.Literal("bitable"),
  Type.Literal("folder"),
  Type.Literal("file"),
  Type.Literal("mindnote"),
  Type.Literal("shortcut"),
]);

export const FeishuDriveSchema = Type.Union([
  Type.Object({
    action: Type.Literal("list"),
    folder_token: Type.Optional(
      Type.String({ description: "Folder token (optional, omit for root directory)" }),
    ),
  }),
  Type.Object({
    action: Type.Literal("info"),
    file_token: Type.String({ description: "File or folder token" }),
    type: FileType,
  }),
  Type.Object({
    action: Type.Literal("create_folder"),
    name: Type.String({ description: "Folder name" }),
    folder_token: Type.Optional(
      Type.String({ description: "Parent folder token (optional, omit for root)" }),
    ),
  }),
  Type.Object({
    action: Type.Literal("move"),
    file_token: Type.String({ description: "File token to move" }),
    type: FileType,
    folder_token: Type.String({ description: "Target folder token" }),
  }),
  Type.Object({
    action: Type.Literal("delete"),
    file_token: Type.String({ description: "File token to delete" }),
    type: FileType,
  }),
  Type.Object({
    action: Type.Literal("download"),
    file_token: Type.String({ description: "File token to download" }),
    type: Type.Optional(FileType),
  }),
  Type.Object({
    action: Type.Literal("download_message_attachment"),
    message_id: Type.String({
      description: "Message ID (om_xxx) that contains the attachment",
    }),
    file_key: Type.String({ description: "File key from message content (file_v3_xxx)" }),
    resource_type: Type.Optional(
      Type.String({ description: "Resource type: 'image' or 'file' (default: 'file')" }),
    ),
  }),
]);

export type FeishuDriveParams = Static<typeof FeishuDriveSchema>;
