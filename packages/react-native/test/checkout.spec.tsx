import { act, render, waitFor } from '@testing-library/react-native';
import { PletopayCheckout, PletopayCheckoutClient, PletopayProvider, useCheckoutSession } from '../src';
import { TOKEN, apiError, envelope, fetchMock, flush, session } from './helpers';
import { Linking, Text } from 'react-native';

const registry = jest.requireMock<{ __registry: { current: Record<string, unknown> | null } }>(
  'react-native-webview',
).__registry;
const webview = () => registry.current!;
const navigate = (url: string): boolean =>
  (webview().onShouldStartLoadWithRequest as (r: { url: string }) => boolean)({ url });

describe('<PletopayCheckout>', () => {
  beforeEach(() => {
    registry.current = null;
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders the hosted page, confirms the success_url redirect with the API and fires onSuccess once', async () => {
    // Polling is off and the only state read so far is `open`, which carries no success_url.
    const { fetch, calls } = fetchMock([envelope(session()), envelope(session({ status: 'complete' }))]);
    const client = new PletopayCheckoutClient({
      apiUrl: 'http://api.test',
      checkoutUrl: 'https://checkout.pletopay.com',
      fetch,
    });
    const onSuccess = jest.fn();
    const onCancel = jest.fn();
    const onError = jest.fn();
    const onSessionChange = jest.fn();
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { getByTestId } = await render(
      <PletopayCheckout
        session={TOKEN}
        client={client}
        poll={false}
        onSuccess={onSuccess}
        onCancel={onCancel}
        onError={onError}
        onSessionChange={onSessionChange}
      />,
    );
    expect(getByTestId('pletopay-checkout-webview')).toBeTruthy();
    expect((webview().source as { uri: string }).uri).toBe(`https://checkout.pletopay.com/c/${TOKEN}`);
    await act(flush);
    expect(navigate(`https://checkout.pletopay.com/c/${TOKEN}`)).toBe(true); // in-page navigation allowed
    expect(navigate('https://shop.test/thanks/?x=1')).toBe(false); // blocked while the API is asked
    expect(navigate('https://shop.test/thanks/?x=1')).toBe(false); // the same request again: no second lookup
    expect(onSuccess).not.toHaveBeenCalled();
    await act(flush);
    expect(calls).toHaveLength(2);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith({ session: TOKEN, status: 'complete' });
    expect(onSessionChange.mock.calls.map((c) => (c[0] as { status: string }).status)).toEqual(['open', 'complete']);
    // The completed session is known now: later redirects are settled without another request.
    expect(navigate('https://shop.test/thanks')).toBe(false);
    await act(flush);
    expect(calls).toHaveLength(2);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(openURL).not.toHaveBeenCalled();
    openURL.mockRestore();
  });

  it('confirms a redirect that arrives while the poll still holds an open session', async () => {
    jest.useFakeTimers();
    const { fetch, calls } = fetchMock([
      envelope(session()),
      envelope(session({ status: 'complete', payment_status: 'succeeded' })), // the redirect's lookup
      envelope(session({ status: 'complete', payment_status: 'succeeded' })), // the next poll
    ]);
    const client = new PletopayCheckoutClient({ apiUrl: 'http://api.test', fetch });
    const onSuccess = jest.fn();
    const onError = jest.fn();
    await render(<PletopayCheckout session={TOKEN} client={client} onSuccess={onSuccess} onError={onError} />);
    await act(() => jest.advanceTimersByTimeAsync(1000)); // first fetch done; the next poll is 3 s away
    expect(calls).toHaveLength(1);
    expect(navigate('https://shop.test/thanks')).toBe(false);
    await act(() => jest.advanceTimersByTimeAsync(0));
    expect(calls).toHaveLength(2);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    await act(() => jest.advanceTimersByTimeAsync(4000)); // the poll sees `complete` too and stops
    await act(() => jest.advanceTimersByTimeAsync(60_000));
    expect(calls).toHaveLength(3);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('never reports success for a success_url redirect while the API still says open', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { fetch, calls } = fetchMock([envelope(session()), envelope(session())]);
    const client = new PletopayCheckoutClient({ apiUrl: 'http://api.test', fetch });
    const onSuccess = jest.fn();
    const onCancel = jest.fn();
    const onError = jest.fn();
    await render(
      <PletopayCheckout
        session={TOKEN}
        client={client}
        poll={false}
        onSuccess={onSuccess}
        onCancel={onCancel}
        onError={onError}
      />,
    );
    await act(flush);
    expect(navigate('https://shop.test/thanks')).toBe(false);
    await act(flush);
    expect(calls).toHaveLength(2);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    // Not a completed session's success_url, so it is just another website: system browser.
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenLastCalledWith('https://shop.test/thanks');
    openURL.mockRestore();
  });

  it('reports the error and falls back to the system browser when the redirect cannot be confirmed', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { fetch } = fetchMock([envelope(session()), new TypeError('offline'), new TypeError('offline')]);
    const client = new PletopayCheckoutClient({ apiUrl: 'http://api.test', fetch });
    const onSuccess = jest.fn();
    const onCancel = jest.fn();
    const onError = jest.fn();
    await render(
      <PletopayCheckout
        session={TOKEN}
        client={client}
        poll={false}
        onSuccess={onSuccess}
        onCancel={onCancel}
        onError={onError}
      />,
    );
    await act(flush);
    expect(navigate('https://shop.test/thanks')).toBe(false);
    await act(flush);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'network_error', retryable: true }));
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenLastCalledWith('https://shop.test/thanks');
    expect(onSuccess).not.toHaveBeenCalled();
    // The cancel_url is known from the open session, so going back still works without the API.
    expect(navigate('https://shop.test/cart')).toBe(false);
    await act(flush);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledTimes(1);
    openURL.mockRestore();
  });

  it('keeps the WebView on the checkout origin and hands other links to the system (SDK-02)', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { fetch, calls } = fetchMock([envelope(session()), envelope(session()), envelope(session())]);
    const client = new PletopayCheckoutClient({
      apiUrl: 'http://api.test',
      checkoutUrl: 'https://checkout.pletopay.com',
      fetch,
    });
    const onSuccess = jest.fn();
    await render(<PletopayCheckout session={TOKEN} client={client} poll={false} onSuccess={onSuccess} />);
    await act(flush);
    expect(navigate(`https://checkout.pletopay.com/c/${TOKEN}?x=1`)).toBe(true);
    expect(navigate('https://help.shop.test/contact')).toBe(false);
    await act(flush);
    expect(openURL).toHaveBeenLastCalledWith('https://help.shop.test/contact');
    expect(navigate('mailto:help@shop.test')).toBe(false);
    expect(openURL).toHaveBeenLastCalledWith('mailto:help@shop.test');
    // A look-alike host is just another website: system browser, never this view.
    expect(navigate('https://checkout.pletopay.com.evil.test/c/x')).toBe(false);
    await act(flush);
    expect(openURL).toHaveBeenLastCalledWith('https://checkout.pletopay.com.evil.test/c/x');
    expect(navigate('javascript:alert(1)')).toBe(false);
    expect(navigate('not a url')).toBe(false);
    await act(flush);
    expect(openURL).toHaveBeenCalledTimes(3);
    expect(calls).toHaveLength(3); // one lookup per web link that left the checkout origin, none for the rest
    expect(onSuccess).not.toHaveBeenCalled();
    openURL.mockRestore();
  });

  it('intercepts cancel_url and reports expiry', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { fetch } = fetchMock([envelope(session()), envelope(session())]);
    const client = new PletopayCheckoutClient({ apiUrl: 'http://api.test', fetch });
    const onCancel = jest.fn();
    await render(<PletopayCheckout session={TOKEN} client={client} poll={false} onCancel={onCancel} />);
    await act(flush);
    expect(navigate('https://shop.test/cart')).toBe(false);
    await act(flush);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(openURL).not.toHaveBeenCalled();
    openURL.mockRestore();

    const expired = fetchMock([envelope(session({ status: 'expired' }))]);
    const onExpired = jest.fn();
    await render(
      <PletopayCheckout
        session={TOKEN}
        client={new PletopayCheckoutClient({ apiUrl: 'http://api.test', fetch: expired.fetch })}
        onExpired={onExpired}
      />,
    );
    await waitFor(() => expect(onExpired).toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' })));
  });

  it('keeps polling past expires_at and reports expiry, or a late completion, when the API settles', async () => {
    jest.useFakeTimers();
    const expires_at = new Date(Date.now() + 10_000).toISOString();
    const settleAt = Date.now() + 10_000 + 5 * 60_000; // five minutes after expires_at
    const outcomes = (final: 'expired' | 'complete') => {
      const calls: number[] = [];
      const fetch = (async () => {
        calls.push(Date.now());
        return envelope(session({ expires_at, status: Date.now() >= settleAt ? final : 'open' }));
      }) as typeof globalThis.fetch;
      return { calls, client: new PletopayCheckoutClient({ apiUrl: 'http://api.test', fetch }) };
    };
    const expiring = outcomes('expired');
    const late = outcomes('complete');
    const onExpired = jest.fn();
    const onSuccess = jest.fn();
    const onError = jest.fn();
    await render(<PletopayCheckout session={TOKEN} client={expiring.client} onExpired={onExpired} onError={onError} />);
    await render(<PletopayCheckout session={TOKEN} client={late.client} onSuccess={onSuccess} onError={onError} />);
    await act(() => jest.advanceTimersByTimeAsync(10_000 + 4 * 60_000));
    expect(onExpired).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTimeAsync(90_000));
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(onExpired).toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' }));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    const polled = expiring.calls.length;
    await act(() => jest.advanceTimersByTimeAsync(60 * 60_000));
    expect(expiring.calls).toHaveLength(polled); // settled: nothing more is fetched
  });

  it('detects completion by polling when no redirect happens', async () => {
    jest.useFakeTimers();
    const { fetch } = fetchMock([
      envelope(session()),
      envelope(session({ payment_status: 'processing' })),
      envelope(session({ status: 'complete', payment_status: 'succeeded' })),
    ]);
    const client = new PletopayCheckoutClient({ apiUrl: 'http://api.test', fetch });
    const onSuccess = jest.fn();
    const onSessionChange = jest.fn();
    await render(
      <PletopayCheckout
        session={TOKEN}
        client={client}
        pollIntervalMs={2000}
        onSuccess={onSuccess}
        onSessionChange={onSessionChange}
      />,
    );
    for (let i = 0; i < 3; i++) await act(() => jest.advanceTimersByTimeAsync(2100));
    expect(onSuccess).toHaveBeenCalledWith({ session: TOKEN, status: 'complete' });
    expect(onSessionChange.mock.calls.map((c) => (c[0] as { payment_status: string | null }).payment_status)).toEqual([
      null,
      'processing',
      'succeeded',
    ]);
    expect(navigate('https://shop.test/thanks')).toBe(false); // still intercepted, but no second onSuccess
    expect(onSuccess).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('reports invalid sessions, API errors and page load errors', async () => {
    const onError = jest.fn();
    const { getByTestId } = await render(<PletopayCheckout session="nope" onError={onError} />);
    expect(getByTestId('pletopay-checkout-invalid')).toBeTruthy();
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_session' })));

    const { fetch } = fetchMock([apiError(404, 'not_found')]);
    const onError2 = jest.fn();
    await render(
      <PletopayCheckout
        session={TOKEN}
        client={new PletopayCheckoutClient({ apiUrl: 'http://api.test', fetch })}
        onError={onError2}
      />,
    );
    await waitFor(() => expect(onError2).toHaveBeenCalledWith(expect.objectContaining({ code: 'not_found' })));
    (webview().onError as (e: { nativeEvent: { description: string } }) => void)({
      nativeEvent: { description: 'net::ERR' },
    });
    expect(onError2).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'network_error', retryable: true }));
  });

  it('uses the provider client and shows the loading view until the page loads', async () => {
    const { fetch, calls } = fetchMock([envelope(session())]);
    const { queryByText, getByText } = await render(
      <PletopayProvider apiUrl="http://provider.test" checkoutUrl="https://checkout.pletopay.com" fetch={fetch}>
        <PletopayCheckout session={TOKEN} poll={false} renderLoading={() => <Text>loading…</Text>} />
      </PletopayProvider>,
    );
    await act(flush);
    expect(calls[0]?.url).toBe(`http://provider.test/checkout/v1/sessions/${TOKEN}`);
    expect(getByText('loading…')).toBeTruthy();
    await act(async () => (webview().onLoadEnd as (e: unknown) => void)({}));
    expect(queryByText('loading…')).toBeNull();
  });
});

