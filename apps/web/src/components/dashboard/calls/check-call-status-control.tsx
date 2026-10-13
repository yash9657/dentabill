'use client';

import { Button } from '@dentabill/ui';
import type * as React from 'react';

import { isLiveCallStatus, type CallDetailResponse } from '../../../lib/calls/types.js';
import { useCheckCallStatus } from '../../../lib/calls/use-check-call-status.js';
import { useMe } from '../../../lib/me/use-me.js';

export function CheckCallStatusControl({
  call,
}: {
  readonly call: CallDetailResponse;
}): React.ReactElement | null {
  const profile = useMe();
  const check = useCheckCallStatus(call.id);
  const role = profile.data?.user.role;
  if (!call.monitoring || !isLiveCallStatus(call.status) || (role !== 'OWNER' && role !== 'ADMIN'))
    return null;

  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        variant="secondary"
        disabled={check.isPending}
        aria-busy={check.isPending}
        onClick={() => {
          check.mutate();
        }}
      >
        {check.isPending ? 'Checking status…' : 'Check call status'}
      </Button>
      {check.isSuccess && check.data.callId === call.id ? (
        <p role="status" className="text-body text-gray-dark max-w-prose text-sm">
          {check.data.outcome === 'COMPLETED' || check.data.outcome === 'ESCALATED'
            ? 'Call end confirmed.'
            : 'Call-end confirmation is still pending. Review the latest status below.'}
        </p>
      ) : null}
      {check.isError ? (
        <p role="alert" className="text-body text-danger max-w-prose text-sm">
          {check.error.message}
        </p>
      ) : null}
    </div>
  );
}
