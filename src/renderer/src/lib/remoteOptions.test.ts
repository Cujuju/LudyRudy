import { describe, expect, it } from 'vitest';
import { groupProviderOptions } from './remoteOptions';

describe('groupProviderOptions', () => {
  it('groups user, host, and port into an inline endpoint trio and promotes advanced port', () => {
    const host = { Name: 'host', Required: true };
    const user = { Name: 'user' };
    const pass = { Name: 'pass', IsPassword: true };
    const port = { Name: 'port', Default: 22, Advanced: true };
    const keyFile = { Name: 'key_file', Advanced: true };

    expect(groupProviderOptions([host, user, pass, port, keyFile])).toEqual({
      endpoint: { user, host, port },
      common: [pass],
      advanced: [keyFile],
    });
  });

  it('leaves options ungrouped when any endpoint field is missing', () => {
    const host = { Name: 'host', Required: true };
    const port = { Name: 'port', Default: 8080, Advanced: true };

    expect(groupProviderOptions([host, port])).toEqual({
      endpoint: null,
      common: [host],
      advanced: [port],
    });
  });

  it('does not group if one of the trio is an exclusive select or boolean', () => {
    const user = { Name: 'user' };
    const host = { Name: 'host', Exclusive: true, Examples: [{ Value: 'a', Help: '' }] };
    const port = { Name: 'port', Default: 22 };

    expect(groupProviderOptions([user, host, port])).toEqual({
      endpoint: null,
      common: [user, host, port],
      advanced: [],
    });
  });
});
