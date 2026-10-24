import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSubtitles } from '../src/core/parse';
import { serializeSubtitles } from '../src/core/serialize';
import { mergeBilingual } from '../src/core/bilingual';

const DIR = 'examples';
const files = readdirSync(DIR).filter((name) => /\.(srt|vtt)$/i.test(name));

describe('bundled example files', () => {
  it('ships at least the documented examples', () => {
    expect(files).toEqual(
      expect.arrayContaining(['broken-sample.srt', 'clean-sample.vtt', 'bilingual-en.srt', 'bilingual-zh.srt']),
    );
  });

  for (const name of files) {
    it(`${name} parses and survives a format round trip`, () => {
      const raw = readFileSync(join(DIR, name), 'utf8');
      const doc = parseSubtitles(raw, { fileName: name });
      expect(doc.cues.length).toBeGreaterThan(0);

      for (const format of ['srt', 'vtt'] as const) {
        const text = serializeSubtitles(doc, { format });
        const again = parseSubtitles(text, { format, fileName: `out.${format}` });
        expect(again.cues.length).toBe(doc.cues.length);
        expect(again.cues.map((cue) => cue.text)).toEqual(doc.cues.map((cue) => cue.text));
        expect(again.cues.map((cue) => cue.start)).toEqual(doc.cues.map((cue) => cue.start));
        expect(again.cues.map((cue) => cue.end)).toEqual(doc.cues.map((cue) => cue.end));
      }
    });
  }

  it('pairs the two bilingual examples by overlapping time', () => {
    const en = parseSubtitles(readFileSync(join(DIR, 'bilingual-en.srt'), 'utf8'), { fileName: 'en.srt' });
    const zh = parseSubtitles(readFileSync(join(DIR, 'bilingual-zh.srt'), 'utf8'), { fileName: 'zh.srt' });
    const { doc, report } = mergeBilingual(en, zh);
    expect(report.matchedCount).toBe(4);
    expect(doc.cues[0]?.secondary).toContain('你好');
  });
});
