import { Tag } from 'antd';
import type { ReactNode } from 'react';

export function Badge({ children, className }: { children?: ReactNode; className?: string }) {
  return <Tag bordered={false} className={className}>{children}</Tag>;
}