describe('useCheckoutSession', () => {
  afterEach(() => {
    jest.useRealTimers();
  });
  function Probe({ token, openOnMount }: { token: string; openOnMount?: boolean }) {
    const { status, session: s, error } = useCheckoutSession(token, { openOnMount, intervalMs: 2000 });
    return <Text testID="probe">{`${status}|${s?.bank_transfer?.account_number ?? ''}|${error?.code ?? ''}`}</Text>;
  }

  it('fetches, optionally opens, and polls to completion', async () => {
    const { fetch, calls } = fetchMock([
      envelope(
        session({
          bank_transfer: {
            account_number: '9821110017',
            account_name: 'A',
            bank_name: 'B',
            bank_code: '1',
            amount: 1,
            expires_at: 'x',
          },
        }),
      ),
      envelope(
        session({
          status: 'complete',
          bank_transfer: {
            account_number: '9821110017',
            account_name: 'A',
            bank_name: 'B',
            bank_code: '1',
            amount: 1,
            expires_at: 'x',
          },
        }),
      ),
    ]);
    const { getByTestId } = await render(
      <PletopayProvider apiUrl="http://api.test" fetch={fetch}>
        <Probe token={TOKEN} openOnMount />
      </PletopayProvider>,
    );
    await waitFor(() => expect(getByTestId('probe').props.children).toBe('open|9821110017|'));
    expect(calls[0]).toEqual({ url: `http://api.test/checkout/v1/sessions/${TOKEN}/open`, method: 'POST' });
    // Polls at the minimum interval (2 s, real timers) and picks up the completion.
    await waitFor(() => expect(getByTestId('probe').props.children).toBe('complete|9821110017|'), { timeout: 5000 });
  }, 10000);

  it('exposes errors', async () => {
    const { fetch } = fetchMock([apiError(404, 'not_found')]);
    const { getByTestId } = await render(
      <PletopayProvider apiUrl="http://api.test" fetch={fetch}>
        <Probe token={TOKEN} />
      </PletopayProvider>,
    );
    await waitFor(() => expect(getByTestId('probe').props.children).toBe('error||not_found'));
  });
});
