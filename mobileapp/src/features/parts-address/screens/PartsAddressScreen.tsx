import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ErrorState, Skeleton, showToast } from '@/components/feedback';
import { KeyboardFlow, ScreenStatusBar, TitleBar } from '@/components/layout';
import { Button, Input, Text } from '@/components/ui';
import { isUnknownPincode } from '@/features/parts-address/api/partsAddress';
import {
  usePartsAddress,
  useRemovePartsAddress,
  useSavePartsAddress,
} from '@/features/parts-address/hooks/usePartsAddress';
import {
  CITY_MAX,
  EMPTY_FORM,
  LANDMARK_MAX,
  LINE_MAX,
  digitsOnly,
  toBody,
  validatePartsAddress,
  type PartsAddressErrors,
  type PartsAddressForm,
} from '@/features/parts-address/lib/schema';
import { useMe } from '@/features/profile/hooks/useMe';
import { errorText } from '@/i18n/errorText';
import { color } from '@/theme/semantic';

const BODY = {
  fontFamily: 'Roboto_400Regular',
  fontSize: 13,
  lineHeight: 19,
  color: color.textLabel,
} as const;

const ERROR_LINE = {
  fontFamily: 'Roboto_500Medium',
  fontSize: 12.5,
  lineHeight: 18,
  color: color.debit,
} as const;

/**
 * Profile → Parts delivery address.
 *
 * Where a spare part is sent. With none saved, a request goes to the base
 * pincode area; the server copies the address onto each request when it is
 * raised, so editing it here never redirects a part already on its way.
 *
 * Net-new copy — PROPOSED, not from the prototype; awaiting sign-off.
 */
export function PartsAddressScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const me = useMe();
  const query = usePartsAddress();
  const save = useSavePartsAddress();
  const remove = useRemovePartsAddress();

  const [form, setForm] = useState<PartsAddressForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<PartsAddressErrors>({});
  const [filled, setFilled] = useState(false);

  // Fill the form once from what is saved; later refetches never overwrite typing.
  useEffect(() => {
    if (filled || query.data === undefined) return;
    const a = query.data;
    if (a) {
      setForm({
        line: a.line,
        city: a.city,
        pincode: a.pincode,
        landmark: a.landmark ?? '',
        contactPhone: a.contactPhone ? a.contactPhone.replace(/^\+91/, '') : '',
      });
    }
    setFilled(true);
  }, [query.data, filled]);

  const set = (field: keyof PartsAddressForm, value: string) => {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
    if (save.isError) save.reset();
  };

  const submit = () => {
    const found = validatePartsAddress(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    save.mutate(toBody(form), {
      onSuccess: () => {
        showToast(t('partsAddress.saved'));
        router.back();
      },
    });
  };

  const clear = () => {
    remove.mutate(undefined, {
      onSuccess: () => {
        showToast(t('partsAddress.removed'));
        router.back();
      },
    });
  };

  const fieldError = (field: keyof PartsAddressForm): string | undefined => {
    switch (errors[field]) {
      case 'partsAddress.errors.line':
        return t('partsAddress.errors.line');
      case 'partsAddress.errors.city':
        return t('partsAddress.errors.city');
      case 'partsAddress.errors.pincode':
        return t('partsAddress.errors.pincode');
      case 'partsAddress.errors.landmark':
        return t('partsAddress.errors.landmark');
      case 'partsAddress.errors.phone':
        return t('partsAddress.errors.phone');
      default:
        return undefined;
    }
  };

  const unknownPincode = isUnknownPincode(save.error);
  const pincodeError =
    fieldError('pincode') ?? (unknownPincode ? t('partsAddress.errors.unknownPincode') : undefined);
  const otherSaveError = save.isError && !unknownPincode ? save.error : null;

  const basePincode = me.data?.baseLocation?.pincode ?? null;
  const saved = !!query.data;
  const busy = save.isPending || remove.isPending;

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="dark" />
      <TitleBar title={t('partsAddress.title')} />

      {query.isError ? (
        <View style={{ padding: 16 }}>
          <ErrorState body={t('partsAddress.loadFailed')} onRetry={() => query.refetch()} />
        </View>
      ) : query.isPending ? (
        <View style={{ padding: 16, gap: 12 }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} width="100%" height={52} rounded={13} />
          ))}
        </View>
      ) : (
        <KeyboardFlow
          footer={
            <View
              style={{
                backgroundColor: color.surfaceRaised,
                borderTopWidth: 1,
                borderTopColor: color.border,
                paddingTop: 12,
                paddingHorizontal: 16,
                paddingBottom: 16,
                gap: 10,
              }}
            >
              {otherSaveError ? (
                <Text accessibilityRole="alert" style={ERROR_LINE}>
                  {errorText(otherSaveError, t('partsAddress.saveFailed'))}
                </Text>
              ) : null}
              {remove.isError ? (
                <Text accessibilityRole="alert" style={ERROR_LINE}>
                  {errorText(remove.error, t('partsAddress.removeFailed'))}
                </Text>
              ) : null}
              <Button
                label={t('partsAddress.save')}
                loading={save.isPending}
                disabled={busy}
                onPress={submit}
              />
              {saved ? (
                <Button
                  label={t('partsAddress.remove')}
                  variant="dangerOutline"
                  loading={remove.isPending}
                  disabled={busy}
                  onPress={clear}
                />
              ) : null}
            </View>
          }
        >
          <View style={{ padding: 16, paddingBottom: 24, gap: 14 }}>
            <Text style={[BODY, { paddingHorizontal: 4 }]}>{t('partsAddress.intro')}</Text>

            <Text style={[BODY, { paddingHorizontal: 4 }]}>
              {basePincode
                ? t('partsAddress.baseHint', { pincode: basePincode })
                : t('partsAddress.baseHintUnknown')}
            </Text>

            <Input
              label={t('partsAddress.line')}
              value={form.line}
              onChangeText={(v) => set('line', v)}
              placeholder={t('partsAddress.linePlaceholder')}
              maxLength={LINE_MAX}
              error={fieldError('line')}
              editable={!busy}
              multiline
            />
            <Input
              label={t('partsAddress.city')}
              value={form.city}
              onChangeText={(v) => set('city', v)}
              maxLength={CITY_MAX}
              error={fieldError('city')}
              editable={!busy}
            />
            <Input
              label={t('partsAddress.pincode')}
              value={form.pincode}
              onChangeText={(v) => set('pincode', digitsOnly(v, 6))}
              keyboardType="number-pad"
              maxLength={6}
              error={pincodeError}
              editable={!busy}
            />
            <Input
              label={t('partsAddress.landmark')}
              value={form.landmark}
              onChangeText={(v) => set('landmark', v)}
              maxLength={LANDMARK_MAX}
              error={fieldError('landmark')}
              editable={!busy}
            />
            <Input
              label={t('partsAddress.phone')}
              prefix="+91"
              value={form.contactPhone}
              onChangeText={(v) => set('contactPhone', digitsOnly(v, 10))}
              placeholder={t('partsAddress.phonePlaceholder')}
              keyboardType="phone-pad"
              maxLength={10}
              error={fieldError('contactPhone')}
              editable={!busy}
            />
          </View>
        </KeyboardFlow>
      )}
    </View>
  );
}
