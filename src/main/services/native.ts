import { app } from 'electron';
import path from 'node:path';

type NativeModule = typeof import('../../../native/index');

let loaded: NativeModule | undefined;

/**
 * The Rust addon, built by `npm run native:build` into native/wavebit-native.node
 * and shipped as an extra resource when packaged. Loaded with process.dlopen so
 * the bundler never tries to inline the binary.
 */
export function native(): NativeModule {
  if (!loaded) {
    const file = app.isPackaged
      ? path.join(process.resourcesPath, 'wavebit-native.node')
      : path.join(app.getAppPath(), 'native', 'wavebit-native.node');
    const mod = { exports: {} as NativeModule };
    process.dlopen(mod, file);
    loaded = mod.exports;
  }
  return loaded;
}
