import { C } from '../theme';

/** Cream stage with a faint grid and a brand glow. */
export function Backdrop({ dark = false }: { readonly dark?: boolean }): React.ReactElement {
  const line = dark ? 'rgba(237,244,235,0.05)' : 'rgba(33,78,64,0.05)';
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: dark
          ? `radial-gradient(1200px 700px at 50% 110%, #2c6a56 0%, ${C.brand} 45%, ${C.brandDeep} 100%)`
          : `radial-gradient(1100px 600px at 50% 105%, #dfece4 0%, ${C.cream} 60%)`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`,
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)',
        }}
      />
    </div>
  );
}
