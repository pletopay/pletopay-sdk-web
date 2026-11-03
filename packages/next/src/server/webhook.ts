import {
  PletopaySignatureVerificationError,
  constructEvent,
  type Event,
  type EventOf,
  type EventType,
  type UnknownEvent,
} from '@pletopay/node';

/** One handler per event type, plus `'*'` for everything. Handlers run after verification, before the response. */
export type WebhookHandlers = {
  [T in EventType]?: (event: EventOf<T>) => unknown;
} & {
  '*'?: (event: Event | UnknownEvent) => unknown;
};

export interface WebhookOptions {
  /** `whsec_…`; defaults to `PLETOPAY_WEBHOOK_SECRET`. */
  secret?: string;
  /** Signature timestamp tolerance in seconds. Default 300. */
  tolerance?: number;
  /** Per-type handlers; the event type keys the map. */
  handlers?: WebhookHandlers;
  /** Called for every verified event (after the typed handler, if any). */
  onEvent?: (event: Event | UnknownEvent) => unknown;
  /**
   * What to answer when a handler throws. `retry` (default): 500, so Pletopay redelivers;
   * `ack`: 200, the error is only reported to `onError`.
   */
  onHandlerError?: 'retry' | 'ack';
  onError?: (error: unknown, event: Event | UnknownEvent | null) => void;
}

export interface WebhookOutcome {
  status: number;
  body: { received: true } | { error: string };
  event: Event | UnknownEvent | null;
}

function resolveSecret(secret: string | undefined): string {
  const value = secret ?? process.env.PLETOPAY_WEBHOOK_SECRET;
  if (!value)
    throw new Error(
      'No webhook secret: pass `secret` or set PLETOPAY_WEBHOOK_SECRET (whsec_… from the dashboard or webhookEndpoints.create)',
    );
  return value;
}

/** Verifies a raw delivery and runs the handlers. Framework-agnostic: the route adapters below wrap it. */
export async function handleWebhook(
  rawBody: string | Buffer,
  signature: string | string[] | null | undefined,
  options: WebhookOptions = {},
): Promise<WebhookOutcome> {
  let event: Event | UnknownEvent;
  try {
    event = constructEvent(
      rawBody,
      signature ?? undefined,
      resolveSecret(options.secret),
      options.tolerance !== undefined ? { tolerance: options.tolerance } : {},
    );
  } catch (error) {
    options.onError?.(error, null);
    if (error instanceof PletopaySignatureVerificationError)
      return { status: 400, body: { error: error.message }, event: null };
    throw error;
  }
  try {
    const handlers = options.handlers ?? {};
    const typed = (handlers as Record<string, ((e: Event | UnknownEvent) => unknown) | undefined>)[event.type];
    if (typed) await typed(event);
    if (handlers['*']) await handlers['*'](event);
    if (options.onEvent) await options.onEvent(event);
  } catch (error) {
    options.onError?.(error, event);
    if (options.onHandlerError === 'ack') return { status: 200, body: { received: true }, event };
    return { status: 500, body: { error: 'Webhook handler failed; Pletopay will retry the delivery' }, event };
  }
  return { status: 200, body: { received: true }, event };
}

/**
 * An App Router route handler that verifies `X-PletoPay-Signature` and runs your handlers.
 *
 * @example
 * // app/api/webhooks/pletopay/route.ts
 * export const POST = pletopayWebhookHandler({
 *   handlers: { 'payment.succeeded': async (event) => fulfil(event.data.object.reference) },
 * });
 */
export function pletopayWebhookHandler(options: WebhookOptions = {}): (request: Request) => Promise<Response> {
  return async (request) => {
    const outcome = await handleWebhook(await request.text(), request.headers.get('x-pletopay-signature'), options);
    return Response.json(outcome.body, { status: outcome.status });
  };
}
