import {
  Pletopay,
  PletopaySignatureVerificationError,
  constructEvent,
  type Event,
  type EventOf,
  type EventType,
  type UnknownEvent,
} from '@pletopay/node';
import { createError, defineEventHandler, getHeader, readRawBody, setResponseStatus, type H3Event } from 'h3';
import { useRuntimeConfig } from '#imports';

let cached: { key: string; client: Pletopay } | null = null;

/**
 * The server-side Pletopay client, built from `runtimeConfig.pletopay` (`NUXT_PLETOPAY_SECRET_KEY`,
 * `NUXT_PLETOPAY_API_URL`, `NUXT_PLETOPAY_WEBHOOK_SECRET`). Server routes and Nitro only.
 *
 * @example
 * // server/api/checkout-session.post.ts
 * export default defineEventHandler(async () => {
 *   const session = await usePletopayServer().checkout.sessions.create({ amount: 250000, currency: 'NGN', reference: 'ORDER-1' });
 *   return { token: session.token };
 * });
 */
export function usePletopayServer(event?: H3Event): Pletopay {
  const config = useRuntimeConfig(event).pletopay;
  const key = `${config.secretKey}|${config.apiUrl}|${config.webhookSecret}`;
  if (!cached || cached.key !== key) {
    cached = {
      key,
      client: new Pletopay({
        secretKey: config.secretKey || undefined,
        baseUrl: config.apiUrl || undefined,
        webhookSecret: config.webhookSecret || undefined,
      }),
    };
  }
  return cached.client;
}

/** One handler per event type, plus `'*'` for everything. */
export type PletopayWebhookHandlers = {
  [T in EventType]?: (event: EventOf<T>, h3Event: H3Event) => unknown;
} & {
  '*'?: (event: Event | UnknownEvent, h3Event: H3Event) => unknown;
};

export interface PletopayWebhookHandlerOptions {
  handlers?: PletopayWebhookHandlers;
  /** Called for every verified event (after the typed handler, if any). */
  onEvent?: (event: Event | UnknownEvent, h3Event: H3Event) => unknown;
  /** `whsec_…`; defaults to `runtimeConfig.pletopay.webhookSecret`. */
  secret?: string;
  tolerance?: number;
  /** `retry` (default): a throwing handler answers 500 so Pletopay redelivers; `ack`: answers 200 anyway. */
  onHandlerError?: 'retry' | 'ack';
  onError?: (error: unknown, event: Event | UnknownEvent | null) => void;
}

/**
 * A Nitro event handler that verifies `X-PletoPay-Signature` over the raw body and runs your handlers.
 *
 * @example
 * // server/api/webhooks/pletopay.post.ts
 * export default definePletopayWebhookHandler({
 *   handlers: { 'payment.succeeded': async (event) => fulfil(event.data.object.reference) },
 * });
 */
export function definePletopayWebhookHandler(options: PletopayWebhookHandlerOptions = {}) {
  return defineEventHandler(async (h3Event) => {
    const secret = options.secret || useRuntimeConfig(h3Event).pletopay.webhookSecret;
    if (!secret) {
      throw createError({
        statusCode: 500,
        statusMessage: 'No webhook secret: set NUXT_PLETOPAY_WEBHOOK_SECRET (or pletopay.webhookSecret)',
      });
    }
    const rawBody = (await readRawBody(h3Event, false)) ?? '';
    let event: Event | UnknownEvent;
    try {
      event = constructEvent(
        rawBody,
        getHeader(h3Event, 'x-pletopay-signature'),
        secret,
        options.tolerance !== undefined ? { tolerance: options.tolerance } : {},
      );
    } catch (error) {
      options.onError?.(error, null);
      if (error instanceof PletopaySignatureVerificationError) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid webhook signature', message: error.message });
      }
      throw error;
    }
    try {
      const handlers = options.handlers ?? {};
      const typed = (handlers as Record<string, ((e: Event | UnknownEvent, h: H3Event) => unknown) | undefined>)[
        event.type
      ];
      if (typed) await typed(event, h3Event);
      if (handlers['*']) await handlers['*'](event, h3Event);
      if (options.onEvent) await options.onEvent(event, h3Event);
    } catch (error) {
      options.onError?.(error, event);
      if (options.onHandlerError !== 'ack') {
        throw createError({
          statusCode: 500,
          statusMessage: 'Webhook handler failed; Pletopay will retry the delivery',
        });
      }
    }
    setResponseStatus(h3Event, 200);
    return { received: true as const };
  });
}
