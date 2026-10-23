import { Pressable, View } from 'react-native';

import { Icon } from '@/components/icons/Icon';
import { Text } from '@/components/ui/Text';
import { formatLedgerAmount } from '@/features/earnings/ledger';
import { kindStyle } from '@/features/earnings/kindStyle';
import { useTranslation } from 'react-i18next';
import { ledgerTitle } from '@/i18n/serverLabels';
import { color } from '@/theme/semantic';
import { palette } from '@/theme/tokens';
import type { Transaction } from '@/types/domain';
import { relativeDayLabel } from '@/utils/date';

/**
 * One line of the ledger — and, when the job behind it is still theirs, a way
 * into it.
 *
 * A technician reading "Install · Samsung 55" OLED · ₹450" and wanting to know
 * WHICH job that was had no route from here: the code is in the subtitle, and
 * finding it meant going to Jobs and scrolling. The row is the obvious thing to
 * press, so it now is one.
 *
 * `onOpen` is undefined rather than a no-op for a row that cannot navigate, and
 * that is the whole guard: no `Pressable` is rendered at all, so there is no
 * press feedback and no chevron promising a screen that would 404. Whether a
 * row qualifies is the server's answer, not a test on `kind` — see
 * `Transaction.ticketId`.
 */
export function LedgerRow({
  txn,
  first,
  onOpen,
}: {
  txn: Transaction;
  first: boolean;
  onOpen?: () => void;
}) {
  const { t } = useTranslation();
  const style = kindStyle(txn.kind);
  // The server's English title, translated where it is one of its fixed
  // ones ("Reassignment bonus", "Install · <model>") — see serverLabels.
  // A kind this build does not know shows its title exactly as sent.
  const title = ledgerTitle(txn.title);
  // "Today · RGT-INST-0012", the way the server words it, but in the app's
  // language: the day is built here rather than taken from its English.
  const subtitle = `${relativeDayLabel(txn.at)} · ${txn.ticketCode}`;
  // Signed by `toTransaction` for known kinds; unsigned for one it does not.
  const amount = formatLedgerAmount(txn);

  const body = (pressed: boolean) => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
        paddingHorizontal: 15,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: palette.neutral[100],
        backgroundColor: pressed ? palette.neutral[50] : color.surfaceRaised,
      }}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 11,
          backgroundColor: style.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={style.icon} size={20} color={style.fg} />
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            fontFamily: 'Roboto_700Bold',
            fontSize: 14,
            color: color.textPrimary,
          }}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 11.5,
            color: color.textMuted,
          }}
        >
          {subtitle}
        </Text>
      </View>

      <Text style={{ fontFamily: 'Roboto_900Black', fontSize: 15, color: style.fg }}>
        {amount}
      </Text>

      {/* The affordance. Only on rows that go somewhere — a chevron on every
          line would make the ones that do not look broken when pressed. */}
      {onOpen ? (
        <Icon name="chevronRight" size={16} color={palette.neutral[400]} />
      ) : null}
    </View>
  );

  if (!onOpen) return body(false);

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      // The amount is read out too. A screen reader user pressing a row is
      // choosing between amounts as much as between job codes, and the visible
      // line already says all three.
      accessibilityLabel={`${title}. ${subtitle}. ${amount}`}
      accessibilityHint={t('earnings.opensJob')}
    >
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}