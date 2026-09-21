/**
 * Everything invented, in one place.
 *
 * Change the company name here and the whole deck re-brands — the console rail,
 * the customer's slot page, the technician app after sign-in and every email all
 * read it from the tenant, which is the white-labelling this product is built
 * around.
 */

/**
 * The mail domains every seeded address sits on, and why they are settings.
 *
 * Deleting a company does NOT free its users' email addresses — the rows are
 * left live, the same leftover that `dev_tokens.py --free-technician-phones`
 * exists to clear for technician numbers. Locally that SQL is available; on a
 * remote database it is not, and a re-seed then dies on the first account with
 * "the identity exists from an earlier run with a different password".
 *
 * So the domain is overridable. Point `DECK_SEED_DOMAIN` at an unused one and
 * the whole tenant gets fresh identities without touching anything else. Keep
 * it off `ACS_EMAIL_ALLOWLIST` whatever you choose — that refusal is what makes
 * the API hand the temporary password back in the response instead of emailing
 * it into the void.
 */
export const MAIL_DOMAIN = process.env.DECK_SEED_DOMAIN ?? 'meridian-demo.in';
export const VENDOR_MAIL_DOMAIN =
  process.env.DECK_SEED_VENDOR_DOMAIN ?? 'crestline-demo.in';

/** The demo tenant. `code` is the monogram; it is stamped once and never
 *  recomputed, so it is worth choosing rather than letting it be derived. */
export const COMPANY = {
  name: 'Meridian Appliances',
  code: 'MA',
  email: `ops@${MAIL_DOMAIN}`,
  adminName: 'Priya Raghavan',
  phone: '+919000000101',
  gstNumber: '29MRDNA1234F1Z5',
  pan: 'MRDNA1234F',
  gstCompanyStatus: 'Active',
  addressLine1: '4th Floor, Kesari Tower, Residency Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560025',
};

/**
 * One password for every seeded account, set through `/auth/change-password`
 * after the API hands back its generated temporary one. Matches this project's
 * long-standing demo convention, so a live walkthrough needs nothing memorised.
 */
export const DEMO_PASSWORD = 'Test@123';

/**
 * Every seeded address is on `@meridian-demo.in`, which is deliberately NOT on
 * `ACS_EMAIL_ALLOWLIST`. The send is therefore refused, which is exactly what we
 * want twice over: nobody is emailed, and the API returns the temporary password
 * in the response instead of swallowing it.
 */
export const STAFF = [
  { role: 'national_head', fullName: 'Arun Deshmukh', email: `arun.deshmukh@${MAIL_DOMAIN}`, phone: '+919000000102' },
  { role: 'regional_head', fullName: 'Kavya Menon', email: `kavya.menon@${MAIL_DOMAIN}`, phone: '+919000000103' },
  { role: 'area_manager', fullName: 'Rohit Bhatia', email: `rohit.bhatia@${MAIL_DOMAIN}`, phone: '+919000000104' },
];

/**
 * The vendor is the COMPANY; a brand is what is printed on the unit.
 *
 * `brands` matters more than it looks. Omit it and the API auto-creates exactly
 * one brand named after the vendor — so every product and every ticket screen
 * printed "Crestline Distributors" where the whole point of the feature is to
 * print *Meridian*. Naming them here is what makes the brand column mean
 * something on a slide.
 *
 * ⚠ It also changes the catalogue call. `brandId` may only be omitted while a
 * vendor has exactly ONE approved brand; with two, `POST /masters/nodes/{id}/
 * models` refuses with "Choose which of this vendor's brands the product
 * carries". `createCatalogue` resolves the id per model through
 * `GET /vendors/options`.
 */
export const VENDOR_BRANDS = ['Meridian', 'Sunview'];

/** Submitted from the PORTAL, so it lands pending and fills Approvals → Brands. */
export const VENDOR_PENDING_BRAND = 'Hearthline';

export const VENDOR = {
  name: 'Crestline Distributors',
  gstNumber: '29CRSTL5678K1Z2',
  pan: 'CRSTL5678K',
  gstCompanyStatus: 'Active',
  contactPerson: 'Imran Qureshi',
  phone: '+919000000201',
  address: '12, Industrial Layout, Peenya',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560058',
  loginEmail: `imran.qureshi@${VENDOR_MAIL_DOMAIN}`,
  intakeChannels: ['Manual'],
  brands: VENDOR_BRANDS,
};

