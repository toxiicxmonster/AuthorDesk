import type { Server } from 'node:http';
import type { Store } from './store.js';
export function createApp(store: Store, opts?: { appDir?: string; secureCookies?: boolean | 'auto' }): Server;
