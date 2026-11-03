import { createContext } from 'react';
import type { PletopayClient } from '@pletopay/js';

export type PletopayLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PletopayContextValue {
  /** The pletopay.js client once loaded; `null` before that and on the server. */
  client: PletopayClient | null;
  status: PletopayLoadStatus;
  error: Error | null;
  /** Resolves to the client, loading pletopay.js if needed (what the checkout hook uses). */
  getClient: () => Promise<PletopayClient | null>;
  /** Tries loading again after an error. */
  reload: () => void;
  publicKey: string;
  checkoutUrl: string | undefined;
}

export const PletopayContext = createContext<PletopayContextValue | null>(null);
