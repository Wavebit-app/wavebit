import { app } from 'electron';
import path from 'node:path';
import type { Cache } from '../../../native/index';
import { native } from './native';

let cache: Cache | null = null;

/** The SQLite response cache shared by everything that calls a network API. */
export function responseCache(): Cache {
  cache ??= new (native().Cache)(
    path.join(app.getPath('userData'), 'cache.db'),
  );
  return cache;
}

export function cached<T>(key: string): T | null {
  const raw = responseCache().get(key);
  return raw === null ? null : (JSON.parse(raw) as T);
}

export function store(key: string, value: unknown, ttlSeconds: number): void {
  responseCache().set(key, JSON.stringify(value), ttlSeconds);
}
