import { Tabs } from 'antd';
import { Children, Fragment, isValidElement, type ReactNode } from 'react';

type TabPane = { value: string; className?: string; children: ReactNode };
export function TabsContent({ className, children }: TabPane) {
  return <div className={className}>{children}</div>;
}

type Navigation<T extends string> = { value: T; onChange: (value: T) => void;
  items: readonly (readonly [T, string])[]; label: string };

function panelsIn(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap(child =>
    isValidElement<{ children: ReactNode }>(child) && child.type === Fragment ? panelsIn(child.props.children) : [child]);
}

export function PageTabs<T extends string>({ value, onChange, items, label, children }: Navigation<T> & { children: ReactNode }) {
  const panels = panelsIn(children).filter(child => isValidElement<TabPane>(child) && child.type === TabsContent);
  return <Tabs className="page-tabs" activeKey={value} onChange={key => onChange(key as T)} aria-label={label} destroyOnHidden
    items={items.map(([key, title]) => ({ key, label: title, children: panels.find(child => isValidElement<TabPane>(child) && child.props.value === key) }))} />;
}

export function Segments<T extends string>({ value, onChange, items, label }: Navigation<T>) {
  return <Tabs className="segments" data-slot="tabs" type="card" size="small" activeKey={value}
    onChange={key => onChange(key as T)} aria-label={label} items={items.map(([key, title]) => ({ key, label: title }))} />;
}
