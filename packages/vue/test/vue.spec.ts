import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetPletopayLoader } from '@pletopay/js';
import { PletopayCheckoutButton, createPletopayPlugin, usePletopay, usePletopayCheckout } from '../src';
import { installFakeFactory } from '../../js/test/fake-pletopay';

const Status = defineComponent({
  setup() {
    const { status, client } = usePletopay();
    return () =>
      h('output', { 'data-testid': 'status' }, `${status.value}:${client.value ? client.value.version : 'none'}`);
  },
});

const Flow = defineComponent({
  setup() {
    const checkout = usePletopayCheckout();
    return () =>
      h('div', [
        h(
          'output',
          { 'data-testid': 'flow' },
          `${checkout.state.value.status}|${checkout.state.value.busy}|${checkout.state.value.result?.session ?? ''}|${checkout.state.value.error?.message ?? ''}`,
        ),
        h('button', { id: 'open', onClick: () => void checkout.open('tok_flow') }, 'open'),
        h('button', { id: 'close', onClick: () => checkout.close() }, 'close'),
        h('button', { id: 'reset', onClick: () => checkout.reset() }, 'reset'),
      ]);
  },
});

describe('@pletopay/vue', () => {
  let fake: ReturnType<typeof installFakeFactory>;
  beforeEach(() => {
    resetPletopayLoader();
    fake = installFakeFactory();
  });
  afterEach(() => {
    delete window.Pletopay;
  });

  it('the plugin loads the client with the key and exposes status', async () => {
    const wrapper = mount(Status, {
      global: {
        plugins: [createPletopayPlugin({ publicKey: 'pk_test_abc', checkoutUrl: 'https://checkout.pletopay.com' })],
      },
    });
    await flushPromises();
    expect(wrapper.get('[data-testid=status]').text()).toBe('ready:1.0.0-test');
    expect(fake.factory).toHaveBeenCalledWith({
      publicKey: 'pk_test_abc',
      checkoutUrl: 'https://checkout.pletopay.com',
    });
    expect(wrapper.vm.$pletopay.publicKey).toBe('pk_test_abc');
  });

  it('usePletopay without the plugin throws', () => {
    expect(() => mount(Status)).toThrow(/install the plugin first/);
  });

  it('the button opens the popup, emits events and disables itself', async () => {
    const fetchToken = vi.fn(async () => 'tok_btn');
    const onSuccess = vi.fn();
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(
            PletopayCheckoutButton,
            { session: fetchToken, onSuccess },
            { default: ({ state }: { state: { busy: boolean } }) => (state.busy ? 'Opening…' : 'Pay now') },
          ),
      }),
      { global: { plugins: [createPletopayPlugin({ publicKey: 'pk_test_abc' })] } },
    );
    const button = wrapper.get('button');
    expect(button.text()).toBe('Pay now');
    expect(button.attributes('type')).toBe('button');
    await button.trigger('click');
    await flushPromises();
    expect(button.text()).toBe('Opening…');
    expect(button.attributes('disabled')).toBeDefined();
    const client = fake.clients[0]!;
    expect(client.last()?.session).toBe('tok_btn');
    client.fire.success();
    await nextTick();
    expect(onSuccess).toHaveBeenCalledWith({ session: 'tok_btn', status: 'complete' });
    client.fire.close('complete');
    await nextTick();
    expect(button.attributes('disabled')).toBeUndefined();
    expect(button.attributes('data-pletopay-status')).toBe('complete');
  });

  it('the composable exposes open/close/reset and errors; loadOnMount=false defers loading', async () => {
    const wrapper = mount(Flow, {
      global: { plugins: [createPletopayPlugin({ publicKey: 'pk_test_abc', loadOnMount: false })] },
    });
    expect(fake.factory).not.toHaveBeenCalled();
    await wrapper.get('#open').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid=flow]').text()).toBe('open|true||');
    const client = fake.clients[0]!;
    client.fire.error('rate_limited');
    await nextTick();
    expect(wrapper.get('[data-testid=flow]').text()).toBe('error|true||fake rate_limited');
    await wrapper.get('#close').trigger('click');
    expect(wrapper.get('[data-testid=flow]').text()).toBe('error|false||fake rate_limited');
    await wrapper.get('#reset').trigger('click');
    expect(wrapper.get('[data-testid=flow]').text()).toBe('idle|false||');
  });

  it('reports load failures and can reload', async () => {
    delete window.Pletopay;
    const spy = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      queueMicrotask(() => node.dispatchEvent(new Event('error')));
      return node;
    });
    const Reload = defineComponent({
      setup() {
        const { status, error, reload } = usePletopay();
        return () => h('button', { onClick: reload }, `${status.value}:${error.value?.name ?? ''}`);
      },
    });
    const wrapper = mount(Reload, { global: { plugins: [createPletopayPlugin({ publicKey: 'pk_test_abc' })] } });
    await flushPromises();
    expect(wrapper.get('button').text()).toBe('error:PletopayLoadError');
    spy.mockRestore();
    installFakeFactory();
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.get('button').text()).toBe('ready:');
  });
});
