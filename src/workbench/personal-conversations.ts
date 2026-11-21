import { key } from '../../upstream/superagent/src/core/index.ts';
import { sensitiveFeishuText } from '../feishu-sources.ts';
import type { SuperAgentStore } from '../superagent-ports.ts';
import { WorkbenchError } from './errors.ts';
import type { openPersonalAgents } from './personal-agent.ts';

type PersonalAgent = Pick<ReturnType<typeof openPersonalAgents>, 'answer' | 'view'>;
type TurnInput = { conversation?: string; nonce: string; question: string };
type Turn = {
  id: string; question: string; openedAt: string; state: 'pending' | 'answered' | 'failed';
  answer: string | null; answeredAt: string | null; model: string | null; error: string | null;
};
type Conversation = { id: string; title: string; updatedAt: string; latest: number };

export function openPersonalConversations(store: Pick<SuperAgentStore, 'db' | 'atomic'>, agent: PersonalAgent) {
  const { db } = store;
  db.exec(`
    CREATE TABLE IF NOT EXISTS workbench_personal_conversation (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL, updated_at TEXT NOT NULL, latest INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS workbench_personal_conversation_index ON workbench_personal_conversation(owner,latest DESC);
    CREATE TABLE IF NOT EXISTS workbench_personal_turn (
      seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, conversation TEXT NOT NULL, question TEXT NOT NULL,
      opened_at TEXT NOT NULL, state TEXT NOT NULL, answer TEXT, answered_at TEXT, model TEXT, error TEXT
    );
    CREATE INDEX IF NOT EXISTS workbench_personal_turn_index ON workbench_personal_turn(conversation,seq DESC);
  `);
  db.prepare("UPDATE workbench_personal_turn SET state='failed', error=? WHERE state='pending'")
    .run('工作台重启，未收到这次回复。可再问一次。');
  const running = new Set<Promise<void>>();
  const requireConversation = (owner: string, id: string) => {
    const row = db.prepare('SELECT id,title,updated_at AS updatedAt,latest FROM workbench_personal_conversation WHERE owner=? AND id=?')
      .get(owner, id) as Conversation | undefined;
    if (!row) throw new WorkbenchError('找不到这个个人会话。', 404);
    return row;
  };
  function list(owner: string, before?: number) {
    const rows = db.prepare(`SELECT id,title,updated_at AS updatedAt,latest FROM workbench_personal_conversation
      WHERE owner=? ${before === undefined ? '' : 'AND latest<?'} ORDER BY latest DESC LIMIT 31`)
      .all(owner, ...(before === undefined ? [] : [before])) as Conversation[];
    return { rows: rows.slice(0, 30), next: rows.length > 30 ? rows[29]!.latest : undefined };
  }
  function history(owner: string, id: string, before?: number) {
    const conversation = requireConversation(owner, id);
    const rows = db.prepare(`SELECT seq,id,question,opened_at AS openedAt,state,answer,answered_at AS answeredAt,model,error FROM workbench_personal_turn
      WHERE conversation=? ${before === undefined ? '' : 'AND seq<?'} ORDER BY seq DESC LIMIT 31`)
      .all(id, ...(before === undefined ? [] : [before])) as (Turn & { seq: number })[];
    return { conversation, rows: rows.slice(0, 30).reverse(), next: rows.length > 30 ? rows[29]!.seq : undefined };
  }
  async function respond(owner: string, conversation: string, id: string, question: string) {
    try {
      const turns = db.prepare(`SELECT question,answer FROM workbench_personal_turn
        WHERE conversation=? AND state='answered' ORDER BY seq DESC LIMIT 8`).all(conversation) as { question: string; answer: string }[];
      const result = await agent.answer(owner, question, turns.reverse().flatMap(turn => [
        { role: 'user', content: turn.question.slice(0, 1500) },
        { role: 'assistant', content: turn.answer.slice(0, 1500) },
      ]));
      db.prepare(`UPDATE workbench_personal_turn SET state='answered',answer=?,answered_at=?,model=?
        WHERE id=? AND state='pending'`).run(result.value.answer, new Date().toISOString(), result.model.model, id);
    } catch (error) {
      db.prepare("UPDATE workbench_personal_turn SET state='failed',error=? WHERE id=? AND state='pending'")
        .run(error instanceof WorkbenchError ? error.message : '个人 Agent 暂未回复，可再问一次。', id);
    }
  }
  function send(owner: string, input: TurnInput) {
    const turn = key('personal-conversation-turn', owner, input.nonce);
    const conversation = input.conversation ?? key('personal-conversation', owner, input.nonce);
    const inserted = store.atomic(() => {
      const prior = db.prepare('SELECT conversation,question FROM workbench_personal_turn WHERE id=?').get(turn);
      if (prior) {
        if (prior.conversation !== conversation || prior.question !== input.question)
          throw new WorkbenchError('这次发送已使用，请重新输入后再发。', 409);
        return false;
      }
      if (input.conversation) requireConversation(owner, conversation);
      if (sensitiveFeishuText.test(input.question)) throw new WorkbenchError('请从消息中移除凭据或邀请链接。', 400);
      if (!agent.view(owner).enabled) throw new WorkbenchError('先为个人 Agent 保存可用的模型。', 409);
      if (db.prepare("SELECT 1 FROM workbench_personal_turn WHERE conversation=? AND state='pending'").get(conversation))
        throw new WorkbenchError('上一条消息仍在等待回复。', 409);
      const at = new Date().toISOString();
      if (!input.conversation)
        db.prepare('INSERT INTO workbench_personal_conversation (id,owner,title,updated_at) VALUES (?,?,?,?)')
          .run(conversation, owner, input.question.replace(/\s+/g, ' ').slice(0, 60), at);
      const inserted = db.prepare(`INSERT INTO workbench_personal_turn (id,conversation,question,opened_at,state)
        VALUES (?,?,?,?,'pending')`).run(turn, conversation, input.question, at);
      db.prepare('UPDATE workbench_personal_conversation SET latest=?,updated_at=? WHERE id=?')
        .run(inserted.lastInsertRowid, at, conversation);
      return true;
    });
    if (inserted) {
      const task = respond(owner, conversation, turn, input.question);
      running.add(task);
      void task.catch(() => console.error('个人会话暂未写入回复。')).finally(() => running.delete(task));
    }
    return { conversation, turn };
  }
  return { list, history, send, close: () => Promise.allSettled(running) };
}
