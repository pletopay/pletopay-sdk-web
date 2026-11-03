import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PletopayLoadError,
  createPletopay,
  loadPletopay,
  resetPletopayLoader,
  resolvePletopayScriptUrl,
} from '../src/loader';
import { installFakeFactory } from './fake-pletopay';

const SRC = 'https://checkout.pletopay.com/v1/pletopay.js';

function scripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll('script'));
}

/** Simulates the browser finishing the injected script: define the global, fire `load`. */
function finishLoad(ok = true): void {
  const script = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`)!;
  if (ok) installFakeFactory();
  script.dispatchEvent(new Event(ok ? 'load' : 'error'));
}

describe('resolvePletopayScriptUrl', () => {
  it('defaults to the Pletopay checkout origin and v1', () => {
    expect(resolvePletopayScriptUrl()).toBe(SRC);
    expect(resolvePletopayScriptUrl({ checkoutUrl: 'https://checkout.example.test/' })).toBe(
      'https://checkout.example.test/v1/pletopay.js',
    );
    expect(resolvePletopayScriptUrl({ checkoutUrl: 'http://localhost:3007' })).toBe(
      'http://localhost:3007/v1/pletopay.js',
    );
  });

  it('rejects invalid or insecure origins', () => {
    expect(() => resolvePletopayScriptUrl({ checkoutUrl: 'not a url' })).toThrow(PletopayLoadError);
    expect(() => resolvePletopayScriptUrl({ checkoutUrl: 'http://checkout.pletopay.com' })).toThrow(/https/);
  });
});

describe('loadPletopay', () => {
  beforeEach(() => {
    resetPletopayLoader();
    delete window.Pletopay;
    for (const s of scripts()) s.remove();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('injects the script once, shares concurrent calls and resolves the factory', async () => {
    const a = loadPletopay();
    const b = loadPletopay();
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]!.src).toBe(SRC);
    expect(scripts()[0]!.async).toBe(true);
    finishLoad();
    const [fa, fb] = await Promise.all([a, b]);
    expect(fa).toBe(window.Pletopay);
    expect(fb).toBe(fa);
    await loadPletopay(); // cached
    expect(scripts()).toHaveLength(1);
  });

  it('reuses an existing script tag and an already defined global', async () => {
    const tag = document.createElement('script');
    tag.src = SRC;
    document.head.appendChild(tag);
    const p = loadPletopay();
    expect(scripts()).toHaveLength(1);
    finishLoad();
    expect(await p).toBeTypeOf('function');

    resetPletopayLoader();
    expect(await loadPletopay()).toBe(window.Pletopay); // no new tag, no load event needed
    expect(scripts()).toHaveLength(1);
  });

  it('rejects with script_error, removes its own tag, and retries on the next call', async () => {
    const p = loadPletopay();
    finishLoad(false);
    await expect(p).rejects.toMatchObject({ name: 'PletopayLoadError', code: 'script_error' });
    expect(scripts()).toHaveLength(0);
    const again = loadPletopay();
    expect(scripts()).toHaveLength(1);
    finishLoad();
    expect(await again).toBeTypeOf('function');
  });

  it('rejects with no_factory when the script defines nothing', async () => {
    const p = loadPletopay();
    document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`)!.dispatchEvent(new Event('load'));
    await expect(p).rejects.toMatchObject({ code: 'no_factory' });
  });

  it('times out', async () => {
    vi.useFakeTimers();
    const p = loadPletopay({ timeoutMs: 50 });
    const guarded = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60);
    expect(await guarded).toMatchObject({ code: 'timeout' });
  });

  it('puts a nonce on the tag and validates options', async () => {
    void loadPletopay({ nonce: 'abc' }).catch(() => undefined);
    expect(scripts()[0]!.nonce).toBe('abc');
    await expect(loadPletopay({ checkoutUrl: 'ftp://x' })).rejects.toMatchObject({ code: 'invalid_options' });
  });
});

describe('createPletopay', () => {
  beforeEach(() => {
    resetPletopayLoader();
    delete window.Pletopay;
    for (const s of scripts()) s.remove();
  });

  it('creates a client with the key and the normalised checkout origin', async () => {
    const { factory } = installFakeFactory();
    const client = await createPletopay('pk_test_abc', { checkoutUrl: 'https://checkout.pletopay.com/' });
    expect(client).toBeTruthy();
    expect(factory).toHaveBeenCalledWith({ publicKey: 'pk_test_abc', checkoutUrl: 'https://checkout.pletopay.com' });
  });
});
