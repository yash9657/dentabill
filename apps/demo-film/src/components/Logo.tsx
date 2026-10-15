export const LOGO_PATH =
  'M5 5h14c8.84 0 16 6.72 16 15S27.84 35 19 35H5V17h13a3 3 0 0 1 0 6h-6v5h7c4.97 0 9-3.58 9-8s-4.03-8-9-8H5Z';

export function Mark({
  size,
  color,
}: {
  readonly size: number;
  readonly color: string;
}): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40">
      <path d={LOGO_PATH} fill={color} />
    </svg>
  );
}
