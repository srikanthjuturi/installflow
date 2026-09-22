import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { ErrorState, Skeleton } from '@/components/feedback';
import {
  KeyboardFlow,
  ScreenStatusBar,
  TitleBar,
  useKeyboardVisible,
} from '@/components/layout';
import { Button, Input, Text } from '@/components/ui';
import { OtpInput } from '@/features/auth/components/OtpInput';
import { useResendTimer } from '@/features/auth/hooks/useResendTimer';
import type { PayoutAccount } from '@/features/payout/api/payout';
import { UpiScanner } from '@/features/payout/components/UpiScanner';
import {
  usePayoutAccount,
  useRequestUpiChange,
  useSendPayoutCode,
  useVerifyPayoutAccount,
  useWithdrawUpiChange,
} from '@/features/payout/hooks/usePayoutAccount';
import { useMe } from '@/features/profile/hooks/useMe';
import { useButtonNavInset } from '@/hooks/useButtonNavInset';
import { errorText } from '@/i18n/errorText';
import { roleLabel } from '@/i18n/serverLabels';
import { color } from '@/theme/semantic';

/**
 * The shape of a UPI VPA — `name@bank`.
 *
 * A faster message, not a second gate: the server validates the same rule in
 * `app/core/upi.py` and is the authority.
 */
const VPA = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,48}@[a-zA-Z][a-zA-Z0-9]{1,29}$/;
const NAME_MIN = 2;
const NAME_MAX = 80;

/** "+919876543210" → "+91 98765 43210". */
function prettyPhone(e164: string | undefined): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164 ?? '');
  return m ? `+91 ${m[1]} ${m[2]}` : (e164 ?? '');
}

const CARD = {
  backgroundColor: color.surfaceRaised,
  borderWidth: 1,
  borderColor: color.border,
  borderRadius: 16,
  padding: 18,
} as const;

/**
 * Profile → Payout account — where a technician's earnings are paid.
 *
 * ## Two ways in, one proof
 *
 * The UPI ID and the name on the account arrive either from a SCAN of the QR
 * their UPI app or bank gave them (both fields filled from it) or TYPED. Either
 * way it is saved only after a one-time code sent to their registered WhatsApp
 * number is entered — the number is the account's, read by the server, never
 * chosen here.
 *
 * ## After that, a manager changes it
 *
 * Once one is on file this screen shows it read-only. A change is a REQUEST
 * carrying the new UPI ID and name; the Area Manager for their area (else the
 * Regional Head, else a National Head, else an Admin) approves it, with no
 * code. It is where money lands, and redirecting it is exactly what somebody
 * holding a borrowed phone would try.
 *
 * Net-new copy, approved 2026-09-11 — the prototype drew this row as a static
 * `••4432`.
 */
export function PayoutAccountScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const account = usePayoutAccount();

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="dark" />
      <TitleBar title={t('payout.title')} paddingBottom={14} />

      {account.isPending ? (
        <View style={{ padding: 16, gap: 12 }}>
          <Skeleton width="100%" height={150} rounded={16} />
          <Skeleton width="100%" height={54} rounded={14} />
        </View>
      ) : account.isError ? (
        <ErrorState onRetry={() => account.refetch()} />
      ) : account.data.upiId ? (
        <OnFile account={account.data} ownName={me.data?.name ?? ''} />
      ) : (
        <AddUpi phone={me.data?.phone} ownName={me.data?.name ?? ''} />
      )}
    </View>
  );
}

// ── adding one ────────────────────────────────────────────────────────────────

