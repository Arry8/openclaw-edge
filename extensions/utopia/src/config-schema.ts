import { MarkdownConfigSchema, buildChannelConfigSchema } from "openclaw/plugin-sdk";
import { z } from "zod";

const allowFromEntry = z.union([z.string(), z.number()]);

/**
 * Zod schema for channels.utopia.* configuration
 */
export const UtopiaConfigSchema = z.object({
  /** Account name (optional display name) */
  name: z.string().optional(),

  /** Optional default account id for routing/account selection */
  defaultAccount: z.string().optional(),

  /** Whether this channel is enabled */
  enabled: z.boolean().optional(),

  /** Markdown formatting overrides (tables) */
  markdown: MarkdownConfigSchema,

  /** Utopia API host (default: 127.0.0.1) */
  host: z.string().optional(),

  /** Utopia API port (default: 22659) */
  port: z.number().optional(),

  /** Utopia API token */
  apiToken: z.string().optional(),

  /** WebSocket port for receiving notifications */
  wsPort: z.number().optional(),

  /** Use HTTPS/WSS instead of HTTP/WS */
  useSsl: z.boolean().optional(),

  /** DM access policy: pairing, allowlist, open, or disabled */
  dmPolicy: z.enum(["pairing", "allowlist", "open", "disabled"]).optional(),

  /** Allowed sender pubkeys */
  allowFrom: z.array(allowFromEntry).optional(),
});

export type UtopiaConfig = z.infer<typeof UtopiaConfigSchema>;

/**
 * JSON Schema for Control UI (converted from Zod)
 */
export const utopiaChannelConfigSchema = buildChannelConfigSchema(UtopiaConfigSchema);
