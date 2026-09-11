import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';

import { ScreenStatusBar, TitleBar } from '@/components/layout';
import { Button, Checkbox, Input } from '@/components/ui';
import { UpiScanner } from '@/features/payout/components/UpiScanner';
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
 *
 * ## Nothing can check a UPI ID is real — so the screen does the honest things
 *
 * No bank answers "does this address exist, and is it theirs?" without a
 * payment provider, so there is no green tick to show. Instead, from the
 * integration guide redemptions were built on:
 *
 *   * **a scan before a keyboard** — the address is already on a QR their
 *     bank gave them (`UpiScanner`);
 *   * **the payee as a UPI app shows it** — name above address. People do not
 *     proof-read their own typing; they do recognise their own name;
 *   * **a tick worded as their own claim**, required to save a new address.
 *     A scan fills the field and NEVER ticks the box — a scan can read the
 *     wrong QR — and any edit after ticking un-ticks it, because the claim was
 *     about the value that was there.
 *
 * Changes stay free. Each redemption freezes the address it was requested
 * with, so an edit here never redirects money already asked for.
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
  /** The name a scanned QR carried, shown on the payee card. */
  const [scannedName, setScannedName] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [scanning, setScanning] = useState(false);
  const value = draft ?? stored ?? '';

  const trimmed = value.trim();
  const invalid = trimmed !== '' && !VPA.test(trimmed);
  // Nothing to save until it actually differs from what is on file. Comparing
  // against the normalised form the server stores, so re-typing the same
  // address in capitals is correctly read as no change.
  const next = trimmed === '' ? null : trimmed.toLowerCase();
  const changed = next !== stored;
  // Clearing needs no claim — there is no address to vouch for.
  const needsClaim = changed && next !== null && !invalid;

  const edit = (text: string) => {
    setDraft(text);
    setScannedName(null);
    setConfirmed(false);
  };

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
            onChangeText={edit}
            placeholder="e.g. 9822066301@ybl"
            editable={!me.isPending && !save.isPending}
            keyboardType="email-address"
            maxLength={256}
            error={invalid ? 'Enter a UPI ID like name@bank' : undefined}
          />

          <View style={{ marginTop: 12 }}>
            <Button
              label="Scan my UPI QR"
              variant="outline"
              leadingIcon="qr"
              disabled={me.isPending || save.isPending}
              onPress={() => setScanning(true)}
            />
          </View>

          <Text
            style={{
              fontFamily: 'Roboto_400Regular',
              fontSize: 12,
              lineHeight: 18,
              color: color.textMuted,
              marginTop: 12,
            }}
          >
            {/* Said plainly, because the alternative is somebody assuming an
                empty box is why they have not been paid for work they did. */}
            Leave it empty to remove the account. You still earn for every job
            you finish — this only decides where the money goes.
          </Text>
        </View>

        {needsClaim && next ? (
          <View
            style={{
              backgroundColor: color.surfaceRaised,
              borderWidth: 1,
              borderColor: color.border,
              borderRadius: 16,
              padding: 18,
              marginTop: 14,
              gap: 16,
            }}
          >
            <PayeeCard name={scannedName ?? me.data?.name ?? '—'} vpa={next} />
            <Checkbox
              checked={confirmed}
              onChange={setConfirmed}
              label="This is my UPI ID and the name is mine"
              disabled={save.isPending}
            />
          </View>
        ) : null}

        <View style={{ marginTop: 16 }}>
          <Button
            label={save.isPending ? 'Saving…' : 'Save'}
            disabled={
              me.isPending || save.isPending || invalid || !changed || (needsClaim && !confirmed)
            }
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

      <UpiScanner
        visible={scanning}
        onClose={() => setScanning(false)}
        onScanned={({ vpa, name }) => {
          setScanning(false);
          setDraft(vpa);
          setScannedName(name);
          // Deliberately NOT ticked: the scan may have read the wrong QR, and
          // the tick is the technician's claim, not the camera's.
          setConfirmed(false);
        }}
      />
    </View>
  );
}

/**
 * The payee, laid out the way a UPI app lays one out — name above address.
 *
 * The name is the one a scanned QR carried, or the technician's own when they
 * typed the address: either way, the thing they will recognise at a glance
 * when it is theirs, and notice when it is not.
 */
function PayeeCard({ name, vpa }: { name: string; vpa: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: color.statusUpcoming.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{ fontFamily: 'Roboto_700Bold', fontSize: 18, color: color.statusUpcoming.fg }}
        >
          {initial}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ fontFamily: 'Roboto_700Bold', fontSize: 15, color: color.textPrimary }}
        >
          {name}
        </Text>
        <Text
          numberOfLines={1}
          selectable
          style={{
            fontFamily: 'Roboto_500Medium',
            fontSize: 13,
            color: color.textSecondary,
            marginTop: 2,
          }}
        >
          {vpa}
        </Text>
      </View>
    </View>
  );
}
