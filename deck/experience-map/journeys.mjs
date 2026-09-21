/**
 * The map's narrative: which screens belong to which journey, and in what order.
 *
 * The same separation `storyboard.py` makes for the decks. This file names shot
 * ids and nothing else — every heading, caption and supporting line is PULLED,
 * either from `out/shots.json` (written by the capture scripts) or from the
 * chapter and step headings of `build/build_document.py`, which is approved
 * client-facing prose. Nothing here is newly written copy.
 *
 * The acts are the document's own chapters; the journeys inside act one are its
 * eight steps, verbatim. `Step N` numbering is kept because chapter 3 really is
 * a sequence — one job, start to finish — and the number carries information a
 * reader needs. The other acts are not sequences and carry no numbers.
 *
 * `actor` decides the tint on each journey's rail. It is the single device that
 * makes this a MAP rather than a gallery: the colour changes at exactly the
 * points where a job passes from one party to another, so the hand-offs are
 * visible without drawing a single arrow or box.
 */

export const ACTORS = {
  vendor: { label: 'The vendor', tint: '#1f6feb' },
  customer: { label: 'The customer', tint: '#14683a' },
  technician: { label: 'The technician', tint: '#d18f16' },
  company: { label: 'Your team', tint: '#2c2f74' },
  platform: { label: 'The platform', tint: '#5a6772' },
};

export const ACTS = [
  {
    // Everything that has to exist before a ticket can be raised. It was
    // scattered across the last two acts — the platform's own screens and a
    // technician joining both sat AFTER the job and its branches, and the
    // catalogue was buried inside "the vendor raises a ticket". Read in that
    // order the map answered "how does a job run" before "how does any of this
    // come to exist", which is backwards for somebody meeting it for the first
    // time.
    id: 'before',
    eyebrow: 'Getting ready',
    title: 'Before any job\nexists',
    lede:
      'Nothing below can happen until these do. The platform creates your ' +
      'company; your own people then build it out until a vendor has something ' +
      'to raise a ticket against.',
    journeys: [
      {
        actor: 'platform',
        title: 'The platform creates your company',
        shots: ['super-companies', 'super-geography'],
      },
      {
        actor: 'company',
        title: 'Your rules, and your catalogue',
        shots: [
          'console-rules',
          'console-categories',
          'console-model-serials',
          'console-approvals',
        ],
      },
      {
        actor: 'company',
        title: 'Your people, and what they can see',
        shots: [
          'console-users',
          'console-territory',
          'console-technicians',
          'console-am-dashboard',
        ],
      },
      {
        actor: 'vendor',
        title: 'Your vendors, and their brands',
        shots: ['console-vendors', 'portal-brands'],
      },
      {
        actor: 'technician',
        title: 'A technician joins',
        shots: [
          'proto-register-invite',
          'proto-register-categories',
          'proto-login',
          'proto-login-otp',
        ],
      },
    ],
  },
  {
    // build_document.py — "3. Follow one job, start to finish"
    id: 'one-job',
    eyebrow: 'The flow',
    title: 'Follow one job,\nstart to finish',
    lede:
      'From the vendor’s ticket to the customer’s confirmation — ' +
      'with proof at every step.',
    journeys: [
      {
        step: 1,
        actor: 'vendor',
        title: 'The vendor raises the ticket',
        // The brands and the serial master moved to the act above — they are
        // what somebody set up beforehand, not part of filling in the form.
        shots: ['portal-new-ticket', 'portal-tickets'],
      },
      {
        step: 2,
        actor: 'customer',
        title: 'The customer chooses the time',
        shots: ['customer-slot', 'customer-slot-confirmed'],
      },
      {
        step: 3,
        actor: 'technician',
        title: 'The job reaches the pool, masked',
        shots: ['app-pool', 'app-offer'],
      },
      {
        step: 4,
        actor: 'technician',
        title: 'A technician accepts',
        shots: ['app-accept-sheet', 'app-job-detail', 'app-jobs'],
      },
      {
        step: 5,
        actor: 'technician',
        title: 'On site: four pieces of proof',
        shots: [
          'proto-proof-barcode',
          'proto-proof-serial',
          'proto-proof-photos',
          'proto-proof-live',
          'proto-review',
        ],
      },
      {
        step: 6,
        actor: 'customer',
        title: 'Only the customer closes the job',
        shots: ['proto-closure', 'customer-feedback'],
      },
      {
        step: 7,
        actor: 'technician',
        title: 'The technician is credited',
        shots: ['app-earnings'],
      },
      {
        step: 8,
        actor: 'technician',
        title: 'The technician takes the money out',
        shots: ['app-redeem', 'app-payout-account', 'console-redemption'],
      },
    ],
  },
  {
    // build_document.py — "4. When it does not go to plan"
    id: 'branches',
    eyebrow: 'When it does not go to plan',
    title: 'The branches that\nactually cost money',
    lede:
      'Most of the value is in what happens the rest of the time — and in ' +
      'every case, no job can quietly disappear.',
    journeys: [
      {
        actor: 'company',
        title: 'Nobody accepts the job',
        shots: ['console-escalations', 'console-assign', 'console-bonus'],
      },
      {
        actor: 'technician',
        title: 'The technician cancels',
        shots: ['proto-cancel', 'console-ledger'],
      },
      {
        actor: 'company',
        title: 'The time no longer suits the customer',
        shots: ['console-reschedule'],
      },
      {
        actor: 'company',
        title: 'The customer never replies',
        shots: ['console-force-close'],
      },
    ],
  },
  {
    // build_document.py — "6. What you control" and "7. Who sees what"
    id: 'control',
    eyebrow: 'What you can see',
    title: 'Counted,\nnever estimated',
    lede:
      'What the job cost you, and what your operation is doing right now. ' +
      'Every figure is a count over the territory the reader actually covers.',
    journeys: [
      {
        actor: 'company',
        title: 'What you pay us',
        shots: ['console-credits'],
      },
      {
        actor: 'company',
        title: 'Your operation, on one screen',
        shots: ['console-dashboard', 'console-ticket-detail'],
      },
    ],
  },
  {
    // build_document.py — "9. What is not built yet"
    id: 'not-built',
    eyebrow: 'What is not built yet',
    title: 'Designed, and\nnot switched on',
    lede:
      'Automated photo verification is designed and visible in the ' +
      'architecture but nothing runs the check yet, so the screens are hidden ' +
      'rather than shown empty. It is better to say so plainly than to let it ' +
      'be discovered later.',
    unbuilt: true,
    journeys: [
      {
        actor: 'technician',
        title: 'Automated photo verification',
        shots: [
          'proto-verifying',
          'proto-ai-result',
          'proto-ai-mismatch',
          'proto-ai-unreadable',
        ],
      },
    ],
  },
];

/**
 * The closing lines — `storyboard.py`'s `CLOSING`, verbatim.
 */
export const CLOSING = {
  title: 'Every step leaves a record',
  lines: [
    'The brand on every screen is the client’s, not ours.',
    'One company’s data is never reachable from another’s.',
    'A ticket’s history lives in its events, not its status column.',
  ],
};

/**
 * The disclaimer from the document's cover, verbatim in substance.
 * It has to ride along on anything that shows these screenshots.
 */
export const DEMO_NOTE =
  'The screens show a demonstration company called Meridian Appliances. The ' +
  'platform is white-labelled: in your deployment every screen, email and ' +
  'WhatsApp message carries your company name and mark instead.';
