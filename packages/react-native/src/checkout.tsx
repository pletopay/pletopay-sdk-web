import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewNavigation, type WebViewProps } from 'react-native-webview';
import type { PletopayCheckoutClient } from './client';
import { PletopayCheckoutError } from './errors';
import { usePletopayClient } from './provider';
import type { CheckoutSuccess, PublicCheckoutSession } from './types';

export interface PletopayCheckoutProps {
  /** The session token (or hosted URL) your server created with its secret key. */
  session: string;
  /** Pletopay saw the transfer (`status: complete`). Confirm server-side before fulfilling, then navigate away. */
  onSuccess?: (result: CheckoutSuccess) => void;
  /** The customer chose to go back (`cancel_url`). Leaving never cancels a transfer already sent. */
  onCancel?: () => void;
  /** The session expired before completing. */
  onExpired?: (session: PublicCheckoutSession) => void;
  /** The page could not load, or the session could not be read. */
  onError?: (error: PletopayCheckoutError) => void;
  /** Every session state read from the checkout API: while polling, and when a redirect is confirmed (e.g. to show "transfer received, confirming…"). */
  onSessionChange?: (session: PublicCheckoutSession) => void;
  /** Poll the session API so completion is detected even without a `success_url`. Default true. */
  poll?: boolean;
  /** Polling interval, default 4000 ms (never below 2000). */
  pollIntervalMs?: number;
  style?: StyleProp<ViewStyle>;
  /** Shown until the page has loaded. Default: a centred spinner. */
  renderLoading?: () => React.ReactElement;
  /** Extra props for the underlying `WebView` (e.g. `userAgent`, `injectedJavaScript`). */
  webViewProps?: Omit<WebViewProps, 'source' | 'onShouldStartLoadWithRequest' | 'onError' | 'onHttpError'>;
  client?: PletopayCheckoutClient;
}

function sameUrl(a: string, b: string | null | undefined): boolean {
  if (!b) return false;
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, '');
  } catch {
    return a === b;
  }
}

/** An http(s) URL that is not on the checkout origin: a redirect to the merchant, or a link the page opens. */
function leavesCheckout(url: string, checkoutOrigin: string): boolean {
  try {
    const target = new URL(url);
    return (target.protocol === 'https:' || target.protocol === 'http:') && target.origin !== checkoutOrigin;
  } catch {
    return false;
  }
}

function asCheckoutError(error: unknown): PletopayCheckoutError {
  return error instanceof PletopayCheckoutError ? error : new PletopayCheckoutError('unknown', String(error));
}

/**
 * The hosted checkout page in a WebView. Completion is detected two ways: the page's redirect to your
 * `success_url` is intercepted (never navigated to) and confirmed with the checkout API, and the session
 * is polled through the checkout API. Whichever happens first fires `onSuccess` once.
 *
 * @example
 * <PletopayCheckout session={token} onSuccess={({ session }) => navigation.replace('Thanks', { session })} onCancel={() => navigation.goBack()} />
 */
