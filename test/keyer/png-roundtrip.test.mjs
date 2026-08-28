/**
 * PNG codec round-trip verification test.
 * Decodes a fixture PNG, re-encodes it, decodes again, and verifies pixel-for-pixel match.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPNG, savePNG } from './png.mjs';

test('PNG codec round-trip: fixture pixels survive decode->encode->decode', async () => {
  const fixture1 = './test/keyer/fixtures/clip-01/frame-000.png';

  // Load original
  const original = await loadPNG(fixture1);
  assert.ok(original.width > 0, 'original width must be positive');
  assert.ok(original.height > 0, 'original height must be positive');
  assert.equal(original.data.length, original.width * original.height * 4, 'RGBA data length');

  // Save to temp file
  const tempFile = './test/keyer/temp-roundtrip.png';
  await savePNG(original, tempFile);

  // Load the temp file
  const reloaded = await loadPNG(tempFile);
  assert.equal(reloaded.width, original.width, 'width must match after round-trip');
  assert.equal(reloaded.height, original.height, 'height must match after round-trip');

  // Compare pixels byte-for-byte
  assert.deepEqual(reloaded.data, original.data, `all ${original.data.length} pixels must match exactly`);

  // Clean up
  await import('node:fs/promises').then(fs => fs.unlink(tempFile).catch(() => {}));
});
