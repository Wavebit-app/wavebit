import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DRAWER,
  drawerMax,
  fitColumns,
  MIN_WORKSPACE,
  RAIL,
  SIDEBAR,
  sidebarMax,
} from './columnLimits.ts';

const open = { sidebar: true, drawer: true };

test('a roomy window allows the full range', () => {
  assert.equal(sidebarMax(1920, 360), SIDEBAR.max);
  assert.equal(drawerMax(1920, 232), DRAWER.max);
});

test('the choice is drawn as made when it fits', () => {
  assert.deepEqual(fitColumns({ sidebar: 300, drawer: 450 }, 1920, open), {
    sidebar: 300,
    drawer: 450,
  });
});

test('out of range values are brought back in', () => {
  assert.deepEqual(fitColumns({ sidebar: 50, drawer: 9000 }, 1920, open), {
    sidebar: SIDEBAR.min,
    drawer: DRAWER.max,
  });
});

test('the page keeps its minimum on every window that can give it', () => {
  for (const window of [1100, 1280, 1366, 1600, 1920, 2560]) {
    const fit = fitColumns({ sidebar: 360, drawer: 520 }, window, open);
    assert.ok(window - fit.sidebar - fit.drawer >= MIN_WORKSPACE, `${window}`);
  }
});

test('the drawer gives way before the sidebar', () => {
  const fit = fitColumns({ sidebar: 232, drawer: 520 }, 1100, open);
  assert.equal(fit.sidebar, 232);
  assert.equal(fit.drawer, 388);
});

test('the sidebar only grows when the player bar has room', () => {
  assert.equal(sidebarMax(1100, 0), SIDEBAR.initial);
  assert.equal(sidebarMax(1300, 0), 300);
});

test('a smallest window stops at the minimums', () => {
  assert.deepEqual(fitColumns({ sidebar: 360, drawer: 520 }, 900, open), {
    sidebar: SIDEBAR.min,
    drawer: DRAWER.min,
  });
});

test('a rail is a fixed width and leaves the drawer the room', () => {
  const fit = fitColumns({ sidebar: 300, drawer: 520 }, 1072, {
    sidebar: false,
    drawer: true,
  });
  assert.equal(fit.sidebar, RAIL);
  assert.equal(fit.drawer, 520);
});

test('with the drawer shut the sidebar need not save room for it', () => {
  const fit = fitColumns({ sidebar: 360, drawer: 520 }, 1400, {
    sidebar: true,
    drawer: false,
  });
  assert.equal(fit.sidebar, 360);
});
