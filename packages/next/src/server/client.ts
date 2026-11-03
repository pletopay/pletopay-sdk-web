import { Pletopay, type PletopayOptions } from '@pletopay/node';

let cached: { key: string; client: Pletopay } | null = null;

/**
 * The server-side Pletopay client, built once per process from `PLETOPAY_SECRET_KEY` (and
 * `PLETOPAY_API_URL`, `PLETOPAY_WEBHOOK_SECRET`) or the options you pass. Only ever import it from
 * server code: route handlers, server actions, server components, `getServerSideProps`.
 *
 * @example
 * // app/api/checkout-session/route.ts
 * export async function POST() {
 *   const session = await getPletopay().checkout.sessions.create({ amount: 250000, currency: 'NGN', reference: 'ORDER-1' });
 *   return Response.json({ token: session.token });
 * }
 */
export function getPletopay(options: PletopayOptions = {}): Pletopay {
  const key = JSON.stringify([
    options.secretKey ?? process.env.PLETOPAY_SECRET_KEY,
    options.baseUrl ?? process.env.PLETOPAY_API_URL,
    options.webhookSecret ?? process.env.PLETOPAY_WEBHOOK_SECRET,
  ]);
  if (!cached || cached.key !== key) cached = { key, client: new Pletopay(options) };
  return cached.client;
}

/** Forgets the cached client (tests, key rotation at runtime). */
export function resetPletopay(): void {
  cached = null;
}
