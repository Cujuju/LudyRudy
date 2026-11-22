export interface BuildInfo {
  version: string;
  build: string;
  modified: boolean;
}

export const MODIFIED_SUFFIX = '-dirty';

export function parseBuildInfo(version: string, id: string): BuildInfo {
  const modified = id.endsWith(MODIFIED_SUFFIX);
  return { version, build: modified ? id.slice(0, -MODIFIED_SUFFIX.length) : id, modified };
}
