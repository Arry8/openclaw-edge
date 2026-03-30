import type { Bot } from "grammy";
import {
  computeBackoff,
  sleepWithAbort,
  type BackoffPolicy,
} from "openclaw/plugin-sdk/runtime-env";

export type TelegramSendChatActionLogger = (message: string) => void;

type ChatAction =
  | "typing"
  | "upload_photo"
  | "record_video"
  | "upload_video"
  | "record_voice"
  | "upload_voice"
  | "upload_document"
  | "find_location"
  | "record_video_note"
  | "upload_video_note"
  | "choose_sticker";

type TelegramSendChatActionParams = Parameters<Bot["api"]["sendChatAction"]>[2];

type SendChatActionFn = (
  chatId: number | string,
  action: ChatAction,
  threadParams?: TelegramSendChatActionParams,
) => Promise<true>;

export type TelegramSendChatActionHandler = {
  /**
   * Send a chat action with automatic 401 backoff and circuit breaker.
   * Safe to call from multiple concurrent message contexts.
   */
  sendChatAction: (
    chatId: number | string,
    action: ChatAction,
    threadParams?: TelegramSendChatActionParams,
  ) => Promise<void>;
  isSuspended: () => boolean;
  reset: () => void;
};

export type CreateTelegramSendChatActionHandlerParams = {
  sendChatActionFn: SendChatActionFn;
  logger: TelegramSendChatActionLogger;
  maxConsecutive401?: number;
  /** Max consecutive transient network errors before suspending (default: 5). */
  maxConsecutiveTransient?: number;
};

const BACKOFF_POLICY: BackoffPolicy = {
  initialMs: 1000,
  maxMs: 300_000, // 5 minutes
  factor: 2,
  jitter: 0.1,
};

function is401Error(error: unknown): boolean {
  if (!error) {
    return false;
  }
  const message = error instanceof Error ? error.message : JSON.stringify(error);
  return message.includes("401") || message.toLowerCase().includes("unauthorized");
}

function isTransientNetworkError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  const message = error instanceof Error ? error.message : JSON.stringify(error);
  const lower = message.toLowerCase();
  return (
    lower.includes("network request for") ||
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("etimedout") ||
    lower.includes("fetch failed") ||
    lower.includes("socket hang up")
  );
}

/**
 * Check if error is 429 (rate limit) or 529 (overloaded).
 * These should NOT trigger retries as they cause infinite loops (issue #56096).
 */
function is429Or529Error(error: unknown): boolean {
  if (!error) {
    return false;
  }
  const message = error instanceof Error ? error.message : JSON.stringify(error);
  const lowerMsg = message.toLowerCase();
  return (
    message.includes("429") ||
    message.includes("529") ||
    lowerMsg.includes("rate limit") ||
    lowerMsg.includes("overload") ||
    lowerMsg.includes("too many requests")
  );
}

/**
 * Creates a GLOBAL (per-account) handler for sendChatAction that tracks 401 errors
 * across all message contexts. This prevents the infinite loop that caused Telegram
 * to delete bots (issue #27092).
 *
 * When a 401 occurs, exponential backoff is applied (1s → 2s → 4s → ... → 5min).
 * After maxConsecutive401 failures (default 10), all sendChatAction calls are
 * suspended until reset() is called.
 */
export function createTelegramSendChatActionHandler({
  sendChatActionFn,
  logger,
  maxConsecutive401 = 10,
  maxConsecutiveTransient = 5,
}: CreateTelegramSendChatActionHandlerParams): TelegramSendChatActionHandler {
  let consecutive401Failures = 0;
  let consecutiveTransientFailures = 0;
  let suspended = false;

  const reset = () => {
    consecutive401Failures = 0;
    consecutiveTransientFailures = 0;
    suspended = false;
  };

  const sendChatAction = async (
    chatId: number | string,
    action: ChatAction,
    threadParams?: TelegramSendChatActionParams,
  ): Promise<void> => {
    if (suspended) {
      return;
    }

    const totalFailures = consecutive401Failures + consecutiveTransientFailures;
    if (totalFailures > 0) {
      const backoffMs = computeBackoff(BACKOFF_POLICY, totalFailures);
      logger(
        `sendChatAction backoff: waiting ${backoffMs}ms before retry ` +
          `(failure ${totalFailures}/${consecutive401Failures > 0 ? maxConsecutive401 : maxConsecutiveTransient})`,
      );
      await sleepWithAbort(backoffMs);
    }

    try {
      await sendChatActionFn(chatId, action, threadParams);
      // Success: reset all failure counters
      if (consecutive401Failures > 0) {
        logger(`sendChatAction recovered after ${consecutive401Failures} consecutive 401 failures`);
      }
      if (consecutiveTransientFailures > 0) {
        logger(
          `sendChatAction recovered after ${consecutiveTransientFailures} consecutive network failures`,
        );
      }
      consecutive401Failures = 0;
      consecutiveTransientFailures = 0;
    } catch (error) {
      // Issue #56096: Do not retry on 429/529 errors - they cause infinite loops
      if (is429Or529Error(error)) {
        logger(
          `sendChatAction failed with rate limit/overloaded error (429/529). ` +
            `Not retrying to prevent infinite loop.`,
        );
        // Re-throw without incrementing consecutive401Failures
        throw error;
      }

      if (is401Error(error)) {
        consecutive401Failures++;
        consecutiveTransientFailures = 0;

        if (consecutive401Failures >= maxConsecutive401) {
          suspended = true;
          logger(
            `CRITICAL: sendChatAction suspended after ${consecutive401Failures} consecutive 401 errors. ` +
              `Bot token is likely invalid. Telegram may DELETE the bot if requests continue. ` +
              `Replace the token and restart: openclaw channels restart telegram`,
          );
        } else {
          logger(
            `sendChatAction 401 error (${consecutive401Failures}/${maxConsecutive401}). ` +
              `Retrying with exponential backoff.`,
          );
        }
      } else if (isTransientNetworkError(error)) {
        consecutiveTransientFailures++;
        consecutive401Failures = 0;

        if (consecutiveTransientFailures >= maxConsecutiveTransient) {
          suspended = true;
          logger(
            `sendChatAction suspended after ${consecutiveTransientFailures} consecutive network failures. ` +
              `Will resume on reset.`,
          );
        } else if (consecutiveTransientFailures === 1) {
          // Log only on first transient failure to avoid spam
          logger(`sendChatAction transient network error, retrying with backoff`);
        }
        // Swallow transient errors — sendChatAction is best-effort
        return;
      }
      throw error;
    }
  };

  return {
    sendChatAction,
    isSuspended: () => suspended,
    reset,
  };
}
