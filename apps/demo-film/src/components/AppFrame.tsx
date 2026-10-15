import { BarChart3, FileText, LayoutDashboard, PhoneCall, Search, Settings } from 'lucide-react';

import { C, FONT_BODY } from '../theme';

import { Mark } from './Logo';

export const WIN = { x: 210, y: 196, w: 1500, h: 850, side: 232 } as const;
/** Left edge / top of the main content area, in world coordinates. */
export const MAIN = { x: WIN.x + WIN.side + 48, y: WIN.y + 64 + 40 } as const;

const nav = [
  { label: 'Overview', Icon: LayoutDashboard },
  { label: 'Claims', Icon: FileText },
  { label: 'Calls', Icon: PhoneCall },
  { label: 'Reports', Icon: BarChart3 },
  { label: 'Settings', Icon: Settings },
] as const;

/** The DentaBill dashboard shell, simplified to what the film needs. */
export function AppFrame({
  active,
  children,
  style,
}: {
  readonly active: (typeof nav)[number]['label'];
  readonly children: React.ReactNode;
  readonly style?: React.CSSProperties;
}): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        left: WIN.x,
        top: WIN.y,
        width: WIN.w,
        height: WIN.h,
        borderRadius: 22,
        background: C.canvas,
        boxShadow: '0 50px 120px -30px rgba(20,52,42,0.35), 0 0 0 1px rgba(32,46,43,0.08)',
        overflow: 'hidden',
        fontFamily: FONT_BODY,
        color: C.ink,
        ...style,
      }}
    >
      <div
        style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 22px',
          background: C.white,
          borderBottom: `1px solid ${C.borderSubtle}`,
        }}
      >
        {['#e7837a', '#e9c46a', '#8cc79a'].map((c) => (
          <span key={c} style={{ width: 13, height: 13, borderRadius: 99, background: c }} />
        ))}
        <div
          style={{
            marginLeft: 26,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontWeight: 600,
            fontSize: 19,
          }}
        >
          <Mark size={24} color={C.brand} /> DentaBill
        </div>
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: 360,
            height: 38,
            borderRadius: 10,
            background: C.canvas,
            border: `1px solid ${C.borderSubtle}`,
            padding: '0 14px',
            color: C.grayWarm,
            fontSize: 15,
          }}
        >
          <Search size={16} /> Search claims, patients, payers
        </div>
        <div
          style={{
            marginLeft: 18,
            width: 36,
            height: 36,
            borderRadius: 99,
            background: C.brandSoft,
            color: C.brand,
            display: 'grid',
            placeItems: 'center',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          BS
        </div>
      </div>
      <div style={{ display: 'flex', height: WIN.h - 64 }}>
        <aside
          style={{
            width: WIN.side,
            padding: '26px 16px',
            background: C.white,
            borderRight: `1px solid ${C.borderSubtle}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ fontSize: 13, color: C.grayWarm, padding: '0 12px 10px', fontWeight: 500 }}>
            Bright Smile Dental
          </div>
          {nav.map(({ label, Icon }) => (
            <div
              key={label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '11px 12px',
                borderRadius: 10,
                fontSize: 16,
                fontWeight: 500,
                background: label === active ? C.brandSoft : 'transparent',
                color: label === active ? C.brand : C.grayDark,
              }}
            >
              <Icon size={19} /> {label}
            </div>
          ))}
        </aside>
        <main style={{ flex: 1, position: 'relative', padding: '40px 48px', overflow: 'hidden' }}>
          {children}
        </main>
      </div>
    </div>
  );
}

/** Small, persistent honesty label. */
export function SyntheticBadge({ opacity = 1 }: { readonly opacity?: number }): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        right: 40,
        bottom: 30,
        padding: '8px 14px',
        borderRadius: 99,
        background: 'rgba(255,255,255,0.86)',
        border: `1px solid ${C.border}`,
        fontFamily: FONT_BODY,
        fontSize: 15,
        color: C.grayDark,
        opacity,
        zIndex: 60,
      }}
    >
      Synthetic data · simulated call
    </div>
  );
}
