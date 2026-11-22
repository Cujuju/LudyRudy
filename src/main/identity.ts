import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { appIdentity, IS_DEV_BUILD } from '@shared/app';
import { argument } from './paths';

const identity = appIdentity(IS_DEV_BUILD);
const userData = argument('--user-data-dir');
app.setName(identity.name);
app.setAppUserModelId(identity.id);
if (userData !== undefined || IS_DEV_BUILD) {
  if (userData === '') throw new Error('--user-data-dir requires a directory.');
  const dir = userData ? resolve(userData) : join(app.getPath('appData'), identity.name);
  mkdirSync(dir, { recursive: true });
  app.setPath('userData', dir);
}
