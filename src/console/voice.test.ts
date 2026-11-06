/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Voice Lines (#83, ADR 0003): assets/voice/build.py reads lines.json and writes one clean WAV per id.
const VOICE_DIR = new URL('../../assets/voice/', import.meta.url);
const LINES = JSON.parse(readFileSync(new URL('lines.json', VOICE_DIR), 'utf8')) as Record<string, string>;

/** RIFF/WAVE header: the `fmt ` chunk fields and the `data` chunk size. */
function wavInfo(buf: Buffer) {
  expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
  expect(buf.toString('ascii', 8, 12)).toBe('WAVE');
  let channels = 0, sampleRate = 0, bits = 0, dataBytes = 0;
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(at + 10);
      sampleRate = buf.readUInt32LE(at + 12);
      bits = buf.readUInt16LE(at + 22);
    } else if (id === 'data') dataBytes = size;
    at += 8 + size + (size & 1);
  }
  return { channels, sampleRate, bits, dataBytes };
}

describe('committed Voice Lines', () => {
  it('scripts the 18 Voice Lines of the spec', () => {
    expect(Object.keys(LINES)).toHaveLength(18);
  });

  for (const [id, text] of Object.entries(LINES)) {
    it(`${id} ("${text}") is a committed mono 24 kHz 16-bit WAV with audio in it`, () => {
      const url = new URL(`${id}.wav`, VOICE_DIR);
      expect(existsSync(url), `${id}.wav: run \`uv run assets/voice/build.py\``).toBe(true);
      const { channels, sampleRate, bits, dataBytes } = wavInfo(readFileSync(url));
      expect({ channels, sampleRate, bits }).toEqual({ channels: 1, sampleRate: 24000, bits: 16 });
      expect(dataBytes).toBeGreaterThan(0);
    });
  }
});
