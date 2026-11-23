export type ProviderOptionSpec = Record<string, unknown>;

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

export function isSecretOption(option: ProviderOptionSpec): boolean {
  return option.IsPassword === true || /secret|password|token|pass$|private_key/i.test(String(option.Name));
}

export function isBooleanOption(option: ProviderOptionSpec): boolean {
  return option.Type === 'bool' || typeof option.Default === 'boolean';
}

export function requiresOptionValue(option: ProviderOptionSpec): boolean {
  return option.Required === true && (option.Default === undefined || option.Default === '');
}

export function optionChoiceExamples(option: ProviderOptionSpec): { Value: string; Help: string }[] {
  return option.Exclusive === true && Array.isArray(option.Examples) && !isSecretOption(option) && !isBooleanOption(option)
    ? option.Examples as { Value: string; Help: string }[] : [];
}

function isPlainInput(option: ProviderOptionSpec): boolean {
  return !isSecretOption(option) && !isBooleanOption(option) && optionChoiceExamples(option).length === 0;
}

export function groupProviderOptions(fields: readonly ProviderOptionSpec[]): GroupedProviderOptions {
  const user = fields.find((option) => option.Name === 'user');
  const host = fields.find((option) => option.Name === 'host');
  const port = fields.find((option) => option.Name === 'port');
  const endpoint = user && host && port && isPlainInput(user) && isPlainInput(host) && isPlainInput(port)
    ? { user, host, port }
    : null;
  const remaining = endpoint
    ? fields.filter((option) => option !== user && option !== host && option !== port)
    : fields;
  return {
    endpoint,
    common: remaining.filter((option) => option.Advanced !== true || option.Required === true),
    advanced: remaining.filter((option) => option.Advanced === true && option.Required !== true),
  };
}
