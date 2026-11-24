import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  define: {
    __WAVEBIT_DISCORD_CLIENT_ID__: JSON.stringify(
      process.env.WAVEBIT_DISCORD_CLIENT_ID ?? '',
    ),
  },
});
