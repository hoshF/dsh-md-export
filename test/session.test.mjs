/** Synthetic compression fixtures; no DSH installation or personal logs. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { constants, zstdCompressSync } from 'node:zlib';

import { decompressZstdAll } from '../src/session.js';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const frame = (value) => zstdCompressSync(Buffer.from(value), {
  params: { [constants.ZSTD_c_checksumFlag]: 1 },
});

// Public Zstandard layout: alternate headers and Raw/RLE blocks exercise
// containers the compressor's default settings do not generate.
// https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md
function block(type, value, last = true, decodedSize = value.length) {
  const header = Buffer.alloc(3);
  header.writeUIntLE((decodedSize << 3) | (type << 1) | Number(last), 0, 3);
  return Buffer.concat([header, value]);
}

const container = (descriptor, fields, blocks) => Buffer.concat([
  MAGIC, Buffer.from([descriptor, ...fields]), ...blocks,
]);

function alternateFrames() {
  const raw = Buffer.from('raw');
  return [
    { encoded: container(0x00, [0], [block(0, raw)]), expected: raw }, // window, no content size
    { encoded: container(0x60, [44, 0], [block(1, Buffer.from('x'), true, 300)]), expected: Buffer.alloc(300, 'x') },
    { encoded: container(0xa0, [3, 0, 0, 0], [block(0, raw)]), expected: raw },
    { encoded: container(0xe0, [3, 0, 0, 0, 0, 0, 0, 0], [block(0, raw)]), expected: raw },
    { encoded: container(0x21, [0, 3], [block(0, raw)]), expected: raw }, // dictionary ID 0, one byte
    { encoded: container(0x22, [0, 0, 3], [block(0, raw)]), expected: raw },
    { encoded: container(0x23, [0, 0, 0, 0, 3], [block(0, raw)]), expected: raw },
    { encoded: container(0x30, [3], [block(0, raw)]), expected: raw }, // unused descriptor bit is ignored
    {
      encoded: container(0x20, [6], [block(0, raw, false), block(1, Buffer.from('x'), true, 3)]),
      expected: Buffer.from('rawxxx'),
    },
  ];
}

test('decompressZstdAll returns a Buffer for a single frame', () => {
  const expected = Buffer.from('single frame\n');
  const actual = decompressZstdAll(frame(expected));
  assert.ok(Buffer.isBuffer(actual));
  assert.deepEqual(actual, expected);
});

test('decompressZstdAll reads every concatenated frame in order', () => {
  const values = ['header\n', 'first answer\n', 'last answer\n'];
  assert.deepEqual(
    decompressZstdAll(Buffer.concat(values.map(frame))),
    Buffer.from(values.join('')),
  );
});

test('decompressZstdAll accepts empty frames without stopping before later data', () => {
  assert.deepEqual(decompressZstdAll(frame('')), Buffer.alloc(0));
  assert.deepEqual(
    decompressZstdAll(Buffer.concat(['', 'first\n', '', 'last\n', ''].map(frame))),
    Buffer.from('first\nlast\n'),
  );
});

test('decompressZstdAll does not treat magic inside a frame as a boundary', () => {
  const payload = Buffer.concat([Buffer.from('before'), MAGIC, Buffer.from('after')]);
  const encoded = frame(payload);
  assert.ok(encoded.indexOf(MAGIC, 4) >= 4, 'fixture must contain magic inside its encoded payload');
  assert.deepEqual(
    decompressZstdAll(Buffer.concat([encoded, frame('next frame')])),
    Buffer.concat([payload, Buffer.from('next frame')]),
  );
});

test('decompressZstdAll rejects corrupted magic in a later frame', () => {
  const corrupted = frame('answer that must not silently disappear\n');
  corrupted[0] ^= 1;
  assert.throws(() => decompressZstdAll(Buffer.concat([
    frame('header\n'), corrupted, frame('last frame\n'),
  ])));
});

test('decompressZstdAll rejects garbage after complete frames', () => {
  assert.throws(() => decompressZstdAll(Buffer.concat([
    frame('header\n'), frame('answer\n'), Buffer.from('trailing garbage'),
  ])));
});

test('decompressZstdAll rejects a final frame torn inside its magic', () => {
  const next = frame('next answer\n');
  for (let length = 1; length <= 3; length++) {
    assert.throws(
      () => decompressZstdAll(Buffer.concat([frame('header\n'), next.subarray(0, length)])),
      `a ${length}-byte final frame must fail`,
    );
  }
});

test('decompressZstdAll rejects truncation after a complete magic', () => {
  const next = frame('next answer\n');
  for (let length = 4; length < next.length; length++) {
    assert.throws(
      () => decompressZstdAll(Buffer.concat([frame('header\n'), next.subarray(0, length)])),
      `a final frame truncated at byte ${length} must fail`,
    );
  }
});

test('decompressZstdAll rejects a corrupted checksum in a later frame', () => {
  const corrupted = frame('next answer\n');
  corrupted[corrupted.length - 1] ^= 1;
  assert.throws(() => decompressZstdAll(Buffer.concat([frame('header\n'), corrupted])));
});

test('decompressZstdAll rejects an empty or truncated first frame', () => {
  assert.throws(() => decompressZstdAll(Buffer.alloc(0)));
  const encoded = frame('header\n');
  for (let length = 1; length < encoded.length; length++) {
    assert.throws(() => decompressZstdAll(encoded.subarray(0, length)));
  }
});

test('decompressZstdAll handles alternate headers, multiple blocks and RLE blocks', () => {
  const frames = alternateFrames();
  assert.deepEqual(
    decompressZstdAll(Buffer.concat(frames.map(({ encoded }) => encoded))),
    Buffer.concat(frames.map(({ expected }) => expected)),
  );
});

test('decompressZstdAll rejects truncation in frames without a checksum', () => {
  for (const { encoded } of alternateFrames()) {
    for (let length = 1; length < encoded.length; length++) {
      assert.throws(
        () => decompressZstdAll(Buffer.concat([frame('header\n'), encoded.subarray(0, length)])),
        `descriptor ${encoded[4]} truncated at byte ${length} must fail`,
      );
    }
  }
});

test('decompressZstdAll reads compressed frames spanning multiple blocks', () => {
  const value = Buffer.from('several blocks\n'.repeat(20000));
  assert.deepEqual(decompressZstdAll(Buffer.concat([frame(value), frame('last\n')])), Buffer.concat([
    value, Buffer.from('last\n'),
  ]));
});

test('decompressZstdAll rejects reserved frame and block flags', () => {
  assert.throws(() => decompressZstdAll(container(0x28, [3], [block(0, Buffer.from('raw'))])));
  assert.throws(() => decompressZstdAll(container(0x20, [3], [block(3, Buffer.from('raw'))])));
});

test('decompressZstdAll handles skippable metadata frames', () => {
  const metadata = Buffer.from('metadata');
  const skippable = Buffer.alloc(8 + metadata.length);
  skippable.writeUInt32LE(0x184d2a50, 0);
  skippable.writeUInt32LE(metadata.length, 4);
  metadata.copy(skippable, 8);
  assert.deepEqual(decompressZstdAll(skippable), Buffer.alloc(0));
  assert.deepEqual(
    decompressZstdAll(Buffer.concat([frame('first\n'), skippable, frame('last\n')])),
    Buffer.from('first\nlast\n'),
  );
  for (let length = 1; length < skippable.length; length++) {
    assert.throws(() => decompressZstdAll(skippable.subarray(0, length)));
  }
});
