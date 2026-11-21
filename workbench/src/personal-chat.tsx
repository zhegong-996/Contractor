import { useLayoutEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowLeft, Bot, MessageSquare, Plus, Send, Settings2 } from 'lucide-react';
import type { Collaboration } from '../../src/workbench/collaboration.ts';
import { api, part, uid, useData, type Overview } from './api.ts';
import { Button } from './components/button.tsx';
import { TextArea } from './components/input.tsx';
import { Markdown } from './markdown.tsx';
import { personalChatRoute } from './navigation.ts';
import { Avatar, date, Empty, Failure, Loading, useActions, useStored } from './ui.tsx';

type Directory = ReturnType<Collaboration['personalConversations']>;
type History = ReturnType<Collaboration['personalConversation']>;
type Profile = ReturnType<Collaboration['personalAgent']>;

function useChatPages<T extends { next?: number }>(url: string, interval: number) {
  return useInfiniteQuery({
    queryKey: [url], enabled: !!url, initialPageParam: undefined as number | undefined,
    queryFn: ({ signal, pageParam }) => api<T>(url + (pageParam ? '?before=' + pageParam : ''), undefined, signal),
    getNextPageParam: page => page.next, refetchInterval: interval, retry: false,
  });
}

export function PersonalChatPage({ workspace, project, conversation }: { workspace: Overview; project?: string; conversation?: string }) {
  const directory = useChatPages<Directory>('personal-chat', 8000);
  const entries = [...new Map(directory.data?.pages.flatMap(page => page.rows.map(row => [row.id, row] as const))).values()];
  const profile = useData<Profile>('account/personal-agent', 4500);
  const [newChat, start] = useState(false);
  const showComposer = !!conversation || newChat;
  return <div className="split chat-split personal-chat" data-has-detail={showComposer}>
    <aside className="split-list conversation-directory" aria-label="个人会话历史">
      <div className="list-header"><div className="list-title"><h2>个人会话</h2>
        <Button size="sm" variant="outline" onClick={() => { start(true); window.location.hash = personalChatRoute(undefined, project); }}>
          <Plus />新会话
        </Button>
      </div></div>
      <div className="list-scroll">
        {directory.error ? <Failure error={directory.error} retry={() => void directory.refetch()} /> : directory.isPending ? <Loading />
          : entries.length ? entries.map(row => <a className="list-item" href={personalChatRoute(row.id, project)} key={row.id}
            aria-current={conversation === row.id ? 'page' : undefined} onClick={() => start(false)}>
            <div className="list-item-top"><MessageSquare size={16} /><strong>{row.title}</strong></div>
            <div className="list-item-meta"><time>{date(row.updatedAt)}</time></div></a>)
            : <Empty title="还没有个人会话" icon={<MessageSquare />} />}
        {directory.hasNextPage && <Button size="sm" variant="outline" disabled={directory.isFetching}
          onClick={() => void directory.fetchNextPage()}>加载更早会话</Button>}
      </div>
    </aside>
    <div className="split-detail chat-detail">
      <header className="chat-heading">
        <div className="chat-heading-title">
          <a className="chat-back" href={personalChatRoute(undefined, project)} onClick={() => start(false)} aria-label="返回个人会话列表"><ArrowLeft size={17} /></a>
          <Avatar kind="agent" value={profile.data?.title ?? '个人 Agent'} />
          <div><h1>{profile.data?.title ?? '个人 Agent'}</h1>
            <div className="inline-meta">{profile.data?.selection?.model && <span>{profile.data.selection.model}</span>}<span>仅本人可见</span></div>
          </div>
        </div>
        <a className="text-button" href="#/account?tab=agent"><Settings2 size={16} />配置 Agent</a>
      </header>
      {profile.error && <Failure error={profile.error} retry={() => void profile.refetch()} />}
      <PersonalChatThread key={conversation ?? 'new'} {...{ workspace, project, conversation }} profile={profile.data} loadingProfile={profile.isPending}
        openNew={() => start(true)} />
    </div>
  </div>;
}

