import { describe, expect, it } from 'vitest';
import type { ProviderOptionSpec } from '@shared/types';
import { groupProviderOptions, optionChoiceExamples, optionValue, providerVariant, visibleProviderOptions } from './remoteOptions';

const field = (name: string, spec?: Partial<ProviderOptionSpec>): ProviderOptionSpec => ({ name, input: 'text', ...spec });

describe('groupProviderOptions', () => {
  it('groups user, host, and port into an inline endpoint trio and promotes advanced port', () => {
    const host = field('host', { required: true, sensitive: true });
    const user = field('user', { sensitive: true });
    const pass = field('pass', { input: 'password', sensitive: true });
    const port = field('port', { defaultValue: 22, advanced: true });
    const keyFile = field('key_file', { advanced: true });

    expect(groupProviderOptions([host, user, pass, port, keyFile])).toEqual({
      endpoint: { user, host, port },
      common: [pass],
      advanced: [keyFile],
    });
  });

  it('leaves options ungrouped when any endpoint field is missing', () => {
    const host = field('host', { required: true });
    const port = field('port', { defaultValue: 8080, advanced: true });

    expect(groupProviderOptions([host, port])).toEqual({
      endpoint: null,
      common: [host],
      advanced: [port],
    });
  });

  it('does not group if one of the trio is an exclusive select or boolean', () => {
    const user = field('user');
    const host = field('host', { choices: [{ value: 'a', help: '' }] });
    const port = field('port', { defaultValue: 22 });

    expect(groupProviderOptions([user, host, port])).toEqual({
      endpoint: null,
      common: [user, host, port],
      advanced: [],
    });
  });
});

it('uses the displayed provider value to scope fields and choices', () => {
  const provider = field('provider', { defaultValue: 'first' });
  const scoped = field('scoped', { provider: 'first,second', required: true });
  const excluded = field('excluded', { provider: '!first,second' });
  const choice = field('region', { choices: [
    { value: 'first-region', help: '', provider: 'first' },
    { value: 'other-region', help: '', provider: '!first' },
  ] });
  const fields = [provider, scoped, excluded, choice, field('token', { input: 'password' })];
  const defaultProvider = providerVariant(fields, {});
  expect(defaultProvider).toBe(optionValue(provider, {}));
  expect(visibleProviderOptions(fields, defaultProvider)).toEqual([provider, scoped, choice]);
  expect(optionChoiceExamples(choice, defaultProvider)).toEqual([choice.choices![0]]);
  const configured = providerVariant(fields, { provider: 'third' });
  expect(visibleProviderOptions(fields, configured)).toEqual([provider, excluded, choice]);
  expect(optionChoiceExamples(choice, configured)).toEqual([choice.choices![1]]);
});

it('keeps configured zero, false and empty values instead of applying defaults', () => {
  expect(optionValue(field('enabled', { defaultValue: true }), { enabled: false })).toBe(false);
  expect(optionValue(field('port', { defaultValue: 22 }), { port: 0 })).toBe(0);
  expect(optionValue(field('user', { defaultValue: 'guest' }), { user: '' })).toBe('');
});
