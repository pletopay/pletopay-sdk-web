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

  it('renders the hosted page, intercepts success_url and fires onSuccess once', async () => {
    const { fetch } = fetchMock([envelope(session())]);
    const client = new PletopayCheckoutClient({
      apiUrl: 'http://api.test',
      checkoutUrl: 'https://checkout.pletopay.com',
      fetch,
    });
    const onSuccess = jest.fn();
    const onCancel = jest.fn();
    const { getByTestId } = await render(
      <PletopayCheckout session={TOKEN} client={client} poll={false} onSuccess={onSuccess} onCancel={onCancel} />,
    );
    expect(getByTestId('pletopay-checkout-webview')).toBeTruthy();
    expect((webview().source as { uri: string }).uri).toBe(`https://checkout.pletopay.com/c/${TOKEN}`);
    await act(flush);
    expect(navigate(`https://checkout.pletopay.com/c/${TOKEN}`)).toBe(true); // in-page navigation allowed
    expect(navigate('https://shop.test/thanks/?x=1')).toBe(false); // intercepted
    expect(navigate('https://shop.test/thanks')).toBe(false);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith({ session: TOKEN, status: 'complete' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('keeps the WebView on the checkout origin and hands other links to the system (SDK-02)', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const { fetch } = fetchMock([envelope(session())]);
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
    expect(openURL).toHaveBeenLastCalledWith('https://help.shop.test/contact');
    expect(navigate('mailto:help@shop.test')).toBe(false);
    expect(openURL).toHaveBeenLastCalledWith('mailto:help@shop.test');
    // A look-alike host is just another website: system browser, never this view.
    expect(navigate('https://checkout.pletopay.com.evil.test/c/x')).toBe(false);
    expect(openURL).toHaveBeenLastCalledWith('https://checkout.pletopay.com.evil.test/c/x');
    expect(navigate('javascript:alert(1)')).toBe(false);
    expect(navigate('not a url')).toBe(false);
    expect(openURL).toHaveBeenCalledTimes(3);
    expect(onSuccess).not.toHaveBeenCalled();
    openURL.mockRestore();
  });

  it('intercepts cancel_url and reports expiry', async () => {
    const { fetch } = fetchMock([envelope(session())]);
    const client = new PletopayCheckoutClient({ apiUrl: 'http://api.test', fetch });
    const onCancel = jest.fn();
    await render(<PletopayCheckout session={TOKEN} client={client} poll={false} onCancel={onCancel} />);
    await act(flush);
    expect(navigate('https://shop.test/cart')).toBe(false);
    expect(onCancel).toHaveBeenCalledTimes(1);

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