/**
 * A second person at the vendor. A `vendor_user` sees only the tickets THEY
 * raised, where the vendor account sees every ticket its people raised — which
 * is the sentence the vendor-portal slide makes, and which was unillustrated
 * while the vendor had exactly one login.
 */
export const VENDOR_SUBUSER = {
  fullName: 'Divya Raghunath',
  email: `divya.raghunath@${VENDOR_MAIL_DOMAIN}`,
  phone: '+919000000202',
};

/**
 * Phone numbers are E.164 and deliberately outside `WHATSAPP_ALLOWLIST`, so
 * every OTP and every customer notice is dropped rather than sent. The technician
 * still signs in, because `OTP_DEV_ECHO` returns the code in the response.
 *
 * `upiName` is the name on the UPI account, and it is NOT decoration: it is
 * what the payer's own app shows when they scan the QR, and what a redemption
 * freezes as `payee_name`. The seed used to send `upiId` alone, which is legal
 * but leaves `technician_profiles.upi_name` null — so the payout-account screen
 * photographed half-filled and the redemption fell back to the technician's
 * own name.
 *
 * Nikhil Rao deliberately has neither. A technician with no payout account is a
 * real state, it is what every technician starts as, and it is why the Earnings
 * screen has something to say before one is added.
 */
export const TECHNICIANS = [
  { fullName: 'Suresh Kumar', phone: '+919000000301', upiId: 'suresh@okmeridian', upiName: 'Suresh Kumar' },
  { fullName: 'Farhan Ali', phone: '+919000000302', upiId: 'farhan@okmeridian', upiName: 'Farhan Ali' },
  { fullName: 'Nikhil Rao', phone: '+919000000303', upiId: null, upiName: null },
];

/**
 * The catalogue. Depth 0 is a root, depth 1 is the MAIN sub-category a
 * technician certifies on, and only the last floor — `isLeaf` — holds products.
 */
