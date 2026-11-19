import { Drawer } from 'antd';
import type { ReactNode } from 'react';
import { Button } from './button.tsx';
import { FormError, useActions } from '../ui.tsx';

export function SettingsDrawer({ title, children, close, submit, extra, wide = false }: {
  title: string;
  children: ReactNode;
  close: () => void;
  submit?: { form: string; label: string; disabled?: boolean; danger?: boolean };
  extra?: ReactNode;
  wide?: boolean;
}) {
  const { busy, clearError } = useActions();
  const dismiss = () => { if (!busy) { clearError(); close(); } };
  return <Drawer title={title} open onClose={dismiss} closable={!busy} keyboard={!busy} getContainer="#app"
    className="settings-drawer" mask={{ closable: false }} size={wide ? 640 : 500} footer={<div className="settings-drawer-footer">
      {extra}<Button variant="outline" disabled={busy} onClick={dismiss}>{submit ? '取消' : '关闭'}</Button>
      {submit && <Button type="submit" form={submit.form} loading={busy} disabled={submit.disabled}
        variant={submit.danger ? 'destructive' : 'default'}>{submit.label}</Button>}
    </div>}>
    <FormError />{children}
  </Drawer>;
}
