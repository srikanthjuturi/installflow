import hi from '@/i18n/locales/hi.json';
import { changeLanguage } from 'i18next';
import { ledgerTitle, roleLabel } from '../serverLabels';

/**
 * Rendered against the JSON file itself rather than string literals: the file
 * is what the screen will draw, and a translator's edit then fails this test
 * loudly instead of quietly rotting.
 */
const LEDGER_HI: Record<string, string> = {
  'Travel allowance': hi.server.ledgerTitle.travelAllowance,
  'Speed reward': hi.server.ledgerTitle.speedReward,
  'Speed penalty': hi.server.ledgerTitle.speedPenalty,
};

describe('serverLabels in Hindi', () => {
  beforeEach(async () => {
    await changeLanguage('hi');
  });
  afterAll(async () => {
    // Other suites on this process share the instance; put it back.
    await changeLanguage('en');
  });

  it('translates each of the three ledger titles Task 10/11 add', () => {
    expect(ledgerTitle('Travel allowance')).toBe(LEDGER_HI['Travel allowance']);
    expect(ledgerTitle('Speed reward')).toBe(LEDGER_HI['Speed reward']);
    expect(ledgerTitle('Speed penalty')).toBe(LEDGER_HI['Speed penalty']);
  });

  it('translates the new role both ways the server sends it', () => {
    expect(roleLabel('franchisee_admin')).toBe(hi.server.role.franchiseeAdmin);
    expect(roleLabel('Franchisee Admin')).toBe(hi.server.role.franchiseeAdmin);
  });

  it('shows a title it has never heard of exactly as sent', () => {
    expect(ledgerTitle('Something new')).toBe('Something new');
  });
});

describe('serverLabels in English', () => {
  beforeEach(async () => {
    await changeLanguage('en');
  });

  it('returns the server\'s words unchanged — this never rewrites', () => {
    expect(ledgerTitle('Travel allowance')).toBe('Travel allowance');
    expect(ledgerTitle('Speed reward')).toBe('Speed reward');
    expect(ledgerTitle('Speed penalty')).toBe('Speed penalty');
    expect(ledgerTitle('Something new')).toBe('Something new');
    expect(ledgerTitle('Install · Sunview 43')).toBe('Install · Sunview 43');
    expect(roleLabel('franchisee_admin')).toBe('franchisee_admin');
    expect(roleLabel('National Head')).toBe('National Head');
  });
});

