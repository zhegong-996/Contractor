import { parseDocument } from 'yaml';

export function readSkillManifest(markdown: string) {
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown);
  if (!match || match[1]!.length > 8000) return;
  const document = parseDocument(match[1]!, { schema: 'core', uniqueKeys: true });
  if (document.errors.length) return;
  let data: unknown;
  try { data = document.toJS({ maxAliasCount: 0 }); }
  catch { return; }
  if (!data || typeof data !== 'object' || !Object.hasOwn(data, 'name')) return;
  const slug = (data as { name?: unknown }).name;
  const instructions = markdown.slice(match[0].length).trim();
  if (typeof slug === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(slug) && instructions)
    return { slug, instructions };
}
