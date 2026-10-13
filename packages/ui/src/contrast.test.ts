import { describe, expect, it } from 'vitest';

import { tokens } from './tokens.js';

function luminance(hex: string): number {
  const rgb = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}
const color = tokens.color;
describe('Design system text contrast', () => {
  it.each([
    ['muted on canvas', color.grayWarm, color.canvas],
    ['muted on gray', color.grayWarm, color.grayLight],
    ['muted on cream', color.grayWarm, color.cream],
    ['body on white', color.grayDark, color.white],
    ['primary action', color.white, color.brand],
    ['inverse text', color.inkInverse, color.brand],
    ['success status', color.success, color.successSoft],
    ['warning status', color.warning, color.warningSoft],
    ['error status', color.danger, color.dangerSoft],
  ])('%s meets WCAG AA for normal text', (_name, foreground, background) => {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
    expect((values[1]! + 0.05) / (values[0]! + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
