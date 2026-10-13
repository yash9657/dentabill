import { Pill } from '@dentabill/ui';
import { ArrowUpRight, Check, FileCheck2, LockKeyhole, PhoneCall } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { ClaimDemo } from '../../components/marketing/claim-demo.js';

export default function HomePage(): React.ReactElement {
  return (
    <main id="main-content" className="landing-page">
      <section className="landing-hero page-container">
        <div className="hero-copy">
          <h1>
            Your front desk
            <br />
            isn’t a <em>call center.</em>
          </h1>
          <p>
            Give the insurance calls to DentaBill. Our AI voice agent navigates phone trees, waits
            on hold, and gets the claim updates your billing team needs.
          </p>
          <div className="hero-actions">
            <Pill href="/sign-up" size="lg" withArrow>
              Get started free
            </Pill>
            <Pill href="/contact" variant="whiteShadow" size="lg">
              Book a demo
            </Pill>
          </div>
          <p className="hero-reassurance">
            <Check size={15} /> Free for practices <span aria-hidden>·</span> No credit card
            required
          </p>
        </div>
        <ClaimDemo />
      </section>

      <section className="compatibility-band" aria-label="Compatible CSV exports">
        <div className="page-container">
          <p>
            Start with the tools
            <br className="hidden sm:block" /> your practice already uses.
          </p>
          <div className="compatibility-names">
            <span>Dentrix</span>
            <span>Eaglesoft</span>
            <span>Open Dental</span>
          </div>
          <span className="text-caption text-gray-warm">
            Simple CSV import.
            <br />
            No system migration.
          </span>
        </div>
      </section>

      <section
        id="how-it-works"
        className="workflow-section page-container"
        aria-labelledby="workflow-heading"
      >
        <div className="section-intro">
          <h2 id="workflow-heading">
            From “still pending”
            <br />
            to a plan of action.
          </h2>
          <p>
            Keep your team focused on the work that needs a human. We’ll handle the calls that get
            in the way.
          </p>
        </div>
        <ol className="workflow-list">
          <li>
            <span className="workflow-number">01</span>
            <div>
              <h3>Bring your open claims.</h3>
              <p>
                Upload a CSV from your practice management system. Review your imported claims in
                one organized queue.
              </p>
              <Link href="/faq" className="text-link">
                About importing claims <ArrowUpRight size={16} />
              </Link>
            </div>
            <div className="workflow-art import-art" aria-label="Illustrative CSV import">
              <FileCheck2 size={28} />
              <div>
                <strong>Open claims.csv</strong>
                <span>Ready for follow-up</span>
              </div>
              <Check size={20} />
            </div>
          </li>
          <li>
            <span className="workflow-number">02</span>
            <div>
              <h3>Let us make the call.</h3>
              <p>
                The voice agent navigates the phone tree, waits on hold, and asks the payer’s
                representative for the details.
              </p>
              <span className="text-caption text-gray-warm">
                Follow every call from your dashboard.
              </span>
            </div>
            <div className="workflow-art call-art" aria-label="Illustrative payer call">
              <PhoneCall size={23} />
              <div>
                <strong>Speaking with the payer</strong>
                <span className="wave-bars" aria-hidden>
                  {[9, 18, 12, 26, 16, 30, 20, 12, 24, 14, 28, 19, 10, 22, 14].map((height, i) => (
                    <i key={i} style={{ height }} />
                  ))}
                </span>
              </div>
              <span className="text-caption tabular-nums">02:14</span>
            </div>
          </li>
          <li>
            <span className="workflow-number">03</span>
            <div>
              <h3>Know what happens next.</h3>
              <p>
                Get a structured summary with the claim status, denial reason, and next action. The
                transcript stays close when you need the detail.
              </p>
              <Link href="/sign-up" className="text-link">
                Start your first follow-up <ArrowUpRight size={16} />
              </Link>
            </div>
            <div className="workflow-art result-art">
              <Check size={22} />
              <div>
                <strong>Answer received</strong>
                <span>Claim status · Reference · Next step</span>
              </div>
            </div>
          </li>
        </ol>
      </section>

      <section className="practice-section">
        <div className="page-container practice-grid">
          <div>
            <h2>
              A little less hold music.
              <br />
              <em>A lot more headspace.</em>
            </h2>
            <p>
              Insurance follow-up shouldn’t take over the day. Give your billing team a clear view
              of what’s moving, what needs attention, and what to do next.
            </p>
            <Pill href="/contact" variant="whiteShadow" withArrow>
              See DentaBill in action
            </Pill>
          </div>
          <div className="practice-ledger">
            <div>
              <span>One place for your open claims</span>
              <Check size={18} />
            </div>
            <div>
              <span>Live call status and complete history</span>
              <Check size={18} />
            </div>
            <div>
              <span>Summaries with actionable next steps</span>
              <Check size={18} />
            </div>
            <div>
              <span>Your team stays in control</span>
              <Check size={18} />
            </div>
            <p>Built around the everyday work of dental billing.</p>
          </div>
        </div>
      </section>

      <section className="security-section page-container">
        <LockKeyhole size={30} strokeWidth={1.5} />
        <div>
          <h2>Patient data deserves thoughtful care.</h2>
          <p>
            Organization-scoped access, encrypted recordings, and a business associate agreement
            available on request. Clear information for your practice’s security review.
          </p>
        </div>
        <Link href="/security" className="text-link">
          Explore security <ArrowUpRight size={17} />
        </Link>
      </section>
      <section className="closing-section">
        <div className="page-container">
          <h2>
            Give your front desk
            <br />
            <em>the day back.</em>
          </h2>
          <div>
            <p>Your next follow-up doesn’t have to be your next phone call.</p>
            <Pill href="/sign-up" size="lg" withArrow>
              Get started free
            </Pill>
            <span className="text-caption text-gray-dark mt-4 block">
              No card. No complicated setup.
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