function AddUpi({ phone, ownName }: { phone: string | undefined; ownName: string }) {
  const { t } = useTranslation();
  const draft = useUpiDraft(ownName);
  const sendCode = useSendPayoutCode();
  const verify = useVerifyPayoutAccount();
  const timer = useResendTimer(30);
  const [code, setCode] = useState('');

  const sent = sendCode.isSuccess;
  const devCode = sendCode.data?.devCode ?? null;
  const error = verify.error ?? sendCode.error;
  const bottomRoom = useBottomRoom();

  const send = () => {
    if (!draft.valid) return;
    setCode('');
    sendCode.mutate(
      { upiId: draft.vpa, upiName: draft.name },
      { onSuccess: () => timer.restart() },
    );
  };

  return (
    // KeyboardFlow keeps whichever field is being typed into in sight above the
    // keyboard — for the code, that is the boxes with "Verify & save" under
    // them, the last things on the screen.
    <KeyboardFlow>
      <View style={{ padding: 16, paddingBottom: bottomRoom, gap: 14 }}>
        <View style={CARD}>
          <Text style={BODY}>
            {t('payout.add.intro')}
          </Text>
          <UpiFields draft={draft} disabled={verify.isPending || sendCode.isPending} />
        </View>

        {draft.valid ? <PayeeCard name={draft.name} vpa={draft.vpa} /> : null}

        {sent ? (
          <View style={CARD}>
            <Text style={BODY}>
              {t('payout.add.codeSent', { phone: prettyPhone(phone) })}
            </Text>
            <OtpInput value={code} onChange={setCode} />
            <Pressable
              disabled={!timer.canResend || sendCode.isPending}
              onPress={send}
              style={{ marginTop: 14, alignSelf: 'flex-start' }}
            >
              <Text
                style={{
                  fontFamily: 'Roboto_500Medium',
                  fontSize: 12.5,
                  color: timer.canResend ? color.actionBg : color.textMuted,
                }}
              >
                {timer.canResend
                  ? t('common.sendNewCode')
                  : t('common.sendNewCodeIn', { time: timer.label })}
              </Text>
            </Pressable>
            {devCode ? <DevCode code={devCode} onUse={() => setCode(devCode)} /> : null}
          </View>
        ) : null}

        {error ? <ErrorLine error={error} /> : null}

        {sent ? (
          <Button
            label={t('payout.add.verify')}
            loading={verify.isPending}
            disabled={code.length < 6 || !draft.valid}
            onPress={() => verify.mutate({ upiId: draft.vpa, upiName: draft.name, code })}
          />
        ) : (
          <Button
            label={t('payout.add.sendCode')}
            loading={sendCode.isPending}
            disabled={!draft.valid}
            onPress={send}
          />
        )}
      </View>
    </KeyboardFlow>
  );
}

/**
 * The space under this screen's last button — "Verify & save" or "Request a
 * change". Enough to clear Android's ◁ ○ □ bar when the phone has one, but not
 * while typing: the keyboard is drawn over that bar (see `keyboard.ts`).
 */
function useBottomRoom(): number {
  const navInset = useButtonNavInset();
  const keyboardUp = useKeyboardVisible();
  return 40 + (keyboardUp ? 0 : navInset);
}

// ── one on file ───────────────────────────────────────────────────────────────

function OnFile({ account, ownName }: { account: PayoutAccount; ownName: string }) {
  const { t } = useTranslation();
  const [changing, setChanging] = useState(false);
  const change = account.change;
  const pending = change?.status === 'pending' ? change : null;
  const rejected = change?.status === 'rejected' ? change : null;
  const bottomRoom = useBottomRoom();

  return (
    <KeyboardFlow>
      <View style={{ padding: 16, paddingBottom: bottomRoom, gap: 14 }}>
        <View style={CARD}>
          <Text style={BODY}>
            {t('payout.onFile.intro')}
          </Text>
          <PayeeCard
            name={account.upiName || ownName || '—'}
            vpa={account.upiId ?? '—'}
            bare
          />
        </View>

        {pending ? (
          <PendingChange
            name={pending.newUpiName}
            vpa={pending.newUpiId}
            reviewer={roleLabel(pending.reviewerLabel)}
          />
        ) : changing ? (
          <ChangeForm ownName={ownName} onDone={() => setChanging(false)} />
        ) : (
          <>
            {rejected ? (
              <View
                style={[
                  CARD,
                  { backgroundColor: color.dangerSurface, borderColor: color.dangerSurfaceBorder },
                ]}
              >
                <Text
                  style={{
                    fontFamily: 'Roboto_500Medium',
                    fontSize: 13,
                    lineHeight: 19,
                    color: color.dangerTextStrong,
                  }}
                >
                  {t('payout.onFile.rejected', {
                    upiId: rejected.newUpiId,
                    reason: rejected.rejectReason ?? '—',
                  })}
                </Text>
              </View>
            ) : null}
            <Button
              label={t('payout.onFile.requestChange')}
              variant="outline"
              onPress={() => setChanging(true)}
            />
          </>
        )}
      </View>
    </KeyboardFlow>
  );
}

