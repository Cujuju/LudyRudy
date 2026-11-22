const PROVIDER_NAMES: Record<string, string> = {
  drive: 'Google Drive',
  crypt: 'Crypt',
  s3: 'S3',
  b2: 'Backblaze B2',
  onedrive: 'OneDrive',
  dropbox: 'Dropbox',
  sftp: 'SFTP',
  webdav: 'WebDAV',
  box: 'Box',
  pcloud: 'pCloud',
  mega: 'MEGA',
  local: 'Local',
};

export const providerName = (id: string) => (Object.hasOwn(PROVIDER_NAMES, id) ? PROVIDER_NAMES[id]! : id);
