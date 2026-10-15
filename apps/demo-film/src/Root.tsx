import { Composition, Still } from 'remotion';

import { Film } from './Film';
import { Poster } from './Poster';
import { T } from './timeline';

export function Root(): React.ReactElement {
  return (
    <>
      <Composition
        id="DemoFilm"
        component={Film}
        durationInFrames={T.total}
        fps={30}
        width={1920}
        height={1080}
      />
      <Still id="Poster" component={Poster} width={1920} height={1080} />
    </>
  );
}
