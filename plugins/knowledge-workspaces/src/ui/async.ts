// 统一的前端异步契约：只读 action 的加载/错误状态机，以及写操作的就地反馈。

import { useCallback, useEffect, useState } from 'react';

/** 按 action + 参数变化自动重取；卸载后不再写状态。v0.6 面板与业务视图共用。 */
export function useRead<T = any>(ui: { read: (name: string, payload: any) => Promise<T> }, action: string, payload: any) {
  const key = action + ':' + JSON.stringify(payload ?? {});
  const [state, setState] = useState<{ value?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let active = true;
    setState({ loading: true });
    void ui.read(action, payload ?? {}).then(value => { if (active) setState({ value, loading: false }); })
      .catch((error: any) => { if (active) setState({ error: String(error?.message ?? error), loading: false }); });
    return () => { active = false; };
  }, [key]);
  return state;
}

/** 写操作统一反馈：失败就地给中文提示，成功才执行清理回调，不再静默吞掉异常。 */
export function useActionFeedback() {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const send = useCallback(async <T,>(task: () => Promise<T>, onSuccess?: (value: T) => void): Promise<T | undefined> => {
    setError(''); setBusy(true);
    try { const value = await task(); onSuccess?.(value); return value; }
    catch (e: any) { setError(String(e?.message ?? e)); return undefined; }
    finally { setBusy(false); }
  }, []);
  return { error, setError, busy, send };
}