function PersonalChatThread({ workspace, project, conversation, profile, loadingProfile, openNew }: {
  workspace: Overview; project?: string; conversation?: string; profile?: Profile; loadingProfile: boolean; openNew: () => void;
}) {
  const data = useChatPages<History>(conversation ? 'personal-chat/' + part(conversation) : '', 2000);
  const [initial] = useState(() => ({ text: '', nonce: uid() }));
  const [draft, setDraft] = useStored('personal-chat-draft:' + workspace.actor + ':' + (conversation ?? 'new'), initial);
  const { busy, run } = useActions();
  const scroll = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const rounds = data.error ? [] : [...new Map(data.data?.pages.slice().reverse().flatMap(page => page.rows.map(row => [row.id, row] as const))).values()];
  const last = rounds.at(-1);
  const waiting = last?.state === 'pending';
  useLayoutEffect(() => {
    if (stick.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [last?.id, last?.state]);
  const author = workspace.actorProfile?.displayName ?? workspace.actor;
  return <div className="conversation-desk personal-chat-thread">
    <div className="conversation-scroll" ref={scroll} onScroll={event => {
      const panel = event.currentTarget;
      stick.current = panel.scrollHeight - panel.clientHeight - panel.scrollTop < 64;
    }}>
      {conversation && data.error ? <Failure error={data.error} retry={() => void data.refetch()} />
        : conversation && data.isPending || !conversation && loadingProfile ? <Loading />
        : !rounds.length && <Empty title={profile?.enabled ? '与个人 Agent 对话' : '先为个人 Agent 配置模型'} icon={<Bot />}
          action={!profile?.enabled && profile ? <a className="text-button" href="#/account?tab=agent">前往配置</a> : undefined} />}
      <div className="timeline" aria-label="聊天记录">
        {data.hasNextPage && <Button size="sm" variant="ghost" className="self-start" disabled={data.isFetchingNextPage}
          onClick={async () => {
            const height = scroll.current?.scrollHeight ?? 0;
            const top = scroll.current?.scrollTop ?? 0;
            stick.current = false;
            await data.fetchNextPage();
            requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop = top + scroll.current.scrollHeight - height; });
          }}>加载更早消息</Button>}
        {rounds.map(turn => <div className="personal-chat-turn" key={turn.id}>
          <article className="timeline-entry member-message"><Avatar avatar={workspace.actorProfile?.avatar} value={author} />
            <div className="message"><div className="message-meta"><strong>{author}</strong><time>{date(turn.openedAt)}</time></div>
              <Markdown text={turn.question} /></div></article>
          <article className="timeline-entry"><Avatar kind="agent" value={profile?.title ?? '个人 Agent'} />
            <div className="message"><div className="message-meta"><strong>{profile?.title ?? '个人 Agent'}</strong>
              {turn.model && <span>{turn.model}</span>}{turn.answeredAt && <time>{date(turn.answeredAt)}</time>}</div>
              {turn.state === 'answered' && turn.answer ? <Markdown text={turn.answer} /> : turn.state === 'pending'
                ? <p className="muted-text" role="status">正在回复</p> : <div className="actions">
                  <p className="muted-text">{turn.error ?? '暂未收到回复'}</p>
                  {turn.id === last?.id && <Button size="sm" variant="outline" onClick={() => setDraft({ text: turn.question, nonce: uid() })}>再问一次</Button>}
                </div>}
            </div></article>
        </div>)}
      </div>
    </div>
    {(!conversation || !!data.data && !data.error) && <form className="form conversation-composer" onSubmit={async event => {
      event.preventDefault();
      if (!draft.text.trim() || !profile?.enabled || waiting || busy) return;
      stick.current = true;
      const next = await run(() => api<ReturnType<Collaboration['sendPersonalMessage']>>('personal-chat', {
        conversation, nonce: draft.nonce, question: draft.text.trim(),
      }));
      if (next) {
        setDraft({ text: '', nonce: uid() });
        openNew();
        if (next.conversation !== conversation) window.location.hash = personalChatRoute(next.conversation, project);
      }
    }}>
      <TextArea aria-label="发给我的 Agent" placeholder="输入消息…" rows={3} value={draft.text} maxLength={3000}
        disabled={!profile?.enabled} onChange={event => setDraft({ text: event.target.value, nonce: uid() })} />
      <div className="form-actions"><span className="personal-context-note">续聊参考最近 8 轮，历史可向前翻阅</span>
        <Button size="sm" type="submit" disabled={busy || waiting || !profile?.enabled || !draft.text.trim()}><Send />发送</Button></div>
    </form>}
  </div>;
}
