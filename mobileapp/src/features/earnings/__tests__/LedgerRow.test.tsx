import { render } from '@testing-library/react-native';
import { toTransaction } from '@/features/earnings/ledger';
import { LedgerRow } from '../components/LedgerRow';

// ui/Text reads the language store, which reads SecureStore. In-memory instead:
// nothing here cares which language persisted.
jest.mock('@/lib/secureStorage', () => ({
  secureStorage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
// The glyph module; the row's shape under test is its text, not the icon.
jest.mock('@/components/icons/Icon', () => ({ Icon: () => null }));

const ROW = {
  id: 'le-1',
  at: '2026-10-22T10:00:00+05:30',
  title: 'Something new',
  subtitle: 'Today · RGT-INST-0012',
  ticketCode: 'RGT-INST-0012',
};

describe('LedgerRow', () => {
  it('renders an unknown kind safely: its own title, and the amount unsigned', async () => {
    const txn = toTransaction({ ...ROW, kind: 'something_new', amountPaise: 5000 });
    const screen = await render(<LedgerRow txn={txn} first />);

    expect(screen.getByText('Something new')).toBeOnTheScreen();
    // Unknown → unsigned; signed would say a direction this build does not know.
    expect(screen.getByText('₹50')).toBeOnTheScreen();
  });

  it('renders a speed penalty with its sign on the amount', async () => {
    const txn = toTransaction({
      ...ROW, kind: 'speed_penalty', title: 'Speed penalty', amountPaise: 15000,
    });
    const screen = await render(<LedgerRow txn={txn} first={false} />);

    expect(screen.getByText('Speed penalty')).toBeOnTheScreen();
    expect(screen.getByText('−₹150')).toBeOnTheScreen();
  });

  it('renders a credit signed', async () => {
    const txn = toTransaction({ ...ROW, kind: 'travel', title: 'Travel allowance', amountPaise: 8000 });
    const screen = await render(<LedgerRow txn={txn} first />);

    expect(screen.getByText('+₹80')).toBeOnTheScreen();
  });

  it('renders no press affordance when no onOpen is given', async () => {
    const txn = toTransaction({ ...ROW, kind: 'payout', title: 'Install · Sunview 43', amountPaise: 45000 });
    // A Pressable with no onPress would still flash and invite a dead end; the
    // row is flat when `onOpen` is absent.
    const screen = await render(<LedgerRow txn={txn} first />);

    expect(screen.queryByRole('button')).toBeNull();
  });
});