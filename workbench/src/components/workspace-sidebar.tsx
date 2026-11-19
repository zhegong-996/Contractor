import { Layout } from 'antd';
import { useRef, useState, type ReactNode } from 'react';
import { formerName } from '../../../src/workbench/compatibility.ts';

export function preference(key: string) {
  return localStorage.getItem(key) ?? localStorage.getItem(formerName(key));
}

const widthKey = 'contractor.sidebar.width';
const defaultWidth = 234;
const clampWidth = (value: number) => Math.max(192, Math.min(360, value));

export function WorkspaceSidebar({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  const [width, setWidth] = useState(() => clampWidth(Number(preference(widthKey)) || defaultWidth));
  const drag = useRef<{ left: number; width: number } | null>(null);
  function save(value: number) {
    const next = clampWidth(value);
    setWidth(next);
    localStorage.setItem(widthKey, String(next));
  }
  return <Layout.Sider className="contractor-sidebar" theme="light" width={width} collapsedWidth={64} collapsed={collapsed} trigger={null}>
    {children}
    {!collapsed && <div className="sidebar-resize" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical"
      aria-valuenow={width} aria-valuemin={192} aria-valuemax={360} tabIndex={0}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); drag.current = { left: event.clientX, width }; }}
      onPointerMove={event => { if (drag.current) setWidth(clampWidth(drag.current.width + event.clientX - drag.current.left)); }}
      onPointerUp={event => {
        if (drag.current) save(drag.current.width + event.clientX - drag.current.left);
        drag.current = null;
      }}
      onLostPointerCapture={() => { drag.current = null; }}
      onDoubleClick={() => save(defaultWidth)}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          save(width + (event.key === 'ArrowLeft' ? -12 : 12));
        }
      }} />}
  </Layout.Sider>;
}
