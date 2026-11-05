import {z} from 'zod';
export const memoryAnnotation = z.object({ sourceId:z.string(), revision:z.string(),
  concepts:z.array(z.object({key:z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/),name:z.string().min(1).max(100),type:z.string().min(1).max(80),quote:z.string().min(4).max(600)}).strict()).max(24),
  relations:z.array(z.object({from:z.string(),to:z.string(),predicate:z.string().regex(/^[\p{L}_][\p{L}\p{N}_]{0,59}$/u),quote:z.string().min(4).max(600)}).strict()).max(32),
}).strict();
