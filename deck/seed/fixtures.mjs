/**
 * Everything invented, in one place.
 *
 * Change the company name here and the whole deck re-brands — the console rail,
 * the customer's slot page, the technician app after sign-in and every email all
 * read it from the tenant, which is the white-labelling this product is built
 * around.
 */

/** The demo tenant. `code` is the monogram; it is stamped once and never
 *  recomputed, so it is worth choosing rather than letting it be derived. */
export const COMPANY = {
  name: 'Meridian Appliances',
  code: 'MA',
  email: 'ops@meridian-demo.in',
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
  { role: 'national_head', fullName: 'Arun Deshmukh', email: 'arun.deshmukh@meridian-demo.in', phone: '+919000000102' },
  { role: 'regional_head', fullName: 'Kavya Menon', email: 'kavya.menon@meridian-demo.in', phone: '+919000000103' },
  { role: 'area_manager', fullName: 'Rohit Bhatia', email: 'rohit.bhatia@meridian-demo.in', phone: '+919000000104' },
];

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
  loginEmail: 'imran.qureshi@crestline-demo.in',
  intakeChannels: ['Manual'],
};

/**
 * Phone numbers are E.164 and deliberately outside `WHATSAPP_ALLOWLIST`, so
 * every OTP and every customer notice is dropped rather than sent. The technician
 * still signs in, because `OTP_DEV_ECHO` returns the code in the response.
 */
export const TECHNICIANS = [
  { fullName: 'Suresh Kumar', phone: '+919000000301', upiId: 'suresh@okmeridian' },
  { fullName: 'Farhan Ali', phone: '+919000000302', upiId: 'farhan@okmeridian' },
  { fullName: 'Nikhil Rao', phone: '+919000000303', upiId: null },
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
              { name: 'Meridian 43" 4K Smart LED', technicianPayoutPaise: 42000, vendorPricePaise: 115000, capacity: '43 inch', warrantyMonths: 24 },
              { name: 'Meridian 55" QLED', technicianPayoutPaise: 58000, vendorPricePaise: 168000, capacity: '55 inch', warrantyMonths: 24 },
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
              { name: 'Meridian 1.5T 5-Star Inverter', technicianPayoutPaise: 65000, vendorPricePaise: 210000, capacity: '1.5 Ton', warrantyMonths: 12 },
            ],
          },
        ],
      },
    ],
  },
];

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
