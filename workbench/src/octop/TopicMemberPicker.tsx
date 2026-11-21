// Adapted from TencentCloud/Octop (MIT), bf134dbd379036ce7545c7df1a1da7e381ece9ff, dashboard/src/pages/Experts/components/TeamMemberPicker.tsx.
import { useState } from 'react';
import { Check } from 'lucide-react';
import type { Agent } from '../api.ts';
import { Avatar } from '../ui.tsx';

/** Preserve selection order and discard duplicates and members no longer eligible. */
export function selectedRosterIds(value: string[], agents: Agent[]): string[] {
  const allowed = new Set(agents.map(agent => agent.id));
  return [...new Set(value.filter(id => allowed.has(id)))];
}

export function TopicMemberPicker({ value, onChange, agents }: {
  value: string[]; onChange: (next: string[]) => void; agents: Agent[];
}) {
  const selected = selectedRosterIds(value, agents);
  const selectedSet = new Set(selected);
  const [frozenFront, setFrozenFront] = useState<Set<string>>();
  const front = frozenFront ?? selectedSet;
  const visible = [...agents]
    .sort((left, right) => Number(front.has(right.id)) - Number(front.has(left.id)) || left.title.localeCompare(right.title));
  return <fieldset className="topic-members"><legend>咨询 Agent</legend>
    <div className="topic-member-options">
      {visible.map(agent => {
        const active = selectedSet.has(agent.id);
        return <button type="button" className="topic-member-option" key={agent.id} aria-pressed={active} disabled={!active && selected.length >= 4}
          onClick={() => {
            if (!frozenFront) setFrozenFront(selectedSet);
            onChange(active ? selected.filter(id => id !== agent.id) : [...selected, agent.id]);
          }}>
          <Avatar value={agent.title} kind="agent" /><span><strong>{agent.title}</strong><small>{agent.owner}</small></span>
          {active && <Check aria-hidden="true" size={16} />}
        </button>;
      })}
    </div>
    {selected.length >= 4 && <small className="muted-text">每次最多选择 4 位 Agent</small>}
  </fieldset>;
}
