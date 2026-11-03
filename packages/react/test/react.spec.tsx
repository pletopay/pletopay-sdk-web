import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPletopayLoader } from '@pletopay/js';
import { PletopayCheckoutButton, PletopayProvider, usePletopay, usePletopayCheckout } from '../src';
import { installFakeFactory } from '../../js/test/fake-pletopay';

function Status() {
  const { status, client } = usePletopay();
  return (
    <output data-testid="status">
      {status}:{client ? client.version : 'none'}
    </output>
  );
}

function Flow() {
  const checkout = usePletopayCheckout();
  return (
    <div>
      <output data-testid="flow">
        {checkout.status}|{String(checkout.busy)}|{checkout.result?.session ?? ''}|{checkout.error?.message ?? ''}
      </output>
      <button onClick={() => void checkout.open('tok_flow')}>open</button>
      <button onClick={() => checkout.close()}>close</button>
      <button onClick={() => checkout.reset()}>reset</button>
    </div>
  );
}

describe('@pletopay/react', () => {
  let fake: ReturnType<typeof installFakeFactory>;
  beforeEach(() => {
    resetPletopayLoader();
    fake = installFakeFactory();
  });
  afterEach(() => {
    delete window.Pletopay;
  });

  it('provider loads the client with the key and exposes status', async () => {
    render(
      <PletopayProvider publicKey="pk_test_abc" checkoutUrl="https://checkout.pletopay.com">
        <Status />
      </PletopayProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready:1.0.0-test'));
    expect(fake.factory).toHaveBeenCalledWith({
      publicKey: 'pk_test_abc',
      checkoutUrl: 'https://checkout.pletopay.com',
    });
    expect(fake.clients).toHaveLength(1);
  });

  it('usePletopay outside the provider throws', () => {
    expect(() => render(<Status />)).toThrow(/inside <PletopayProvider>/);
  });

  it('the button opens the popup and the hook tracks the flow', async () => {
    const onSuccess = vi.fn();
    const fetchToken = vi.fn(async () => 'tok_btn');
    render(
      <PletopayProvider publicKey="pk_test_abc">
        <Flow />
        <PletopayCheckoutButton session={fetchToken} onSuccess={onSuccess}>
          {(state) => (state.busy ? 'Opening…' : 'Pay now')}
        </PletopayCheckoutButton>
      </PletopayProvider>,
    );
    const button = screen.getByRole('button', { name: 'Pay now' });
    expect(button).toHaveProperty('type', 'button');
    fireEvent.click(button);
    await waitFor(() => expect(button.textContent).toBe('Opening…'));
    expect(button).toHaveProperty('disabled', true);
    expect(fetchToken).toHaveBeenCalledTimes(1);
    const client = fake.clients[0]!;
    expect(client.last()?.session).toBe('tok_btn');
    act(() => client.fire.success());
    expect(onSuccess).toHaveBeenCalledWith({ session: 'tok_btn', status: 'complete' });
    act(() => client.fire.close('complete'));
    await waitFor(() => expect(button).toHaveProperty('disabled', false));
    expect(button.getAttribute('data-pletopay-status')).toBe('complete');
  });

  it('the hook exposes open/close/reset and errors', async () => {
    render(
      <PletopayProvider publicKey="pk_test_abc" loadOnMount={false}>
        <Flow />
      </PletopayProvider>,
    );
    expect(fake.factory).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('open'));
    await waitFor(() => expect(screen.getByTestId('flow').textContent).toBe('open|true||'));
    expect(fake.factory).toHaveBeenCalledTimes(1);
    const client = fake.clients[0]!;
    act(() => client.fire.error('rate_limited'));
    expect(screen.getByTestId('flow').textContent).toBe('error|true||fake rate_limited');
    fireEvent.click(screen.getByText('close'));
    expect(screen.getByTestId('flow').textContent).toBe('error|false||fake rate_limited');
    fireEvent.click(screen.getByText('reset'));
    expect(screen.getByTestId('flow').textContent).toBe('idle|false||');
  });

  it('reports load failures and can reload', async () => {
    delete window.Pletopay;
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      queueMicrotask(() => node.dispatchEvent(new Event('error')));
      return node;
    });
    function Reload() {
      const { status, error, reload } = usePletopay();
      return (
        <button onClick={reload}>
          {status}:{error?.name ?? ''}
        </button>
      );
    }
    render(
      <PletopayProvider publicKey="pk_test_abc">
        <Reload />
      </PletopayProvider>,
    );
    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('error:PletopayLoadError'));
    vi.restoreAllMocks();
    installFakeFactory();
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('button').textContent).toBe('ready:'));
  });

  it('a click handler can cancel opening', async () => {
    render(
      <PletopayProvider publicKey="pk_test_abc">
        <PletopayCheckoutButton session="tok" onClick={() => false} />
      </PletopayProvider>,
    );
    await waitFor(() => expect(fake.clients).toHaveLength(1));
    fireEvent.click(screen.getByRole('button'));
    expect(fake.clients[0]!.checkout).not.toHaveBeenCalled();
  });
});
