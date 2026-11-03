import { describe, expect, it, vi } from 'vitest';
import { createCheckoutController } from '../src/controller';
import { fakeClient } from './fake-pletopay';

function setup() {
  const client = fakeClient({ publicKey: 'pk_test_x' });
  const controller = createCheckoutController({ getClient: async () => client });
  const states: string[] = [];
  controller.subscribe((s) => states.push(s.status));
  return { client, controller, states };
}

describe('createCheckoutController', () => {
  it('opens a session token, tracks pending → complete → closed', async () => {
    const { client, controller, states } = setup();
    const onSuccess = vi.fn();
    const handle = await controller.open('tok_1', { onSuccess });
    expect(handle).not.toBeNull();
    expect(controller.getState()).toMatchObject({ status: 'open', isOpen: true, busy: true });
    expect(client.checkout).toHaveBeenCalledWith(expect.objectContaining({ session: 'tok_1' }));
    client.fire.pending();
    expect(controller.getState().status).toBe('pending');
    expect(controller.getState().pending?.paymentStatus).toBe('processing');
    client.fire.success();
    expect(controller.getState().status).toBe('complete');
    expect(onSuccess).toHaveBeenCalledWith({ session: 'tok_1', status: 'complete' });
    client.fire.close('complete');
    expect(controller.getState()).toMatchObject({
      status: 'complete',
      isOpen: false,
      busy: false,
      closed: { reason: 'complete' },
    });
    expect(states).toEqual(['opening', 'open', 'pending', 'complete', 'complete']);
  });

  it('fetches the session from a function and reports fetch failures', async () => {
    const { client, controller } = setup();
    await controller.open(async () => 'tok_fn');
    expect(client.last()?.session).toBe('tok_fn');
    client.fire.close();
    await controller.open(async () => {
      throw new Error('server down');
    });
    expect(controller.getState()).toMatchObject({ status: 'error', busy: false });
    expect(controller.getState().error?.message).toBe('server down');
  });

  it('user close without completion is "closed"; reset returns to idle', async () => {
    const { client, controller } = setup();
    await controller.open('tok');
    controller.reset(); // ignored while open
    expect(controller.getState().isOpen).toBe(true);
    controller.close();
    expect(controller.getState()).toMatchObject({
      status: 'closed',
      isOpen: false,
      busy: false,
      closed: { reason: 'user' },
    });
    expect(client.isOpen()).toBe(false);
    controller.reset();
    expect(controller.getState().status).toBe('idle');
  });

  it('popup errors and invalid options surface as error', async () => {
    const { client, controller } = setup();
    const onError = vi.fn();
    await controller.open('tok', { onError });
    client.fire.error('network_error');
    expect(controller.getState().error).toMatchObject({ code: 'network_error' });
    expect(onError).toHaveBeenCalled();
    client.fire.close('error');
    expect(controller.getState().status).toBe('error');

    const second = createCheckoutController({ getClient: async () => client });
    expect(await second.open('')).toBeNull(); // invalid options: fake calls onError synchronously
    expect(second.getState()).toMatchObject({ status: 'error', busy: false });
    expect(second.getState().error).toMatchObject({ code: 'invalid_options' });
  });

  it('ignores a second open while busy and reports null when the SDK refuses', async () => {
    const { client, controller } = setup();
    await controller.open('tok');
    expect(await controller.open('tok2')).toBeNull();
    expect(client.checkout).toHaveBeenCalledTimes(1);
    client.fire.close();
    const other = createCheckoutController({ getClient: async () => client });
    await controller.open('tok3');
    expect(await other.open('tok4')).toBeNull(); // fake: already open
    expect(other.getState().error?.message).toMatch(/already open/);
  });

  it('reports a server environment', async () => {
    const controller = createCheckoutController({ getClient: async () => null });
    expect(await controller.open('tok')).toBeNull();
    expect(controller.getState().error?.message).toMatch(/only available in the browser/);
  });
});
