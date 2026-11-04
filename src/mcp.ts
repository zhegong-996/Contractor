import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { api } from './client.ts';
import { knowledgeInput } from './knowledge.ts';
const agent = process.env.COLLAB_AGENT;
if (!agent) throw new Error('Set COLLAB_AGENT to the configured external agent identity');
const server = new McpServer({ name: 'suitme-collab', version: '0.1.0' });
const output = async (work: Promise<unknown>) => {
  try { return { content: [{ type: 'text' as const, text: JSON.stringify(await work) }] }; }
  catch (error) { return { isError: true, content: [{ type: 'text' as const, text: String(error) }] }; }
};
server.registerTool('list_tasks', { description: '读取分配给当前协作身份的任务', inputSchema: {} }, () => output(api('/tasks', undefined, agent)));
server.registerTool('read_task', { description: '读取任务交接包、代码目录与交付状态', inputSchema: { taskId: z.string() } }, ({ taskId }) => output(api(`/tasks/${taskId}`, undefined, agent)));
server.registerTool('claim_task', { description: '领取一个任务。重复调用使用同一个 lease；不允许抢占其他执行者', inputSchema: { taskId: z.string(), lease: z.string().uuid() } },
  ({ taskId, lease }) => output(api(`/tasks/${taskId}/claim`, { lease }, agent)));
server.registerTool('submit_checkpoint', { description: '提交本轮成果或等待人答复的 Autoloop 回执；不代表业务验收通过',
  inputSchema: { taskId: z.string(), lease: z.string().uuid(), receiptId: z.string().uuid(), text: z.string(), session: z.string().optional() } },
  ({ taskId, ...receipt }) => output(api(`/tasks/${taskId}/receipt`, { ...receipt, agent }, agent)));
server.registerTool('publish_delivery', { description: '由后台校验范围后把已完成改动交付到项目配置的 GitHub 仓库', inputSchema: { taskId: z.string() } },
  ({ taskId }) => output(api(`/tasks/${taskId}/publish`, {}, agent)));
server.registerTool('propose_knowledge', { description: '将本任务的专业结论沉淀为候选知识。确认后才可跨任务引用', inputSchema: { taskId: z.string(), record: knowledgeInput } },
  ({ taskId, record }) => output(api(`/tasks/${taskId}/knowledge-propose`, record, agent)));
await server.connect(new StdioServerTransport());
