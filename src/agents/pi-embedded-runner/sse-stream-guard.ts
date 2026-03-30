import type { StreamFn } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("agent/sse-guard");

/**
 * Regex matching JSON.parse errors caused by empty or missing SSE data payloads.
 * Covers the standard V8 "Unexpected end of JSON input" and similar messages
 * from other engines (JSC/SpiderMonkey).
 *
 * Intentionally narrow: only matches known JSON-parse-empty-input patterns so
 * that unrelated errors (e.g. network failures whose message happens to contain
 * "JSON") are not silently swallowed.
 */
const EMPTY_JSON_PARSE_RE =
  /\bUnexpected end of JSON input\b|JSON Parse error.*(?:end of input|Unexpected EOF)\b/i;

/**
 * Wraps a StreamFn so that the returned async iterable silently skips SSE
 * events whose data payload triggers a JSON.parse failure (typically because
 * the `data:` line was empty or missing).
 *
 * Normal events are forwarded untouched. Non-JSON-parse errors are re-thrown
 * so they surface as usual.
 *
 * This is a defensive guard against flaky SSE streams that occasionally emit
 * keepalive or malformed events with no parseable body (#52679).
 */
export function createSseEmptyDataGuardWrapper(baseStreamFn: StreamFn | undefined): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;

  return (model, context, options) => {
    const streamOrPromise = underlying(model, context, options);

    // StreamFn may return a stream directly or a Promise<stream>.
    // We handle both cases uniformly by wrapping in a helper that
    // resolves the stream first, then patches the async iterator.
    function wrapStream(
      stream: Awaited<ReturnType<typeof streamSimple>>,
    ): Awaited<ReturnType<typeof streamSimple>> {
      const originalIterator = stream[Symbol.asyncIterator].bind(stream);

      const guardedIterator = (): AsyncIterator<unknown> => {
        const inner = originalIterator();
        return {
          async next(): Promise<IteratorResult<unknown>> {
            // Loop until we get a valid event or the stream ends.
            // This handles consecutive empty events gracefully.
            for (;;) {
              try {
                return await inner.next();
              } catch (error) {
                if (isEmptyJsonParseError(error)) {
                  log.debug(
                    `skipped empty SSE data event (JSON parse failure): ${error instanceof Error ? error.message : String(error)}`,
                  );
                  // Continue to the next event instead of aborting.
                  continue;
                }
                throw error;
              }
            }
          },
          return: inner.return?.bind(inner),
          throw: inner.throw?.bind(inner),
        } as AsyncIterator<unknown>;
      };

      // Return a proxy-like object that overrides only the async iterator.
      return Object.assign(Object.create(Object.getPrototypeOf(stream) as object), stream, {
        [Symbol.asyncIterator]: guardedIterator,
      });
    }

    // Preserve the sync/async return contract of the underlying StreamFn.
    if (streamOrPromise instanceof Promise) {
      return streamOrPromise.then(wrapStream);
    }
    return wrapStream(streamOrPromise);
  };
}

function isEmptyJsonParseError(error: unknown): boolean {
  // JSON.parse always throws SyntaxError — checking only for that avoids
  // accidentally swallowing unrelated Error subclasses.
  if (!(error instanceof SyntaxError)) {
    return false;
  }
  return EMPTY_JSON_PARSE_RE.test(error.message);
}
