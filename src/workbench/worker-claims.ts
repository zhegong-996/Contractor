import type { Job } from './execution/protocol.ts';
import type { WorkerHub } from './execution/protocol.ts';
import { workerName, type ExecutionHub, type Run } from './execution/contract.ts';
import { trackWorkerProcesses } from './worker-process.ts';
import { isRemoteDevice, type Device, type DeviceJob, type Devices, type ReleasedLease } from './devices.ts';

type WorkResponse = { job?: DeviceJob | null; cancel?: number[]; release?: ReleasedLease };
type ClaimRules = {
  affected: (run: Run, device?: Device) => boolean;
  cancelUnknown: (run: Run, id: number, device?: Device) => boolean;
  mayRedeliver: (run: Run, device: Device) => boolean;
  eligible: (run: { lane: string; rule: string }, device?: Device, engines?: Parameters<WorkerHub['work']>[0]['engines']) => boolean;
  pendingLanes: () => Set<string>;
  homeForRun: (id: number) => string | undefined;
};

/** The runtime owns lease state. The caller supplies Contractor authority at each gate. */
export function workerClaims(hub: Pick<ExecutionHub, 'heartbeat' | 'cancels' | 'claimNext' | 'cards' | 'run' | 'cancel'>,
  devices: Devices, signal: AbortSignal, rules: ClaimRules, worker = workerName) {
  const readRun = (id: number) => hub.run(id);
  return function claim(request: Parameters<WorkerHub['work']>[0], device?: Device): { claimed: Job } | WorkResponse {
    const running = (request.running ?? []).filter(id => devices.leasedTo(id) === device?.id);
    if (device) devices.heartbeat(device.id, true, request.capacity !== false || running.length > 0,
      device.worker?.engines.filter(engine => request.engines?.includes(engine)));
    if (!isRemoteDevice(device)) for (const id of running) trackWorkerProcesses(id, false, rules.homeForRun(id));
    hub.heartbeat(worker, running);
    for (const id of running) {
      const run = readRun(id);
      if (run?.state === 'claimed' && !run.cancel_at && rules.affected(run, device)) hub.cancel(id);
    }
    const cancel = [...new Set([...hub.cancels(worker).filter(id => devices.leasedTo(id) === device?.id), ...running.filter(id => {
      const run = readRun(id);
      return run?.state === 'unknown' && rules.cancelUnknown(run, id, device);
    })])];
    if (!isRemoteDevice(device)) for (const id of cancel) {
      if (!trackWorkerProcesses(id, true, rules.homeForRun(id))) console.error('Contractor 等待核对受托执行的进程谱系');
    }
    if (signal.aborted || running.length) return { cancel };
    const held = device && devices.held(device.id);
    if (device && held) {
      const run = readRun(held.run);
      if (run?.state === 'claimed' || run?.state === 'unknown') {
        if (held.job && (isRemoteDevice(device) || request.claim === held.claim) && device.active && run.state === 'claimed' && !run.cancel_at
          && rules.mayRedeliver(run, device)) return request.capacity === false
            || device.worker && !request.engines?.some(engine => engine === held.job?.agent.use) ? { cancel } : { job: held.job };
        return isRemoteDevice(device) && held.lease ? { release: { run: held.run, attempt: held.attempt, lease: held.lease } } : { cancel };
      }
      devices.clear(device.id, held.run, held.attempt);
    }
    if (request.capacity === false || device && !device.active || cancel.length) return { cancel };
    const unsettled = rules.pendingLanes();
    const job = hub.claimNext(worker, request.claim, run => !unsettled.has(run.lane) && rules.eligible(run, device, request.engines));
    if (!job) return {};
    if (device) devices.hold(device.id, request.claim, job);
    devices.bindRun(job.run, job.attempt, device?.id);
    // Scope even legacy group-wide card views to this delegation.
    const lane = hub.run(job.run)?.lane;
    const openInLane = new Set(lane ? hub.cards(lane).filter(card => card.rule === job.rule.name).map(card => card.id) : []);
    job.context.open = job.context.open.filter(card => openInLane.has(card.card));
    return { claimed: job };
  };
}