export function PletopayCheckout({
  session,
  onSuccess,
  onCancel,
  onExpired,
  onError,
  onSessionChange,
  poll = true,
  pollIntervalMs,
  style,
  renderLoading,
  webViewProps,
  client: clientProp,
}: PletopayCheckoutProps) {
  const shared = usePletopayClient();
  const client = clientProp ?? shared;
  const [loaded, setLoaded] = useState(false);
  // The last session state read from the API, whichever request read it.
  const details = useRef<PublicCheckoutSession | null>(null);
  const done = useRef<'success' | 'cancel' | 'expired' | null>(null);
  // Bumped whenever tracking restarts or stops, so a late answer for an earlier session is dropped.
  const generation = useRef(0);
  const verifying = useRef(new Set<string>());
  const callbacks = useRef({ onSuccess, onCancel, onExpired, onError, onSessionChange });
  callbacks.current = { onSuccess, onCancel, onExpired, onError, onSessionChange };

  const resolved = useMemo(() => {
    try {
      return { token: client.resolveToken(session), url: client.hostedUrl(session), error: null };
    } catch (error) {
      return {
        token: null,
        url: null,
        error:
          error instanceof PletopayCheckoutError ? error : new PletopayCheckoutError('invalid_session', String(error)),
      };
    }
  }, [client, session]);

  const finish = useCallback(
    (outcome: 'success' | 'cancel' | 'expired', current: PublicCheckoutSession | null) => {
      if (done.current || !resolved.token) return;
      done.current = outcome;
      if (outcome === 'success') callbacks.current.onSuccess?.({ session: resolved.token, status: 'complete' });
      else if (outcome === 'cancel') callbacks.current.onCancel?.();
      else if (current) callbacks.current.onExpired?.(current);
    },
    [resolved.token],
  );

  useEffect(() => {
    done.current = null;
    details.current = null;
    verifying.current.clear();
    generation.current += 1;
    setLoaded(false);
    if (resolved.error) {
      callbacks.current.onError?.(resolved.error);
      return;
    }
    if (!resolved.token) return;
    const token = resolved.token;
    const controller = new AbortController();
    void (async () => {
      try {
        const first = await client.getSession(token);
        if (controller.signal.aborted) return;
        details.current = first;
        callbacks.current.onSessionChange?.(first);
        if (first.status !== 'open') {
          finish(first.status === 'complete' ? 'success' : 'expired', first);
          return;
        }
        if (!poll) return;
        const last = await client.pollSession(token, {
          intervalMs: pollIntervalMs,
          signal: controller.signal,
          initial: first,
          onUpdate: (next) => {
            details.current = next;
            callbacks.current.onSessionChange?.(next);
          },
        });
        if (controller.signal.aborted) return;
        if (last.status === 'complete') finish('success', last);
        else if (last.status === 'expired') finish('expired', last);
      } catch (error) {
        if (controller.signal.aborted) return;
        callbacks.current.onError?.(asCheckoutError(error));
      }
    })();
    return () => {
      generation.current += 1;
      controller.abort();
    };
  }, [client, resolved.token, resolved.error, poll, pollIntervalMs, finish]);

  /** Decides a navigation from a session state: true lets the WebView load it. */
  const route = useCallback(
    (url: string, current: PublicCheckoutSession | null): boolean => {
      // A URL match alone is never success: the API only reveals `success_url` once the session is complete.
      if (current?.status === 'complete' && sameUrl(url, current.success_url)) {
        finish('success', current);
        return false;
      }
      if (current && sameUrl(url, current.cancel_url)) {
        finish('cancel', current);
        return false;
      }
      // Only the checkout origin renders inside this view. Anything else the page links to (the
      // merchant's support URL or email, or a page a compromised checkout could redirect to) opens
      // in the system browser or mail app, never in the WebView that carries the merchant's name.
      let target: URL;
      try {
        target = new URL(url);
      } catch {
        return false;
      }
      if (target.origin === client.checkoutUrl) return true;
      if (target.protocol === 'https:' || target.protocol === 'http:' || target.protocol === 'mailto:') {
        Linking.openURL(url).catch(() => undefined);
      }
      return false;
    },
    [client, finish],
  );

  /**
   * The page is leaving the checkout origin and no completed session is known here yet (polling is
   * off, or its last answer predates the completion). The navigation is already blocked; ask the
   * API once whether the session completed, then treat the URL accordingly.
   */
  const verifyRedirect = useCallback(
    async (url: string): Promise<void> => {
      if (!resolved.token || verifying.current.has(url)) return;
      const run = generation.current;
      verifying.current.add(url);
      try {
        const fresh = await client.getSession(resolved.token);
        if (run !== generation.current) return;
        // A poll may have read `complete` while this request was in flight: never step back from it.
        if (details.current?.status !== 'complete') {
          details.current = fresh;
          callbacks.current.onSessionChange?.(fresh);
        }
      } catch (error) {
        if (run !== generation.current) return;
        callbacks.current.onError?.(asCheckoutError(error));
      } finally {
        if (run === generation.current) verifying.current.delete(url);
      }
      route(url, details.current);
    },
    [client, resolved.token, route],
  );

  const onShouldStartLoadWithRequest = useCallback(
    (request: WebViewNavigation): boolean => {
      const current = details.current;
      if (current?.status !== 'complete' && leavesCheckout(request.url, client.checkoutUrl)) {
        void verifyRedirect(request.url);
        return false;
      }
      return route(request.url, current);
    },
    [client, route, verifyRedirect],
  );

  if (!resolved.url) return <View style={[styles.container, style]} testID="pletopay-checkout-invalid" />;

  return (
    <View style={[styles.container, style]} testID="pletopay-checkout">
      <WebView
        {...webViewProps}
        testID="pletopay-checkout-webview"
        source={{ uri: resolved.url }}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onLoadEnd={(event) => {
          setLoaded(true);
          webViewProps?.onLoadEnd?.(event);
        }}
        onError={(event) =>
          callbacks.current.onError?.(
            new PletopayCheckoutError(
              'network_error',
              `The checkout page failed to load: ${event.nativeEvent.description}`,
              undefined,
              true,
            ),
          )
        }
        onHttpError={(event) =>
          callbacks.current.onError?.(
            new PletopayCheckoutError(
              event.nativeEvent.statusCode === 404 ? 'not_found' : 'unknown',
              `The checkout page answered HTTP ${event.nativeEvent.statusCode}`,
              event.nativeEvent.statusCode,
            ),
          )
        }
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
      />
      {!loaded && (
        <View style={styles.loading}>{renderLoading ? renderLoading() : <ActivityIndicator size="large" />}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
