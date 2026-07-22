import {
  GraphwarAgentClientError,
  requireMatchingGraphwarAgentShotCommand,
  type GraphwarAgentClient,
  type GraphwarAgentShotCommand,
  type GraphwarAgentShotCommandIdentity,
  type GraphwarAgentShotRequest,
} from "./client";

/** Timing and lifecycle controls shared by command-resource polling loops. */
export interface GraphwarAgentShotCommandPollingOptions {
  onCommand?: (command: GraphwarAgentShotCommand) => void;
  pollIntervalMs: number;
  readTimeoutMs: number;
  signal?: AbortSignal;
}

/** Adds the POST result boundary used before switching to command-resource polling. */
export interface GraphwarAgentShotCommandOptions extends GraphwarAgentShotCommandPollingOptions {
  postResultTimeoutMs: number;
}

/** Recovers a non-terminal command discovered through the current `/state` summary. */
export async function resolveExistingGraphwarAgentShotCommand(
  client: GraphwarAgentClient,
  identity: GraphwarAgentShotCommandIdentity,
  options: GraphwarAgentShotCommandPollingOptions,
): Promise<GraphwarAgentShotCommand> {
  while (true) {
    throwIfAborted(options.signal);
    try {
      const command = requireMatchingGraphwarAgentShotCommand(
        await readShotCommandWithTimeout(client, identity.requestId, options),
        identity,
      );
      options.onCommand?.(command);
      if (isTerminalGraphwarAgentShotCommand(command)) {
        return command;
      }
    } catch (error) {
      if (!(error instanceof GraphwarAgentClientError) || error.kind !== "transient") {
        throw error;
      }
    }
    await waitForNextRead(options.pollIntervalMs, options.signal);
  }
}

/**
 * Resolves one command without ever changing its request ID.
 *
 * A lost POST response is recovered by querying the command first. A missing record permits exactly one identical
 * replay; every later attempt is a read.
 */
export async function resolveGraphwarAgentShotCommand(
  client: GraphwarAgentClient,
  request: GraphwarAgentShotRequest,
  options: GraphwarAgentShotCommandOptions,
): Promise<GraphwarAgentShotCommand> {
  let shouldReplay = true;
  let shouldSubmit = true;

  while (true) {
    throwIfAborted(options.signal);
    if (shouldSubmit) {
      shouldSubmit = false;
      const command = await waitForSubmission(client, request, options.postResultTimeoutMs, options.signal);
      if (command) {
        options.onCommand?.(command);
        if (isTerminalGraphwarAgentShotCommand(command)) {
          return command;
        }
        await waitForNextRead(options.pollIntervalMs, options.signal);
      }
    }

    try {
      const command = requireMatchingGraphwarAgentShotCommand(
        await readShotCommandWithTimeout(client, request.requestId, options),
        request,
      );
      options.onCommand?.(command);
      if (isTerminalGraphwarAgentShotCommand(command)) {
        return command;
      }
      await waitForNextRead(options.pollIntervalMs, options.signal);
    } catch (error) {
      if (isMissingGraphwarAgentShotCommand(error)) {
        if (shouldReplay) {
          shouldReplay = false;
          shouldSubmit = true;
        } else {
          await waitForNextRead(options.pollIntervalMs, options.signal);
        }
        continue;
      }
      if (!(error instanceof GraphwarAgentClientError) || error.kind !== "transient") {
        throw error;
      }
      await waitForNextRead(options.pollIntervalMs, options.signal);
    }
  }
}

/** Bounds each recovery GET while preserving the caller's longer lifecycle cancellation. */
async function readShotCommandWithTimeout(
  client: GraphwarAgentClient,
  requestId: string,
  options: GraphwarAgentShotCommandPollingOptions,
) {
  const controller = new AbortController();
  const abortForLifecycle = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    abortForLifecycle();
  } else {
    options.signal?.addEventListener("abort", abortForLifecycle, { once: true });
  }
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Graphwar Agent command query timed out", "TimeoutError")),
    options.readTimeoutMs,
  );
  try {
    return await client.readShotCommand(requestId, controller.signal);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortForLifecycle);
  }
}

/** Reports whether a public command has reached a final result. */
export function isTerminalGraphwarAgentShotCommand(command: GraphwarAgentShotCommand) {
  return command.status === "submitted" || command.status === "failed" || command.status === "unknown";
}

/** Bounds the POST transport wait; aborting it cannot roll back the server-side command. */
async function waitForSubmission(
  client: GraphwarAgentClient,
  request: GraphwarAgentShotRequest,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectForAbort: (() => void) | undefined;
  try {
    const boundary = new Promise<undefined>((resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort(new DOMException("Graphwar Agent shot submission timed out", "TimeoutError"));
        resolve(undefined);
      }, timeoutMs);
      if (signal) {
        rejectForAbort = () => {
          const reason = signal.reason ?? new DOMException("Aborted", "AbortError");
          controller.abort(reason);
          reject(reason);
        };
        if (signal.aborted) {
          rejectForAbort();
        } else {
          signal.addEventListener("abort", rejectForAbort, { once: true });
        }
      }
    });
    return await Promise.race([client.submitShot(request, controller.signal), boundary]);
  } catch (error) {
    if (error instanceof GraphwarAgentClientError && error.kind === "transient" && error.status === undefined) {
      return undefined;
    }
    throw error;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
    if (signal && rejectForAbort) {
      signal.removeEventListener("abort", rejectForAbort);
    }
  }
}

/** Delays the next GET without creating a recursive promise chain. */
async function waitForNextRead(timeoutMs: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", rejectForAbort);
      resolve();
    }, timeoutMs);
    const rejectForAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", rejectForAbort, { once: true });
  });
}

/** Throws synchronously before starting work for an already-stopped lifecycle. */
function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
}

/** Distinguishes command eviction/missing state from every other conflict. */
function isMissingGraphwarAgentShotCommand(error: unknown) {
  return error instanceof GraphwarAgentClientError && error.status === 404 && error.code === "shot-command-not-found";
}
