import { describe, expect, it } from 'vitest';
import * as next from '../src/index';
import * as react from '@pletopay/react';

describe('@pletopay/next client entry', () => {
  it('re-exports the React bindings', () => {
    for (const name of Object.keys(react)) expect(name in next).toBe(true);
    expect(next.PletopayProvider).toBe(react.PletopayProvider);
  });
});
