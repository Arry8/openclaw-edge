import { normalizeOptionalLowercaseString } from "../shared/string-coerce.js";

export type ChatType = "direct" | "group" | "channel";

export function normalizeChatType(raw?: string): ChatType | undefined {
  const value = normalizeOptionalLowercaseString(raw);
  if (!value) {
    return undefined;
  }
  // Feishu reports 1:1 chats as "p2p".
  if (value === "direct" || value === "dm" || value === "p2p") {
    return "direct";
  }
  if (value === "group") {
    return "group";
  }
  if (value === "channel") {
    return "channel";
  }
  return undefined;
}
