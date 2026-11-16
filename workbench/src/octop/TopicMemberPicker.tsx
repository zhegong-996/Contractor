// Adapted from TencentCloud/Octop TeamMemberPicker.tsx at bf134db. License in THIRD_PARTY_NOTICES.md.
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
        return <button type="button" className="topic-member-option" key={agent.id} aria-pressed={active}
          onClick={() => {
            if (!frozenFront) setFrozenFront(selectedSet);
            onChange(active ? selected.filter(id => id !== agent.id) : [...selected, agent.id]);
          }}>
          <Avatar value={agent.title} kind="agent" /><span><strong>{agent.title}</strong><small>{agent.owner}</small></span>
          {active && <Check aria-hidden="true" size={16} />}
        </button>;
      })}
    </div>
  </fieldset>;
}
