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
server.registerTool('professional_workspaces', { description: '读取专业知识目录、自己的跨岗位任务和访问申请；受限内容按当前身份过滤', inputSchema: {} },
  () => output(api('/workspace/view', {}, agent)));
server.registerTool('read_task_context', { description: '读取当前任务的目标、背景、专业证据、版本、检查点、关联GitHub交付、缺口和截断范围；每次核对资源权限', inputSchema: { taskId: z.string() } },
  data => output(api('/workspace/context-pack', data, agent)));
server.registerTool('read_context_record', { description: '按需读取本任务背景或检查点全文；重查当前来源权限，不从旧摘要绕过撤权', inputSchema: { taskId: z.string(), recordId: z.string() } },
  data => output(api('/workspace/context-record', data, agent)));
server.registerTool('read_knowledge_graph', { description: '读取本任务获准且已确认的知识版本图谱；每次重新核对原生授权、版本和任务状态', inputSchema: { taskId: z.string(), sourceId: z.string(), revision: z.string() } },
  data => output(api('/workspace/knowledge-graph', data, agent)));
server.registerTool('search_task_context', { description: '在当前执行身份本来可读且已确认的知识中检索；不使用管理员权限搜索其他参与者私有正文', inputSchema: { taskId: z.string(), query: z.string().max(5000) } },
  data => output(api('/workspace/context-search', data, agent)));
server.registerTool('expand_authorized_context', { description: '扩展已获准长资料的读取范围；不改变资料授权，受本任务上下文预算限制', inputSchema: { taskId: z.string(), sourceId: z.string() } },
  data => output(api('/workspace/context-expand', data, agent)));
server.registerTool('request_material_access', { description: '为自己的当前协作任务申请指定资料；审批前不授予读取能力',
  inputSchema: { taskId: z.string(), sourceId: z.string(), purpose: z.string(), hours: z.number().min(1 / 60).max(168).default(8), requestKey: z.string() } },
  data => output(api('/workspace/request', data, agent)));
server.registerTool('read_authorized_material', { description: '读取本任务获准使用的资料；每次重新核对原生权限、期限和任务范围',
  inputSchema: { taskId: z.string(), sourceId: z.string() } }, data => output(api('/workspace/read-source', data, agent)));
server.registerTool('propose_professional_knowledge', { description: '根据当前任务提出受限知识候选，保留资料依赖；由人确认和决定共享范围',
  inputSchema: { taskId: z.string(), record: knowledgeInput } }, data => output(api('/workspace/propose', data, agent)));
server.registerTool('acknowledge_stopped_execution', { description: '原执行端在停止所有写入后回传停止确认；撤权后不回传成果，只结束未知执行状态',
  inputSchema: { taskId: z.string(), lease: z.string().uuid(), note: z.string().min(1), confirmed: z.literal(true) } },
  data => output(api('/workspace/stopped', data, agent)));
await server.connect(new StdioServerTransport());
