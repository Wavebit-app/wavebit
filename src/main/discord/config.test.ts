import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discordClientId } from './config.ts';

test('Settings wins, then the launch variable; anything not an id is ignored', () => {
  const before = process.env.WAVEBIT_DISCORD_CLIENT_ID;
  try {
    delete process.env.WAVEBIT_DISCORD_CLIENT_ID;
    assert.deepEqual(discordClientId(''), { id: '', source: null });
    assert.deepEqual(discordClientId('1234'), { id: '', source: null });

    process.env.WAVEBIT_DISCORD_CLIENT_ID = ' 123456789012345678 ';
    assert.deepEqual(discordClientId(''), {
      id: '123456789012345678',
      source: 'launch',
    });
    assert.deepEqual(discordClientId('987654321098765432'), {
      id: '987654321098765432',
      source: 'settings',
    });

    process.env.WAVEBIT_DISCORD_CLIENT_ID = '123; rm -rf /';
    assert.deepEqual(discordClientId(''), { id: '', source: null });
  } finally {
    if (before === undefined) delete process.env.WAVEBIT_DISCORD_CLIENT_ID;
    else process.env.WAVEBIT_DISCORD_CLIENT_ID = before;
  }
});
