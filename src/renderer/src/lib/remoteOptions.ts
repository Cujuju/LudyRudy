import type { ProviderOptionSpec, RemoteParameters } from '@shared/types';

export interface EndpointOptions {
  user: ProviderOptionSpec;
  host: ProviderOptionSpec;
  port: ProviderOptionSpec;
}

export interface GroupedProviderOptions {
  endpoint: EndpointOptions | null;
  common: ProviderOptionSpec[];
  advanced: ProviderOptionSpec[];
}

export function optionValue(option: ProviderOptionSpec, values: RemoteParameters) {
  return (Object.hasOwn(values, option.name) ? values[option.name] : undefined) ?? option.defaultValue;
}

export function providerVariant(fields: readonly ProviderOptionSpec[], values: RemoteParameters): string {
  const option = fields.find(({ name }) => name === 'provider');
  return option ? String(optionValue(option, values) ?? '') : '';
}

function matchesProvider(filter: string | undefined, provider: string): boolean {
  if (!filter || !provider) return true;
  return filter.startsWith('!')
    ? !filter.slice(1).split(',').includes(provider)
    : filter.split(',').includes(provider);
}

export function visibleProviderOptions(fields: readonly ProviderOptionSpec[], provider: string): ProviderOptionSpec[] {
  return fields.filter((option) => option.name !== 'token' && matchesProvider(option.provider, provider));
}

export function requiresOptionValue(option: ProviderOptionSpec): boolean {
  return option.required === true && (option.defaultValue === undefined || option.defaultValue === '');
}

export function optionChoiceExamples(option: ProviderOptionSpec, provider: string) {
  return option.choices?.filter((choice) => matchesProvider(choice.provider, provider)) ?? [];
}

function isPlainInput(option: ProviderOptionSpec): boolean {
  return option.input === 'text' && !option.choices?.length;
}

export function groupProviderOptions(fields: readonly ProviderOptionSpec[]): GroupedProviderOptions {
  const user = fields.find((option) => option.name === 'user');
  const host = fields.find((option) => option.name === 'host');
  const port = fields.find((option) => option.name === 'port');
  const endpoint = user && host && port && isPlainInput(user) && isPlainInput(host) && isPlainInput(port)
    ? { user, host, port }
    : null;
  const remaining = endpoint
    ? fields.filter((option) => option !== user && option !== host && option !== port)
    : fields;
  return {
    endpoint,
    common: remaining.filter((option) => !option.advanced || option.required),
    advanced: remaining.filter((option) => option.advanced && !option.required),
  };
}
