import { parse } from '@babel/parser';
import messages from '../locales/shell.zh-CN.json' with { type: 'json' };

// Build-time display-copy overlay. Never rewrite DOM, API enum values, routes,
// persisted content or upstream files. The pinned MIT source stays unchanged.
export function chineseShell(source: string, file: string) {
  if (!/\/ui\/src\/.*\.tsx$/.test(file.replaceAll('\\', '/')) || /\.test\.tsx$/.test(file)) return source;
  const tree = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  const edits: { start: number; end: number; text: string }[] = [], dictionary = messages as Record<string, string>;
  const displayProperties = /^(label|title|description|placeholder|aria-label|alt|emptyText|heading|buttonLabel|actionLabel|defaultValue)$/;
  function visit(node: any, parents: any[] = []) {
    const parent = parents.at(-1);
    if (node.type === 'JSXText') {
      const raw = source.slice(node.start, node.end), text = raw.trim(), translated = dictionary[text];
      if (translated) edits.push({ start: node.start, end: node.end, text: raw.replace(text, translated) });
    } else if (node.type === 'StringLiteral' && dictionary[node.value] && parent) {
      const protectedValue = parent.type === 'ObjectProperty' && /^(id|key|name|type|role|status|method|path|route|url|value|event|action|adapterType)$/.test(parent.key.name ?? parent.key.value)
        || parent.type === 'JSXAttribute' && !/^(label|title|placeholder|aria-label|alt|description|emptyText)$/.test(parent.name.name)
        || ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'SwitchCase'].includes(parent.type)
        || ['ObjectProperty', 'TSPropertySignature'].includes(parent.type) && parent.key === node;
      const container = parents.findLast(p => p.type === 'JSXExpressionContainer'), attribute = container && parents[parents.indexOf(container) - 1];
      const jsxDisplay = !!container && (attribute?.type !== 'JSXAttribute' || displayProperties.test(attribute.name.name));
      const displayValue = parent.type === 'JSXAttribute' && displayProperties.test(parent.name.name)
        || parent.type === 'ObjectProperty' && displayProperties.test(parent.key.name ?? parent.key.value)
        || parent.type === 'AssignmentPattern' && /^(title|label|description|placeholder|heading)$/.test(parent.left.name)
        || parent.type === 'VariableDeclarator' && /^(title|label|heading|pageTitle|headerTitle|sectionTitle)$/.test(parent.id.name)
        || parent.type === 'CallExpression' && /^(useDocumentTitle|usePageTitle)$/.test(parent.callee.name)
        || parent.type === 'JSXExpressionContainer' && jsxDisplay
        || parent.type === 'ConditionalExpression' && parent.test !== node && jsxDisplay
        || parent.type === 'LogicalExpression' && parent.right === node && jsxDisplay;
      if (!protectedValue && displayValue) edits.push({ start: node.start, end: node.end, text: JSON.stringify(dictionary[node.value]) });
    } else if (node.type === 'TemplateElement' && dictionary[node.value.raw]) {
      const attribute = parents.findLast(p => p.type === 'JSXAttribute');
      if (attribute && displayProperties.test(attribute.name.name)) edits.push({ start: node.start, end: node.end, text: dictionary[node.value.raw]! });
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) { if (child && typeof child === 'object' && typeof child.type === 'string') visit(child, [...parents, node]); }
      else if (value && typeof value === 'object' && 'type' in value && typeof value.type === 'string') visit(value, [...parents, node]);
    }
  }
  visit(tree);
  return edits.sort((a, b) => b.start - a.start).reduce((text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end), source);
}