export const CATALOGUE = [
  {
    name: 'Electronics',
    children: [
      {
        name: 'Television',
        certify: true,
        children: [
          {
            name: 'Android TV',
            isLeaf: true,
            models: [
              { name: 'Meridian 43" 4K Smart LED', brand: 'Meridian', serialPrefix: 'MRD', technicianPayoutPaise: 42000, vendorPricePaise: 115000, capacity: '43 inch', warrantyMonths: 24 },
              { name: 'Meridian 55" QLED', brand: 'Meridian', serialPrefix: 'MRD', technicianPayoutPaise: 58000, vendorPricePaise: 168000, capacity: '55 inch', warrantyMonths: 24 },
              // A second BRAND under the same last sub-category, so the brand
              // column on every product and ticket screen has two values in it.
              // Model names are unique per (node, brand), not per node.
              { name: 'Sunview 32" HD Ready', brand: 'Sunview', serialPrefix: 'SNV', technicianPayoutPaise: 34000, vendorPricePaise: 79000, capacity: '32 inch', warrantyMonths: 12 },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Home Appliances',
    children: [
      {
        name: 'Air Conditioner',
        certify: true,
        children: [
          {
            name: 'Split AC',
            isLeaf: true,
            models: [
              { name: 'Meridian 1.5T 5-Star Inverter', brand: 'Meridian', serialPrefix: 'MRD', technicianPayoutPaise: 65000, vendorPricePaise: 210000, capacity: '1.5 Ton', warrantyMonths: 12 },
            ],
          },
        ],
      },
    ],
  },
];

/**
 * A product the VENDOR submitted and nobody has priced.
 *
 * Without this, `/approvals` photographs as an empty screen — staff-created
 * models are approved the moment they are saved, and the whole catalogue was
 * seeded as the admin. The console's own caption for that screen is "Vendor
 * products await a price", which was describing something that was not there.
 */
export const VENDOR_SUBMITTED_MODEL = {
  under: 'Android TV',
  name: 'Sunview 43" 4K Smart LED',
  brand: 'Sunview',
  capacity: '43 inch',
  warrantyMonths: 24,
  notes: 'Wall bracket included in the carton.',
};

/**
 * The serial a ticket quotes, and the pool its model carries.
 *
 * These have to agree. Intake refuses a serial the chosen model does not hold
 * — but ONLY once that model holds at least one, so loading serials without
 * also making every seeded ticket serial a member of the right model's list
 * turns all thirteen `POST /tickets` calls into 400s. One function generates
 * both, which is the only way they cannot drift.
 */
export const ticketSerial = (prefix, index) =>
  `${prefix}${String(240000 + index * 137).padStart(8, '0')}`;

/** Units the vendor holds that nobody has raised a ticket against yet. */
export const spareSerial = (prefix, n) =>
  `${prefix}${String(880000 + n * 53).padStart(8, '0')}`;

export const SPARE_SERIALS_PER_MODEL = 7;

/** Invented customers. Nothing here belongs to anybody. */
export const CUSTOMERS = [
  { name: 'Ananya Iyer', phone: '+919000000401', address: '14, Rose Garden Layout, 3rd Cross' },
  { name: 'Rahul Verma', phone: '+919000000402', address: '82, Anand Nagar, 2nd Main' },
  { name: 'Sneha Pillai', phone: '+919000000403', address: '5B, Palm Grove Residency' },
  { name: 'Vikram Chauhan', phone: '+919000000404', address: '27, Lake View Road' },
  { name: 'Divya Nair', phone: '+919000000405', address: '9, Shanti Enclave, 1st Cross' },
  { name: 'Manish Joshi', phone: '+919000000406', address: '61, Silver Oak Avenue' },
  { name: 'Lakshmi Reddy', phone: '+919000000407', address: '33, Nehru Cross, Jayanagar' },
  { name: 'Karthik Bose', phone: '+919000000408', address: '18, Ashoka Avenue' },
  { name: 'Fatima Khan', phone: '+919000000409', address: '7, Green Park Layout' },
  { name: 'Sanjay Kulkarni', phone: '+919000000410', address: '44, Sunrise Colony' },
  { name: 'Meera Gupta', phone: '+919000000411', address: '21, Gandhi Bazaar Main' },
  { name: 'Aarav Desai', phone: '+919000000412', address: '3, Rose Garden Layout, 6th Cross' },
];

/**
 * How far each ticket is driven. The mix is what makes the console's screens
 * worth photographing — a dashboard of zeroes proves nothing.
 *
 *   slotPending  raised, customer not yet asked to choose  → the slot page
 *   pool         slot confirmed, nobody has accepted       → the job pool
 *   assigned     a technician has taken it
 *   inProgress   proof submitted on site
 *   awaiting     work done, waiting on the customer        → the feedback page
 *   closed       customer confirmed                        → a payout in the ledger
 *   released     accepted then given back inside the window → penalty + escalation
 */
const INSTALL = 'Installation + Demo';

/** `Tech Visit` and `Service` are the two types that REQUIRE a description —
 *  a technician sent to fix something arrives blind without one. */
const VISIT = { serviceType: 'Tech Visit', description: 'No picture after a power cut; customer reports a clicking sound on start-up.' };
const SERVICE = { serviceType: 'Service', description: 'Annual service due; cooling has dropped noticeably over the last month.' };

export const TICKET_PLAN = [
  { stage: 'slotPending', serviceType: INSTALL },
  { stage: 'slotPending', ...VISIT },
  { stage: 'pool', serviceType: INSTALL },
  { stage: 'pool', serviceType: INSTALL },
  { stage: 'pool', ...SERVICE },
  { stage: 'assigned', serviceType: INSTALL, technician: 0 },
  { stage: 'assigned', serviceType: INSTALL, technician: 0 },
  { stage: 'assigned', ...VISIT, technician: 1 },
  { stage: 'inProgress', serviceType: INSTALL, technician: 0 },
  { stage: 'awaiting', serviceType: INSTALL, technician: 0 },
  { stage: 'closed', serviceType: INSTALL, technician: 0, rating: 5 },
  { stage: 'closed', ...SERVICE, technician: 1, rating: 4 },
  { stage: 'released', serviceType: INSTALL, technician: 2 },
];
