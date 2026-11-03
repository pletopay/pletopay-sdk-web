import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { PletopayCheckoutClient, type PletopayCheckoutClientOptions } from './client';

const PletopayContext = createContext<PletopayCheckoutClient | null>(null);

export interface PletopayProviderProps extends PletopayCheckoutClientOptions {
  children?: ReactNode;
}

/** Optional: shares one `PletopayCheckoutClient` (custom `apiUrl` / `checkoutUrl`) with every component below. */
export function PletopayProvider({ children, ...options }: PletopayProviderProps) {
  const client = useMemo(
    () => new PletopayCheckoutClient(options),
    [options.apiUrl, options.checkoutUrl, options.fetch, options.timeoutMs],
  );
  return <PletopayContext.Provider value={client}>{children}</PletopayContext.Provider>;
}

const fallback = new PletopayCheckoutClient();

/** The client from the nearest `PletopayProvider`, or a default one for the production origins. */
export function usePletopayClient(): PletopayCheckoutClient {
  return useContext(PletopayContext) ?? fallback;
}