function PendingChange({ name, vpa, reviewer }: { name: string; vpa: string; reviewer: string }) {
  const { t } = useTranslation();
  const withdraw = useWithdrawUpiChange();
  return (
    <View style={CARD}>
      <Text style={LABEL}>{t('payout.pending.title')}</Text>
      <PayeeCard name={name} vpa={vpa} bare />
      <Text style={[BODY, { marginTop: 12, marginBottom: 14 }]}>
        {t('payout.pending.waiting', { reviewer })}
      </Text>
      <Button
        label={t('payout.pending.withdraw')}
        variant="dangerOutline"
        loading={withdraw.isPending}
        onPress={() => withdraw.mutate()}
      />
      {withdraw.error ? <ErrorLine error={withdraw.error} /> : null}
    </View>
  );
}

function ChangeForm({ ownName, onDone }: { ownName: string; onDone: () => void }) {
  const { t } = useTranslation();
  const draft = useUpiDraft(ownName);
  const request = useRequestUpiChange();

  return (
    <>
      <View style={CARD}>
        <Text style={LABEL}>{t('payout.change.title')}</Text>
        <UpiFields draft={draft} disabled={request.isPending} />
      </View>
      {draft.valid ? <PayeeCard name={draft.name} vpa={draft.vpa} /> : null}
      {request.error ? <ErrorLine error={request.error} /> : null}
      {/* A pair, side by side and the same height. A ghost "Cancel" under the
          CTA is right on a white sheet, where the app uses it; on this grey
          screen, between cards, it read as stray grey text. `secondary` is the
          app's button for a second choice on a grey screen. */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button
            label={t('common.cancel')}
            variant="secondary"
            onPress={onDone}
            disabled={request.isPending}
          />
        </View>
        <View style={{ flex: 2 }}>
          <Button
            label={t('payout.change.send')}
            loading={request.isPending}
            disabled={!draft.valid}
            onPress={() =>
              request.mutate({ upiId: draft.vpa, upiName: draft.name }, { onSuccess: onDone })
            }
          />
        </View>
      </View>
    </>
  );
}

// ── the two fields, and the scan that fills them ──────────────────────────────

interface UpiDraft {
  rawVpa: string;
  setVpa: (v: string) => void;
  /** What is in the box, spaces and all — so a space can be typed. */
  rawName: string;
  setName: (v: string) => void;
  /** Trimmed, spaces collapsed — what is sent and shown on the payee card. */
  name: string;
  /** Lowercased, trimmed — what is sent. */
  vpa: string;
  vpaInvalid: boolean;
  nameInvalid: boolean;
  valid: boolean;
  scanning: boolean;
  setScanning: (v: boolean) => void;
}

function useUpiDraft(ownName: string): UpiDraft {
  const [rawVpa, setVpa] = useState('');
  // Their own name to start with — the commonest answer, and one they will
  // correct if the account is in another form of it.
  const [rawName, setName] = useState(ownName);
  const [scanning, setScanning] = useState(false);

  const vpa = rawVpa.trim().toLowerCase();
  const cleanName = rawName.trim().replace(/\s+/g, ' ');
  const vpaInvalid = vpa !== '' && !VPA.test(vpa);
  const nameInvalid = cleanName.length < NAME_MIN || cleanName.length > NAME_MAX;
  return {
    rawVpa,
    setVpa,
    rawName,
    setName,
    name: cleanName,
    vpa,
    vpaInvalid,
    nameInvalid,
    valid: vpa !== '' && !vpaInvalid && !nameInvalid,
    scanning,
    setScanning,
  };
}

function UpiFields({ draft, disabled }: { draft: UpiDraft; disabled: boolean }) {
  const { t } = useTranslation();

  return (
    <View style={{ gap: 14, marginTop: 14 }}>
      <Button
        label={t('payout.fields.scan')}
        variant="outline"
        leadingIcon="qr"
        disabled={disabled}
        onPress={() => draft.setScanning(true)}
      />
      <Input
        label={t('payout.fields.upiId')}
        value={draft.rawVpa}
        onChangeText={draft.setVpa}
        placeholder={t('payout.fields.upiIdPlaceholder')}
        editable={!disabled}
        keyboardType="email-address"
        maxLength={256}
        error={draft.vpaInvalid ? t('payout.fields.upiIdInvalid') : undefined}
      />
      <Input
        label={t('payout.fields.name')}
        value={draft.rawName}
        onChangeText={draft.setName}
        placeholder={t('payout.fields.namePlaceholder')}
        editable={!disabled}
        maxLength={NAME_MAX}
        error={
          draft.rawName.trim() !== '' && draft.nameInvalid
            ? t('payout.fields.nameInvalid')
            : undefined
        }
      />
      <UpiScanner
        visible={draft.scanning}
        onClose={() => draft.setScanning(false)}
        onScanned={({ vpa, name }) => {
          draft.setScanning(false);
          // Both fields from the QR — the name only when it carried one, so a
          // bare-address code does not wipe what they typed.
          draft.setVpa(vpa);
          if (name) draft.setName(name);
        }}
      />
    </View>
  );
}

// ── pieces ────────────────────────────────────────────────────────────────────

/**
 * The payee, laid out the way a UPI app lays one out — name above address.
 * People do not proof-read their own typing; they do recognise their own name.
 */
function PayeeCard({ name, vpa, bare }: { name: string; vpa: string; bare?: boolean }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: 12 },
        bare ? { marginTop: 14 } : CARD,
      ]}
    >
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
        <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 18, color: color.statusUpcoming.fg }}>
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

