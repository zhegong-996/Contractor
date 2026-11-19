import { z } from 'zod';

export const octopIMKind = z.enum(['telegram', 'discord', 'wecom', 'qq', 'dingtalk', 'weixin']);
export const octopIMNativeId = z.string().regex(/^[^\x00-\x20\x7f]{1,180}$/);
const connectorId = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
export const octopIMConnector = z.object({
  id: connectorId, kind: octopIMKind, credential: connectorId, allowAccountBinding: z.boolean().optional(),
  routes: z.array(z.object({ chat: octopIMNativeId, thread: octopIMNativeId.optional(),
    project: connectorId, topic: connectorId }).strict()).min(1).max(64),
}).strict();
export type OctopIMConnector = z.infer<typeof octopIMConnector>;

export const octopIMAddress = z.object({ connector: connectorId, kind: octopIMKind,
  chat: octopIMNativeId, thread: octopIMNativeId.optional(), message: octopIMNativeId,
  sender: octopIMNativeId, direct: z.boolean(),
  // QQ routes channel, C2C and group traffic through distinct native APIs.
  qqRoute: z.enum(['channel', 'group', 'c2c', 'direct']).optional(),
}).strict();
export type OctopIMAddress = z.infer<typeof octopIMAddress>;
export const octopIMEvent = z.object({ address: octopIMAddress, text: z.string().min(1).max(4000), at: z.iso.datetime() }).strict();
export type OctopIMEvent = z.infer<typeof octopIMEvent>;
export type OctopConsultationCard = { delivery: string; url: string };
export const octopIMDeliveryForm = z.enum(['card', 'markdown']);
export type OctopIMDeliveryForm = z.infer<typeof octopIMDeliveryForm>;
export type OctopIMTransport = {
  ready(address: OctopIMAddress): boolean;
  send(address: OctopIMAddress, text: string, card?: OctopConsultationCard, delivery?: string): Promise<OctopIMDeliveryForm | void>;
};

export function octopIMRoute(connectors: OctopIMConnector[] | undefined, address: OctopIMAddress) {
  const connector = connectors?.find(row => row.id === address.connector && row.kind === address.kind);
  return connector?.routes.find(row => row.chat === address.chat && row.thread === address.thread);
}

export function octopIMCanReply(address: OctopIMAddress) {
  return ['telegram', 'discord', 'wecom', 'qq', 'dingtalk'].includes(address.kind);
}
