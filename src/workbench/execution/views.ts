import type { Card, ConfirmedCard, ExecutionHub, Run } from './contract.ts';

export function executionViews(db: {
  all<T>(sql: string, params?: (string | number)[]): T[];
  one<T>(sql: string, params?: (string | number)[]): T | undefined;
}): Pick<ExecutionHub, 'run' | 'runs' | 'card' | 'cards' | 'confirmed' | 'timers' | 'nextSchedule'> {
  return {
    run: id => db.one<Run>('SELECT id,lane,rule,state,session,usage,summary,cancel_at,attempts,not_before,claimed_at,finished_at FROM runs WHERE id=?', [id]),
    runs: (lane, includeHandoffs) => db.all<Run>(`SELECT id,lane,rule,state,session,usage,summary,cancel_at,attempts,not_before,claimed_at,finished_at
      FROM runs WHERE lane=? ${includeHandoffs ? 'OR lane GLOB ?' : ''} ORDER BY id`, includeHandoffs ? [lane, lane + ':*'] : [lane]),
    cards: (lane, kind) => db.all<Card>(`SELECT id,title,text,options,state,choice,answer,lane,run_id,rule,kind,by,decided_at,created_at FROM cards
      WHERE lane=? ${kind ? 'AND kind=?' : ''} ORDER BY id`, kind ? [lane, kind] : [lane]),
    card: id => db.one<Card>('SELECT id,title,text,options,state,choice,answer,lane,run_id,rule,kind,by,decided_at,created_at FROM cards WHERE id=?', [id]),
    confirmed: lane => db.all<ConfirmedCard>(`SELECT id,title,text,options,state,choice,answer,lane,run_id,rule,kind,by,decided_at,created_at FROM cards
      WHERE (lane=? OR lane GLOB ?) AND kind='ask' AND state IN ('decided','done') ORDER BY id`, [lane, lane + ':*']),
    timers: lane => db.all('SELECT id,at FROM timers WHERE lane=? AND event_id IS NULL ORDER BY at', [lane]),
    nextSchedule: rule => db.one<{ next_at: string }>('SELECT next_at FROM schedules WHERE rule=?', [rule])?.next_at,
  };
}