function ErrorLine({ error }: { error: unknown }) {
  const { t } = useTranslation();

  return (
    <Text
      style={{
        fontFamily: 'Roboto_400Regular',
        fontSize: 12.5,
        lineHeight: 18,
        color: color.textDanger,
        textAlign: 'center',
        marginTop: 4,
      }}
    >
      {/* The server's own words — it knows why it refused. */}
      {error instanceof Error
        ? errorText(error, t('payout.saveFailed'))
        : t('payout.saveFailed')}
    </Text>
  );
}

/**
 * Development only — the server echoes the code when `OTP_DEV_ECHO` is on, the
 * same panel the reschedule and joining screens show, for the same reason.
 */
function DevCode({ code, onUse }: { code: string; onUse: () => void }) {
  const { t } = useTranslation();

  return (
    <Pressable
      onPress={onUse}
      style={{
        marginTop: 14,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: color.borderStrong,
        borderRadius: 12,
        padding: 12,
      }}
    >
      <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 10.5, color: color.textMuted }}>
        {t('common.devOnly')}
      </Text>
      <Text
        style={{ fontFamily: 'Roboto_900Black', fontSize: 20, color: color.textPrimary, marginTop: 2 }}
      >
        {code}
      </Text>
    </Pressable>
  );
}

const BODY = {
  fontFamily: 'Roboto_400Regular',
  fontSize: 13,
  lineHeight: 20,
  color: color.textLabel,
} as const;

const LABEL = {
  fontFamily: 'Roboto_700Bold',
  fontSize: 12,
  color: color.textLabel,
} as const;
