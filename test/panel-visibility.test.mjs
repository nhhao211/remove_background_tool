import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PANEL_GROUPS,
  PANEL_DEFS,
  PANEL_STORAGE_KEY,
  MINIMAL_PANEL_IDS,
  listPanelIds,
  getPanel,
  parseVisibility,
  hiddenIds,
  serializeVisibility,
  countHidden,
  isPanelVisible,
  setPanelVisible,
  setGroupVisible,
  allVisible,
  minimalVisibility
} from '../public/js/panel-visibility.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '..', 'public', 'index.html'), 'utf8');

test('every registered panel points at an element that exists in the markup', () => {
  for (const panel of PANEL_DEFS) {
    assert.ok(panel.elements.length > 0, `${panel.id} lists no elements`);
    for (const elementId of panel.elements) {
      assert.ok(
        html.includes(`id="${elementId}"`),
        `${panel.id} → #${elementId} is not in public/index.html`
      );
    }
  }
});

test('panel ids and element ids are unique across the registry', () => {
  const ids = listPanelIds();
  assert.equal(new Set(ids).size, ids.length, 'duplicate panel id');
  const elements = PANEL_DEFS.flatMap((panel) => panel.elements);
  assert.equal(new Set(elements).size, elements.length, 'an element is claimed by two panels');
});

test('a fresh install shows everything', () => {
  const state = parseVisibility(null);
  assert.equal(countHidden(state), 0);
  for (const id of listPanelIds()) assert.equal(isPanelVisible(state, id), true);
});

test('parseVisibility survives anything localStorage can hand back', () => {
  for (const raw of [null, undefined, '', 'not json', '{', '42', '"x"', [], {}, 0, false]) {
    const state = parseVisibility(raw);
    assert.equal(countHidden(state), 0, `bad input ${JSON.stringify(raw)} lost a panel`);
  }
});

test('unknown ids in storage are dropped instead of resurrecting a removed panel', () => {
  const state = parseVisibility(JSON.stringify(['erase-brush', 'a-panel-that-no-longer-exists']));
  assert.deepEqual(hiddenIds(state), ['erase-brush']);
  assert.equal(isPanelVisible(state, 'a-panel-that-no-longer-exists'), true);
});

test('a full id -> visible map is accepted too, for a layout written by an older build', () => {
  const state = parseVisibility({ 'erase-brush': false, 'color-replace': true });
  assert.deepEqual(hiddenIds(state), ['erase-brush']);
});

test('round-trips through storage', () => {
  let state = allVisible();
  state = setPanelVisible(state, 'erase-brush', false);
  state = setPanelVisible(state, 'color-replace', false);
  const reloaded = parseVisibility(serializeVisibility(state));
  assert.deepEqual(hiddenIds(reloaded), hiddenIds(state));
  assert.equal(countHidden(reloaded), 2);
});

test('only hidden ids are persisted, so a panel added later defaults to visible', () => {
  const state = setPanelVisible(allVisible(), 'watermark', false);
  assert.deepEqual(JSON.parse(serializeVisibility(state)), ['watermark']);
});

test('setPanelVisible does not mutate the state it was handed', () => {
  const before = allVisible();
  const after = setPanelVisible(before, 'erase-brush', false);
  assert.equal(isPanelVisible(before, 'erase-brush'), true);
  assert.equal(isPanelVisible(after, 'erase-brush'), false);
});

test('setPanelVisible ignores an id that is not in the registry', () => {
  const state = setPanelVisible(allVisible(), 'nope', false);
  assert.equal(countHidden(state), 0);
});

test('setGroupVisible flips one group and leaves the others alone', () => {
  let state = setGroupVisible(allVisible(), 'chroma', false);
  for (const panel of PANEL_GROUPS.find((g) => g.key === 'chroma').panels) {
    assert.equal(isPanelVisible(state, panel.id), false, `${panel.id} should be hidden`);
  }
  for (const panel of PANEL_GROUPS.find((g) => g.key === 'sprite').panels) {
    assert.equal(isPanelVisible(state, panel.id), true, `${panel.id} should be untouched`);
  }
  state = setGroupVisible(state, 'unknown-group', false);
  assert.equal(countHidden(state), PANEL_GROUPS.find((g) => g.key === 'chroma').panels.length);
});

test('the minimal preset keeps exactly the core panels', () => {
  const state = minimalVisibility();
  const visible = listPanelIds().filter((id) => isPanelVisible(state, id));
  assert.deepEqual(visible.sort(), MINIMAL_PANEL_IDS.slice().sort());
  for (const id of MINIMAL_PANEL_IDS) assert.ok(getPanel(id), `preset names a panel that does not exist: ${id}`);
});

test('the three panels named in the request can all be switched off', () => {
  let state = allVisible();
  for (const id of ['protect-brush', 'erase-brush', 'color-replace']) {
    assert.ok(getPanel(id), `${id} is not registered`);
    state = setPanelVisible(state, id, false);
  }
  assert.deepEqual(hiddenIds(state).sort(), ['color-replace', 'erase-brush', 'protect-brush']);
});

test('the storage key is namespaced with the rest of the app', () => {
  assert.match(PANEL_STORAGE_KEY, /^video-editor:/);
});
