// Group-chat style @mention UI. Layout ideas follow LobeHub's assistant select and
// TencentCloud/Octop's team member picker (MIT), adapted to Contractor's topic roster.
import { useEffect } from 'react';
import { Check, X } from 'lucide-react';
import type { Agent } from '../api.ts';
import { Avatar } from '../ui.tsx';

export function mentionQuery(text: string, cursor: number) {
  const before = text.slice(0, cursor);
  const match = before.match(/(?:^|[\s，。！？、])(@)([^\s@]*)$/);
  if (!match) return undefined;
  return { start: match.index! + match[1].length, query: match[2] };
}

export function MentionPopover({ agents, query, index, disabled, onPick, onIndex }: {
  agents: Agent[]; query: string; index: number; disabled: boolean;
  onPick: (agent: Agent) => void; onIndex: (index: number) => void;
}) {
  const filter = query.trim().toLowerCase();
  const matches = agents.filter(agent => !filter
    || agent.title.toLowerCase().includes(filter)
    || agent.owner.toLowerCase().includes(filter)).slice(0, 8);
  useEffect(() => { if (index >= matches.length && matches.length) onIndex(0); }, [matches.length]);
  if (!matches.length) return <div className="mention-popover" role="listbox" aria-label="可提及的 Agent">
    <p className="mention-empty">{disabled ? '一次最多 @ 4 位 Agent' : '没有匹配的 Agent，换个名字试试'}</p></div>;
  return <div className="mention-popover" role="listbox" aria-label="可提及的 Agent">
    {matches.map((agent, i) => <button type="button" role="option" aria-selected={i === index} key={agent.id}
      className="mention-item" data-active={i === index || undefined} disabled={disabled}
      onMouseEnter={() => onIndex(i)} onMouseDown={event => { event.preventDefault(); onPick(agent); }}>
      <Avatar value={agent.title} kind="agent" /><span className="mention-item-text">
        <strong>{agent.title}</strong><small>{agent.owner}</small></span>
      {i === index && <Check aria-hidden="true" size={15} />}
    </button>)}
  </div>;
}

export function MentionChips({ entries, onRemove, onDevice }: {
  entries: { participant: Agent; choices: { id: string; label: string }[]; selected: string }[];
  onRemove: (id: string) => void; onDevice: (agent: string, device: string) => void;
}) {
  return <div className="mention-chips" aria-label="已提及的 Agent">
    {entries.map(({ participant, choices, selected }) => {
      return <span className="mention-chip" key={participant.id}>
        <Avatar value={participant.title} kind="agent" />
        <span className="mention-chip-name">{participant.title}</span>
        {choices.length > 1 && <select aria-label={participant.title + ' · 执行设备'} value={selected}
          onChange={event => onDevice(participant.id, event.target.value)}>
          {choices.map(choice => <option value={choice.id} key={choice.id}>{choice.label}</option>)}
        </select>}
        <button type="button" aria-label={'移除 ' + participant.title} onClick={() => onRemove(participant.id)}><X size={13} /></button>
      </span>;
    })}
  </div>;
}
