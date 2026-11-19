import { setImmediate as yieldToServer } from 'node:timers/promises';
import { tokenize } from '../../memory-projections.ts';
import type { Capabilities } from '../capabilities.ts';

export function weightedMemory(): Capabilities['memory'] {
  return {
    async health() { return { state: 'ready', mode: 'local', checkedAt: Date.now() }; },
    async search({ query, entries }) {
      const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().trim();
      const phrase = normalize(query);
      const terms = [...new Set(tokenize(phrase))];
      if (!phrase || !terms.length) return [];
      const ranked: { id: string; score: number }[] = [];
      for (const [index, entry] of entries.entries()) {
        if (index % 64 === 0) await yieldToServer();
        const text = normalize(entry.text);
        const words = new Set(tokenize(text));
        const title = text.split('\n', 1)[0] ?? '';
        const score = terms.filter(term => words.has(term)).length + (title.includes(phrase) ? terms.length * 4 : text.includes(phrase) ? terms.length : 0);
        if (score > 0) ranked.push({ id: entry.id, score });
      }
      return ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 6).map(row => row.id);
    },
  };
}
