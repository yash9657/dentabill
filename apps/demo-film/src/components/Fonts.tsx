import { useEffect, useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';

const css = `
@font-face { font-family: Inter; src: url(${staticFile('fonts/inter-latin.woff2')}) format('woff2'); font-weight: 100 900; }
@font-face { font-family: Newsreader; src: url(${staticFile('fonts/newsreader-latin.woff2')}) format('woff2'); font-weight: 200 800; }
`;

/** Self-hosted fonts; the render waits until both are ready. */
export function Fonts(): React.ReactElement {
  const [handle] = useState(() => delayRender('fonts'));
  useEffect(() => {
    Promise.all([
      document.fonts.load('400 40px Inter'),
      document.fonts.load('600 40px Inter'),
      document.fonts.load('400 40px Newsreader'),
    ]).then(
      () => {
        continueRender(handle);
      },
      () => {
        continueRender(handle);
      },
    );
  }, [handle]);
  return <style>{css}</style>;
}
