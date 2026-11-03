import { handleWebhook, type WebhookOptions } from './webhook';

/** The parts of `NextApiRequest` the handler reads (typed structurally so `next` is not a hard dependency). */
export interface PagesRequestLike extends NodeJS.ReadableStream {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
}

/** The parts of `NextApiResponse` the handler uses. */
export interface PagesResponseLike {
  status(code: number): PagesResponseLike;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): unknown;
}

/** Put this in your API route so Next.js leaves the raw body alone: `export const config = pletopayPagesConfig;` */
export const pletopayPagesConfig = { api: { bodyParser: false } } as const;

async function readRawBody(req: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * A Pages Router API route (`pages/api/webhooks/pletopay.ts`) that verifies the delivery and runs your handlers.
 *
 * @example
 * export const config = pletopayPagesConfig;
 * export default pletopayPagesWebhookHandler({ handlers: { 'payment.succeeded': async (event) => … } });
 */
export function pletopayPagesWebhookHandler(
  options: WebhookOptions = {},
): (req: PagesRequestLike, res: PagesResponseLike) => Promise<void> {
  return async (req, res) => {
    if (req.method && req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const outcome = await handleWebhook(await readRawBody(req), req.headers['x-pletopay-signature'], options);
    res.status(outcome.status).json(outcome.body);
  };
}
