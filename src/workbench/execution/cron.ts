const minute = 60_000;
const day = 1440 * minute;
// Project digest schedules use Asia/Shanghai. Its UTC offset is fixed for our operating dates.
const shanghai = 480 * minute;

function values(field: string, min: number, max: number) {
  const result = new Set<number>();
  for (const section of field.split(',')) {
    const parts = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(section);
    if (!parts || parts[1] === '*' && parts[2]) throw new Error('群整理排程字段无效');
    const start = parts[1] === '*' ? min : Number(parts[1]);
    const end = parts[2] ? Number(parts[2]) : parts[1] === '*' || parts[3] ? max : start;
    const step = Number(parts[3] ?? 1);
    if (start < min || end > max || end < start || step < 1 || !Number.isSafeInteger(step))
      throw new Error('群整理排程字段超出范围');
    for (let number = start; number <= end; number += step) result.add(number);
  }
  return [...result].sort((a, b) => a - b);
}

export function digestSchedule(expression: string) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('群整理排程须包含五个字段');
  const minutes = values(parts[0]!, 0, 59);
  const hours = values(parts[1]!, 0, 23);
  const dates = values(parts[2]!, 1, 31);
  const months = values(parts[3]!, 1, 12);
  const weekdays = values(parts[4]!, 0, 7).map(number => number % 7);
  const both = parts[2]!.startsWith('*') || parts[4]!.startsWith('*');
  const times = hours.flatMap(hour => minutes.map(value => (hour * 60 + value) * minute));
  function find(anchor: number, direction: 1 | -1) {
    const start = Math.floor((anchor + shanghai) / day) * day;
    for (let cursor = 0; cursor < 366 * 8; cursor++) {
      const date = new Date(start + cursor * direction * day);
      if (!months.includes(date.getUTCMonth() + 1)) continue;
      const dateMatches = dates.includes(date.getUTCDate());
      const weekdayMatches = weekdays.includes(date.getUTCDay());
      if (!(both ? dateMatches && weekdayMatches : dateMatches || weekdayMatches)) continue;
      const at = date.getTime() - shanghai;
      const time = direction === 1 ? times.find(time => at + time > anchor) : times.findLast(time => at + time <= anchor);
      if (time !== undefined) return at + time;
    }
  }
  return { next: (at: number) => find(at, 1), latest: (at: number) => find(at, -1) };
}

export function describeDigestSchedule(expression: string) {
  const [minute, hour, date, month, weekday] = expression.trim().split(/\s+/);
  const numeric = /^\d+$/;
  if (month !== '*' || !numeric.test(minute ?? '') || !numeric.test(hour ?? '')) return expression;
  const time = hour!.padStart(2, '0') + ':' + minute!.padStart(2, '0');
  if (date === '*' && weekday === '*') return '每天 ' + time;
  if (date === '*' && weekday === '1-5') return '工作日 ' + time;
  if (date === '*' && numeric.test(weekday ?? '')) return '每周' + '日一二三四五六'[Number(weekday) % 7] + ' ' + time;
  if (weekday === '*' && numeric.test(date ?? '')) return '每月 ' + Number(date) + ' 日 ' + time;
  return expression;
}
