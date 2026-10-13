# DentaBill

DentaBill helps dental practice billing teams follow up on insurance claims. This description is derived from the existing repository and the user's redesign request, not a new business strategy.

Users import open claims from practice management CSV exports, review the queue, initiate payer calls, and inspect structured call results and history. Reports and organization settings support ongoing practice operations. The public website explains the product, its existing free pricing, and security approach; account creation is handled by Clerk.

## Interface goals

- Give dental office and billing staff clear next actions and readable claim status.
- Explain the product quickly to prospective practices with a memorable hero.
- Use one reusable design system across public and authenticated surfaces.
- Support narrow phones, tablets, and desktop workspaces.
- Preserve existing API, authentication, and workflow behavior; describe unavailable capabilities honestly.

## Constraints and evidence

The application uses Next.js, React, Tailwind CSS, and the shared `@dentabill/ui` package. The user cited LunaBill as inspiration and identified `dentabill.site` as the deployment. The redesign does not imply approval to deploy.

Production accounts and patient records are not used for local visual review. Sample claim values are labeled illustrative. Security/legal claims retain the existing product's meaning and should be reviewed by their owners before publication. Unavailable team management and notification features remain identified as unavailable.
