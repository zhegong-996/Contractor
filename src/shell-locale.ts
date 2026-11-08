import { parse } from '@babel/parser';
import i18nPack from '../locales/i18n-zh-CN.json' with { type: 'json' };

// Build-time display-copy overlay. Never rewrite DOM, API enum values, routes,
// persisted content or upstream files. The pinned MIT source stays unchanged.
//
// 词典数据源是 i18next 标准结构（locales/i18n-zh-CN.json 的 translation 段，
// 英文原文作 key）。同一份数据在构建期注入上游 i18next（见
// scripts/build-chinese-shell.ts），本函数处理上游未走 t() 的硬编码文案。
export function chineseShell(source: string, file: string) {
  if (!/\/ui\/src\/.*\.tsx$/.test(file.replaceAll('\\', '/')) || /\.test\.tsx$/.test(file)) return source;
  const tree = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const edits: { start: number; end: number; text: string }[] = [], dictionary = (i18nPack as { translation: Record<string, string> }).translation;
  const displayProperties = /^(label|title|description|placeholder|aria-label|ariaLabel|alt|emptyText|heading|buttonLabel|actionLabel|defaultValue|message|action|mobileLabel|effect|subtitle)$/;
  function visit(node: any, parents: any[] = []) {
    const parent = parents.at(-1);
    if (node.type === 'JSXText') {
      const raw = source.slice(node.start, node.end), text = raw.trim(),
        // 源码里被 span / 换行切碎的长句：查词典前把内部空白折叠成单空格，
        // 词条以单空格形态书写，不依赖上游格式化的换行缩进。
        translated = dictionary[text.replace(/\s+/g, ' ')];
      if (translated) edits.push({ start: node.start, end: node.end, text: raw.replace(text, translated) });
    } else if (node.type === 'StringLiteral' && dictionary[node.value] && parent) {
      const protectedValue = parent.type === 'ObjectProperty' && /^(id|key|name|type|role|status|method|path|route|url|value|event|action|adapterType)$/.test(parent.key.name ?? parent.key.value)
        || parent.type === 'JSXAttribute' && !/^(label|title|placeholder|aria-label|alt|description|emptyText|message|action|mobileLabel|effect|subtitle)$/.test(parent.name.name)
        || ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'SwitchCase'].includes(parent.type)
        || ['ObjectProperty', 'TSPropertySignature'].includes(parent.type) && parent.key === node;
      const container = parents.findLast(p => p.type === 'JSXExpressionContainer'), attribute = container && parents[parents.indexOf(container) - 1];
      const jsxDisplay = !!container && (attribute?.type !== 'JSXAttribute' || displayProperties.test(attribute.name.name));
      // 显示映射表启发式：INTERACTION_KIND_LABELS / *_EFFECTS 这类
      // `Record<Kind, string>` 常量，key 是 camelCase / snake_case 的数据键、
      // value 是首字母大写的英文显示句——按显示文案替换。
      // snake_case 键允许单词值（request_confirmation: "Confirmations"），
      // camelCase 键要求含空格句子；API 枚举值不受影响。
      const labelMapEntry = parent.type === 'ObjectProperty'
        && /^[a-z][a-zA-Z0-9_]*$/.test(String(parent.key.name ?? parent.key.value ?? ''))
        && /^[A-Z]/.test(node.value)
        && ((parent.key.name ?? parent.key.value ?? '').toString().includes('_') || node.value.includes(' '));
      const displayValue = parent.type === 'JSXAttribute' && displayProperties.test(parent.name.name)
        || parent.type === 'ObjectProperty' && displayProperties.test(parent.key.name ?? parent.key.value)
        || parent.type === 'ObjectProperty' && labelMapEntry
        || parent.type === 'AssignmentPattern' && (/^(title|label|description|placeholder|heading)$|(?:Label|Title)$/.test(parent.left.name))
        || parent.type === 'VariableDeclarator' && (/^(title|label|heading)$|(?:Label|Title)$/.test(parent.id.name))
        || parent.type === 'CallExpression' && /^(useDocumentTitle|usePageTitle)$/.test(parent.callee.name)
        || parent.type === 'JSXExpressionContainer' && jsxDisplay
        || parent.type === 'ConditionalExpression' && parent.test !== node && jsxDisplay
        || parent.type === 'LogicalExpression' && parent.right === node && jsxDisplay;
      if (!protectedValue && displayValue) edits.push({ start: node.start, end: node.end, text: JSON.stringify(dictionary[node.value]) });
    } else if (node.type === 'TemplateElement' && dictionary[node.value.raw]) {
      const attribute = parents.findLast(p => p.type === 'JSXAttribute');
      const property = parents.findLast(p => p.type === 'ObjectProperty' && displayProperties.test(p.key.name ?? p.key.value));
      if (attribute && displayProperties.test(attribute.name.name) || property) edits.push({ start: node.start, end: node.end, text: dictionary[node.value.raw]! });
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) { if (child && typeof child === 'object' && typeof child.type === 'string') visit(child, [...parents, node]); }
      else if (value && typeof value === 'object' && 'type' in value && typeof value.type === 'string') visit(value, [...parents, node]);
    }
  }
  visit(tree);
  return edits.sort((a, b) => b.start - a.start).reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
}
