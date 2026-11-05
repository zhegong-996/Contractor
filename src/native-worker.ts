// A recovered Autoloop journal may already hold this native run. The native
// single-job port must acknowledge that work instead of offering it again.
export function nativeWorkGate(run: number) {
  let handed = false;
  return (request: { running?: number[]; capacity?: boolean }, settled: boolean, cancelled: boolean) => {
    if (settled) return 'wait';
    if (cancelled) return 'cancel';
    if (request.running?.includes(run)) handed = true;
    if (handed || request.capacity === false) return 'wait';
    handed = true;
    return 'offer';
  };
}
