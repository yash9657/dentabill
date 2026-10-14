import { BrandMark } from '@dentabill/ui';
import { Captions, Download, FileText } from 'lucide-react';
import * as React from 'react';

const mediaPath = '/media/dentabill-demo';

export function ClaimDemo(): React.ReactElement {
  return (
    <section className="claim-demo" aria-labelledby="demo-video-heading">
      <header className="demo-topline">
        <div className="demo-video-title">
          <BrandMark size={22} />
          <h2 id="demo-video-heading">See DentaBill in action</h2>
        </div>
        <span className="demo-label">Synthetic demo</span>
      </header>
      <video
        className="demo-video"
        aria-label="DentaBill product walkthrough with synthetic data"
        aria-describedby="demo-video-disclosure"
        controls
        playsInline
        preload="none"
        width={1600}
        height={1000}
        poster={`${mediaPath}/poster.jpg`}
      >
        <source src={`${mediaPath}/walkthrough.mp4`} type="video/mp4" />
        <track
          kind="captions"
          src={`${mediaPath}/captions.en.vtt`}
          srcLang="en"
          label="English"
          default
        />
        <p>
          Your browser cannot play this video.{' '}
          <a href={`${mediaPath}/walkthrough.mp4`} download>
            Download the walkthrough
          </a>{' '}
          or <a href={`${mediaPath}/transcript.html`}>read the transcript</a>.
        </p>
      </video>
      <div className="demo-video-details">
        <p id="demo-video-disclosure">
          Synthetic data. Simulated call and analysis; no payer was contacted.
        </p>
        <span className="demo-caption-label">
          <Captions size={16} aria-hidden /> English captions
        </span>
        <div className="demo-video-links">
          <a href={`${mediaPath}/transcript.html`}>
            <FileText size={16} aria-hidden /> Read transcript
          </a>
          <a href={`${mediaPath}/walkthrough.mp4`} download>
            <Download size={16} aria-hidden /> Download video
          </a>
        </div>
      </div>
    </section>
  );
}
