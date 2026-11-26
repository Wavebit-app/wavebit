/** Public Discord Application ID injected when building wavebit releases. */
declare const __WAVEBIT_DISCORD_CLIENT_ID__: string;

const APP_ID = /^\d{17,20}$/;

/** The id built into this copy of wavebit, if any. */
export function builtInDiscordClientId(): string {
  return typeof __WAVEBIT_DISCORD_CLIENT_ID__ === 'string' &&
    APP_ID.test(__WAVEBIT_DISCORD_CLIENT_ID__)
    ? __WAVEBIT_DISCORD_CLIENT_ID__
    : '';
}

/**
 * Which Discord application the card is published as: the one entered in
 * Settings, else `WAVEBIT_DISCORD_CLIENT_ID` at launch, else the build's.
 * Application ids are public identifiers, not secrets.
 */
export function discordClientId(fromSettings: string): {
  id: string;
  source: 'settings' | 'launch' | 'build' | null;
} {
  if (APP_ID.test(fromSettings))
    return { id: fromSettings, source: 'settings' };
  const fromEnv = process.env.WAVEBIT_DISCORD_CLIENT_ID?.trim() ?? '';
  if (APP_ID.test(fromEnv)) return { id: fromEnv, source: 'launch' };
  const built = builtInDiscordClientId();
  return built ? { id: built, source: 'build' } : { id: '', source: null };
}
