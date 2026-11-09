import type { WavebitApi } from '../shared/ipc/api';

declare global {
  interface Window {
    wavebit: WavebitApi;
  }
}
