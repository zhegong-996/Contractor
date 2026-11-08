// 生产项 P-1 · 把两个宿主入口的常驻 while 抽成可替换的泵（第二十二轮）。
//
// 改造前：runner.ts / assistant-runner.ts 各自写一段
//   while (!settled) { await worker.tick(); ...; await sleep(250) }
// 循环、会话状态（settled / journal / receipt）与执行环境全在一个进程里。
//
// 改造后：默认 `loop` 走 driveLegacyLoop，逐字等价、可随时回退；配置
// `execution.mode=step` 时走 driveSteppedPump，每一次 tick 由状态外置队列
// 领取一步、把会话快照写回 checkpoint、再原子激活下一棒。进程随时可以换成
// 另一台机器上的 step:once，因为它不持有跨步状态。
import type { Config } from './config.ts';
import {
  driveSteppedLoop, PgStepQueue, type StepQueue, type StepState,
} from './step-execution.ts';

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** 与改造前逐字等价：一次 tick + 一次可选回调 + 未结束才 sleep。 */
export async function driveLegacyLoop(input: {
  tick: () => Promise<void> | void;
  settled: () => boolean;
  onTick?: () => Promise<void> | void;
  intervalMs?: number;
}): Promise<{ ticks: number }> {
  let ticks = 0;
  while (!input.settled()) {
    await input.tick();
    ticks += 1;
    if (input.onTick) await input.onTick();
    if (!input.settled()) await sleep(input.intervalMs ?? 250);
  }
  return { ticks };
}

export type SteppedPumpResult = {
  steps: number; modelCalls: number; stoppedBy: string;
  environments: string[]; failure?: string; states: StepState[];
};

/**
 * 单步泵。注意这里的粒度：一次独立调用 = 一次 worker.tick()，状态的读写都走
 * 队列。autoloop worker 内部一次 tick 若触发多次模型 / 工具子调用，尚未逐次
 * 拆分（见 executionView().missing），不假装已经做到「每次子调用一步」。
 */
export async function driveSteppedPump(input: {
  config: Config;
  queue?: StepQueue;
  runId: string;
  taskId: string;
  principal: string;
  scope?: string | null;
  tick: () => Promise<void> | void;
  settled: () => boolean;
  /** 会话状态只能从这里写进队列，不允许留在进程内存里跨步持有。 */
  snapshot: () => Record<string, unknown>;
}): Promise<SteppedPumpResult> {
  const queue = input.queue ?? PgStepQueue.fromConfig(input.config);
  const handlers = {
    'worker-tick': async () => {
      await input.tick();
      const settled = input.settled();
      return {
        result: { settled, taskId: input.taskId },
        checkpoint: { ...input.snapshot(), taskId: input.taskId, settled },
        ...(settled ? {} : { next: { kind: 'worker-tick', payload: { taskId: input.taskId } } }),
        modelCalls: 0,
      };
    },
  };
  try {
    const drive = await driveSteppedLoop({ queue, runId: input.runId, principal: input.principal,
      scope: input.scope ?? null, maxSteps: input.config.execution.maxStepsPerRun,
      first: { kind: 'worker-tick', payload: { taskId: input.taskId } }, handlers,
      worker: stepNo => ({ workerId: `step-worker-${stepNo}`, environment: '本机执行环境' }) });
    const states = await queue.runState(input.runId);
    return { ...drive, states };
  } finally {
    if (!input.queue && queue instanceof PgStepQueue) await queue.close();
  }
}
