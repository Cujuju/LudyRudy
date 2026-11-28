const MAX_ERROR_BODY_BYTES = 16 * 1024;

export function fileSystemDiagnostic(error: string | undefined): string | undefined {
  switch (error) {
    case 'object not found':
      return 'The file was not found. Check the remote path.';
    case 'file does not exist':
      return 'The path was not found.';
    case 'directory not found':
    case 'error in ListJSON: directory not found':
      return 'The directory was not found. Check the remote path.';
  }
  if (error?.startsWith("didn't find section in config file (")) {
    return 'The remote is missing from the daemon configuration.';
  }
}

async function readRcError(response: Response): Promise<string | undefined> {
  const body = response.body;
  if (!body) return;
  if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    await body.cancel().catch(() => undefined);
    return;
  }
  const reader = body.getReader();
  try {
    const bytes = new Uint8Array(MAX_ERROR_BODY_BYTES);
    let length = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (length + value.byteLength > bytes.byteLength) return;
      bytes.set(value, length);
      length += value.byteLength;
    }
    const data: unknown = JSON.parse(new TextDecoder().decode(bytes.subarray(0, length)));
    if (data !== null && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
      return data.error;
    }
  } catch {
    return undefined;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function rcFailureDiagnostic(method: string, response: Response, noClobber: boolean): Promise<string | undefined> {
  const status = response.status;
  if (status === 401 || status === 403) {
    await response.body?.cancel().catch(() => undefined);
    return 'Check the rclone RC credentials and permissions.';
  }
  // Error JSON can echo request parameters. Only fixed messages leave this module.
  const error = await readRcError(response);
  if (status === 500 && noClobber && (
    error === 'immutable file modified' || error === 'is a directory not a file' || error === 'is a file not a directory'
  )) return 'The destination already exists.';
  if (method.startsWith('operations/') || method.startsWith('sync/')) return fileSystemDiagnostic(error);
  if (method === 'mount/mount') {
    if (error === 'mount option specified is not registered, or is invalid') return 'Choose a mount type supported by the daemon.';
    if (error === 'daemon option not supported over the API') return 'Remove the daemon option from the mount profile.';
    return fileSystemDiagnostic(error);
  }
  if (method === 'mount/unmount' && error === 'mount not found') return 'The mount is no longer active.';
  if (method.startsWith('vfs/')) {
    if (error?.startsWith('no VFS found with name ')) return 'The mount cache is no longer active.';
    if (error?.startsWith('more than one VFS active with name ')) return 'More than one mount cache matches this filesystem.';
  }
  if (method.startsWith('job/') && error === 'job not found') return 'The daemon no longer has this job.';
}
