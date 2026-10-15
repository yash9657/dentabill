import { Loader2, Phone } from 'lucide-react';

import { C, FONT_BODY } from '../theme';

export interface ClaimRow {
  readonly patient: string;
  readonly payer: string;
  readonly procedure: string;
  readonly date: string;
  readonly billed: string;
  readonly result: { readonly status: 'Pending review' | 'Paid' | 'Denied'; readonly next: string };
}

/** Synthetic claims; results mirror packages/payer-ivr/src/retell/demo-scenarios.ts. */
export const CLAIMS: readonly ClaimRow[] = [
  {
    patient: 'Rosa Alvarez',
    payer: 'Delta Dental PPO',
    procedure: 'D2740 · Crown',
    date: 'Sep 18',
    billed: '$1,180',
    result: { status: 'Pending review', next: 'Follow up Oct 28' },
  },
  {
    patient: 'James Okafor',
    payer: 'Delta Dental PPO',
    procedure: 'D1110 · Cleaning',
    date: 'Sep 22',
    billed: '$142',
    result: { status: 'Paid', next: 'Payment released' },
  },
  {
    patient: 'Mei Lin',
    payer: 'Cigna Dental',
    procedure: 'D4341 · Root planing',
    date: 'Sep 10',
    billed: '$286',
    result: { status: 'Denied', next: 'Appeal with chart notes' },
  },
  {
    patient: 'Daniel Brooks',
    payer: 'Cigna Dental',
    procedure: 'D2392 · Filling',
    date: 'Sep 25',
    billed: '$214',
    result: { status: 'Paid', next: 'Remittance Friday' },
  },
  {
    patient: 'Aisha Khan',
    payer: 'MetLife Dental',
    procedure: 'D3330 · Root canal',
    date: 'Sep 3',
    billed: '$1,040',
    result: { status: 'Pending review', next: 'Call back after review' },
  },
  {
    patient: 'Tom Becker',
    payer: 'MetLife Dental',
    procedure: 'D7140 · Extraction',
    date: 'Sep 12',
    billed: '$260',
    result: { status: 'Denied', next: 'Bill the patient' },
  },
];

export type RowState = 'open' | 'calling' | 'done';

export interface RowView {
  /** 0 → hidden, 1 → in place. */
  readonly enter: number;
  readonly state: RowState;
  /** 0..1 flip progress for the result chip. */
  readonly flip?: number;
  readonly hover?: boolean;
  readonly pressed?: number;
}

export const ROW_H = 76;
export const TABLE_TOP = 150;
const cols = '1.25fr 1.25fr 1.35fr 0.7fr 0.7fr 1.55fr';

export function StatusChip({
  status,
}: {
  readonly status: ClaimRow['result']['status'] | 'Open';
}): React.ReactElement {
  const tone =
    status === 'Paid'
      ? [C.successSoft, C.success]
      : status === 'Denied'
        ? [C.dangerSoft, C.danger]
        : status === 'Pending review'
          ? [C.warningSoft, C.warning]
          : [C.canvas, C.grayDark];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 12px',
        borderRadius: 99,
        background: tone[0],
        color: tone[1],
        fontSize: 15,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 9, background: tone[1] }} />
      {status}
    </span>
  );
}

export function ClaimsTable({
  rows,
  spin,
}: {
  readonly rows: readonly RowView[];
  readonly spin: number;
}): React.ReactElement {
  return (
    <div
      style={{ position: 'absolute', left: 48, right: 48, top: TABLE_TOP, fontFamily: FONT_BODY }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: cols,
          padding: '0 22px 12px',
          fontSize: 14,
          fontWeight: 500,
          color: C.grayWarm,
        }}
      >
        <span>Patient</span>
        <span>Payer</span>
        <span>Procedure</span>
        <span>Service</span>
        <span>Billed</span>
        <span>Status</span>
      </div>
      <div
        style={{
          background: C.white,
          borderRadius: 16,
          border: `1px solid ${C.borderSubtle}`,
          overflow: 'hidden',
        }}
      >
        {CLAIMS.map((claim, i) => {
          const v = rows[i] ?? { enter: 0, state: 'open' as const };
          return (
            <div
              key={claim.patient}
              style={{
                display: 'grid',
                gridTemplateColumns: cols,
                alignItems: 'center',
                height: ROW_H,
                padding: '0 22px',
                fontSize: 17,
                borderTop: i === 0 ? 'none' : `1px solid ${C.borderSubtle}`,
                background: v.hover ? '#f3f7f2' : C.white,
                opacity: v.enter,
                transform: `translateY(${(1 - v.enter) * 24}px)`,
              }}
            >
              <span style={{ fontWeight: 600 }}>{claim.patient}</span>
              <span style={{ color: C.grayDark }}>{claim.payer}</span>
              <span style={{ color: C.grayDark }}>{claim.procedure}</span>
              <span style={{ color: C.grayDark, fontVariantNumeric: 'tabular-nums' }}>
                {claim.date}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{claim.billed}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {v.state === 'open' ? (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '9px 16px',
                      borderRadius: 10,
                      background: v.hover ? C.brand : C.white,
                      color: v.hover ? C.white : C.brand,
                      border: `1.5px solid ${C.brand}`,
                      fontSize: 15,
                      fontWeight: 600,
                      transform: `scale(${v.pressed ?? 1})`,
                    }}
                  >
                    <Phone size={16} /> Call payer
                  </span>
                ) : v.state === 'calling' ? (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 9,
                      color: C.brand,
                      fontWeight: 600,
                      fontSize: 15,
                    }}
                  >
                    <Loader2 size={18} style={{ transform: `rotate(${spin * 12}deg)` }} /> Calling…
                  </span>
                ) : (
                  <span
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      transform: `rotateX(${(1 - (v.flip ?? 1)) * 90}deg)`,
                      transformOrigin: '50% 50%',
                    }}
                  >
                    <StatusChip status={claim.result.status} />
                    <span style={{ fontSize: 13.5, color: C.grayDark, paddingLeft: 4 }}>
                      {claim.result.next}
                    </span>
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
