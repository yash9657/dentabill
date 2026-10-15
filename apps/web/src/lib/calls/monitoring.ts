import { isLiveCallStatus, type CallSummary } from './types.js';

export function callMonitoringLabel(
  call: Pick<CallSummary, 'status' | 'monitoring'>,
  now = Date.now(),
): 'Deadline exceeded' | 'Stop requested' | 'Stop not confirmed' | 'Status needs review' | null {
  if (!isLiveCallStatus(call.status) || !call.monitoring) return null;
  const monitoring = call.monitoring;
  if (monitoring.reviewRequiredAt) {
    return monitoring.stopRequestedAt ? 'Stop not confirmed' : 'Status needs review';
  }
  if (monitoring.stopRequestedAt) return 'Stop requested';
  if (monitoring.deadlineAt && new Date(monitoring.deadlineAt).getTime() <= now) {
    return 'Deadline exceeded';
  }
  return null;
}
