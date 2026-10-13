'use client';

import { Badge, BrandMark } from '@dentabill/ui';
import { ArrowRight, Check, CheckCheck, FileText, PhoneCall } from 'lucide-react';
import * as React from 'react';

const steps = [
  {
    label: 'Claim imported',
    icon: FileText,
    title: 'One less claim to chase.',
    description: 'A pending claim from your CSV is ready for follow-up.',
    status: 'Queued',
    detail: 'Claim #DEMO-1042',
    note: 'Delta Dental · $840.00 · 32 days outstanding',
  },
  {
    label: 'Payer called',
    icon: PhoneCall,
    title: 'The hold music is our job.',
    description: 'DentaBill navigates the phone tree and speaks with a payer representative.',
    status: 'In progress',
    detail: 'Connected to a representative',
    note: 'Claim status, payment details, and next steps requested.',
  },
  {
    label: 'Answer ready',
    icon: CheckCheck,
    title: 'A clear next step. Finally.',
    description: 'Your team gets the answer, with a summary and a complete call history.',
    status: 'Follow-up complete',
    detail: 'Payment is being processed',
    note: 'Check for payment in 7–10 business days. Reference: DEMO-58291.',
  },
] as const;

export function ClaimDemo(): React.ReactElement {
  const [step, setStep] = React.useState(2);
  const current = steps[step] ?? steps[2];
  return (
    <section className="claim-demo" aria-label="Interactive claim follow-up example">
      <div className="demo-topline">
        <span className="inline-flex items-center gap-2 font-medium">
          <BrandMark size={21} /> Your follow-up, handled
        </span>
        <span className="demo-label">Illustrative example</span>
      </div>
      <div className="demo-claim">
        <div>
          <p className="text-caption text-gray-warm">Delta Dental PPO</p>
          <p className="mt-1 font-semibold">Claim #DEMO-1042</p>
        </div>
        <span className="text-2xl font-medium tabular-nums">
          $840<span className="text-gray-warm text-base">.00</span>
        </span>
      </div>
      <ol className="demo-steps" aria-label="Follow-up stages">
        {steps.map((item, index) => (
          <li key={item.label}>
            <button
              type="button"
              aria-pressed={step === index}
              onClick={() => {
                setStep(index);
              }}
              className="demo-step"
            >
              <span className={`demo-step-icon ${index <= step ? 'is-complete' : ''}`}>
                {index < step ? <Check size={16} /> : <item.icon size={16} />}
              </span>
              <span>{item.label}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="demo-result" aria-live="polite" aria-atomic="true">
        <Badge variant={step === 2 ? 'success' : step === 1 ? 'active' : 'muted'}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {current.status}
        </Badge>
        <h2>{current.title}</h2>
        <p>{current.description}</p>
        <div className="demo-note">
          <CheckCheck size={19} className="text-brand shrink-0" />
          <div>
            <strong>{current.detail}</strong>
            <p>{current.note}</p>
          </div>
        </div>
      </div>
      <button
        type="button"
        className="demo-next"
        onClick={() => {
          setStep((step + 1) % steps.length);
        }}
      >
        {step === 2 ? 'Walk through the follow-up' : 'See the next step'}
        <ArrowRight size={16} />
      </button>
    </section>
  );
}
