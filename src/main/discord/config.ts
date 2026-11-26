/** Public Discord Application ID injected when building Wavebit releases. */
declare const __WAVEBIT_DISCORD_CLIENT_ID__: string;

export function discordClientId(): string {
  return typeof __WAVEBIT_DISCORD_CLIENT_ID__ === 'string'
    ? __WAVEBIT_DISCORD_CLIENT_ID__
    : '';
}
