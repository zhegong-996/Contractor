const statuses = new Map([
  ['queued', '排队中'], ['requested', '已请求'], ['waiting', '等待中'], ['in_progress', '运行中'], ['pending', '待运行'],
]);
const conclusions = new Map([
  ['success', '通过'], ['failure', '失败'], ['cancelled', '已取消'], ['timed_out', '超时'],
  ['neutral', '中性结果'], ['skipped', '已跳过'], ['action_required', '需要人工处理'], ['stale', '已过期'],
]);

export function checkRunLabel(status: string, conclusion?: string | null) {
  if (status !== 'completed') return statuses.get(status) ?? '等待结果';
  return conclusion ? conclusions.get(conclusion) ?? '未知结论（' + conclusion + '）' : '已结束，结论待核对';
}
