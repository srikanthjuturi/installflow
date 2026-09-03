import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';

import { ScreenStatusBar, TitleBar } from '@/components/layout';
import { Button, Input } from '@/components/ui';
import { useMe } from '@/features/profile/hooks/useMe';
import { useSetUpiId } from '@/features/payout/hooks/usePayoutAccount';
import { color } from '@/theme/semantic';

/**
 * The shape of a UPI VPA — `name@bank`.
 *
 * Checked here only so an obvious mistake (an email address, a bare name) is
 * caught before a round trip. The server validates the same rule in
 * `app/core/upi.py` and is the authority; this is not a second gate, it is a
 * faster message.
 */
const VPA = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,48}@[a-zA-Z][a-zA-Z0-9]{1,29}$/;

/**
 * Profile → Payout account.
 *
 * Where a technician's earnings are paid. One field, and an explicit **Save**
 * rather than the debounced auto-save the bandwidth stepper uses: that is a
 * number somebody nudges up and down, this is a credential typed once and
 * checked twice, and money going to a half-typed address is not a mistake worth
 * making quietly.
 *
 * Empty is a real, common state — neither onboarding mode asks for a UPI id, so
 * a new technician has none. Saving an empty box CLEARS the account, which is
 * how somebody removes one they typed wrong without finding a manager.
 *
 * Not having one costs only the ability to be PAID. The ledger credits a
 * technician for every job they close either way, so this screen never blocks
 * anything and never nags.
 */
export function PayoutAccountScreen() {
  const me = useMe();
  const save = useSetUpiId();

  const stored = me.data?.upiId ?? null;
  /**
   * `undefined` means "not edited yet", so the field follows the server until
   * the technician touches it. Seeding state from `stored` directly would
   * freeze the first render's value — which on a cold start is whatever the
   * session store held, not what the profile fetch is about to return.
   */
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const value = draft ?? stored ?? '';

  const trimmed = value.trim();
  const invalid = trimmed !== '' && !VPA.test(trimmed);
  // Nothing to save until it actually differs from what is on file. Comparing
  // against the normalised form the server stores, so re-typing the same
  // address in capitals is correctly read as no change.
  const next = trimmed === '' ? null : trimmed.toLowerCase();
  const changed = next !== stored;

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="dark" />
      <TitleBar title="Payout account" paddingBottom={14} />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{
            backgroundColor: color.surfaceRaised,
            borderWidth: 1,
            borderColor: color.border,
            borderRadius: 16,
            padding: 18,
          }}
        >
          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 13,
              lineHeight: 20,
              color: color.textLabel,
              marginBottom: 16,
            }}
          >
            {me.isPending
              ? 'Loading your payout account…'
              : 'Your earnings are paid to this UPI ID. You can change it whenever you need to.'}
          </Text>

          <Input
            label="UPI ID"
            value={value}
            onChangeText={setDraft}
            placeholder="e.g. 9822066301@ybl"
            editable={!me.isPending && !save.isPending}
            keyboardType="email-address"
            maxLength={256}
            error={invalid ? 'Enter a UPI ID like name@bank' : undefined}
          />

          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 12,
              lineHeight: 18,
              color: color.textMuted,
              marginTop: 10,
            }}
          >
            {/* Said plainly, because the alternative is somebody assuming an
                empty box is why they have not been paid for work they did. */}
            Leave it empty to remove the account. You still earn for every job
            you finish — this only decides where the money goes.
          </Text>
        </View>

        <View style={{ marginTop: 16 }}>
          <Button
            label={save.isPending ? 'Saving…' : 'Save'}
            disabled={me.isPending || save.isPending || invalid || !changed}
            onPress={() => {
              save.mutate(next, {
                // Back to Profile, which shows the stored value in its own row —
                // so the save is confirmed by the thing it changed rather than
                // by a toast that says it happened.
                onSuccess: () => router.back(),
              });
            }}
          />
        </View>

        {save.isError ? (
          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 12.5,
              lineHeight: 18,
              color: color.debit,
              marginTop: 12,
              textAlign: 'center',
            }}
          >
            {/* The server's own words: it knows why it refused, and a generic
                "couldn't save" would send somebody guessing at a valid VPA. */}
            {save.error instanceof Error
              ? save.error.message
              : "Couldn't save your payout account. Try again."}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
