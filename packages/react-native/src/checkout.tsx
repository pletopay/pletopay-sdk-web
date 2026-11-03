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
  /** Every session update observed while polling (e.g. to show "transfer received, confirming…"). */
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

function sameUrl(a: string, b: string | null): boolean {
  if (!b) return false;
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname.replace(/\/$/, '') === y.pathname.replace(/\/$/, '');
  } catch {
    return a === b;
  }
}

/**
 * The hosted checkout page in a WebView. Completion is detected two ways: the page's redirect to your
 * `success_url` is intercepted (never navigated to), and the session is polled through the checkout API.
 * Whichever happens first fires `onSuccess` once.
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
  const [details, setDetails] = useState<PublicCheckoutSession | null>(null);
  const done = useRef<'success' | 'cancel' | 'expired' | null>(null);
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
    setLoaded(false);
    setDetails(null);
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
        setDetails(first);
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
            setDetails(next);
            callbacks.current.onSessionChange?.(next);
          },
        });
        if (controller.signal.aborted) return;
        if (last.status === 'complete') finish('success', last);
        else if (last.status === 'expired') finish('expired', last);
      } catch (error) {
        if (controller.signal.aborted) return;
        callbacks.current.onError?.(
          error instanceof PletopayCheckoutError ? error : new PletopayCheckoutError('unknown', String(error)),
        );
      }
    })();
    return () => controller.abort();
  }, [client, resolved.token, resolved.error, poll, pollIntervalMs, finish]);

  const onShouldStartLoadWithRequest = useCallback(
    (request: WebViewNavigation): boolean => {
      if (details && sameUrl(request.url, details.success_url)) {
        finish('success', details);
        return false;
      }
      if (details && sameUrl(request.url, details.cancel_url)) {
        finish('cancel', details);
        return false;
      }
      // Only the checkout origin renders inside this view. Anything else the page links to (the
      // merchant's support URL or email, or a page a compromised checkout could redirect to) opens
      // in the system browser or mail app, never in the WebView that carries the merchant's name.
      let target: URL;
      try {
        target = new URL(request.url);
      } catch {
        return false;
      }
      if (target.origin === client.checkoutUrl) return true;
      if (target.protocol === 'https:' || target.protocol === 'http:' || target.protocol === 'mailto:') {
        Linking.openURL(request.url).catch(() => undefined);
      }
      return false;
    },
    [client, details, finish],
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
