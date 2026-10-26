import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { ErrorState, Skeleton, showToast } from '@/components/feedback';
import { Icon } from '@/components/icons/Icon';
import { KeyboardFlow, ScreenStatusBar, TitleBar } from '@/components/layout';
import { Button, Input, Text } from '@/components/ui';
import { useJobParts } from '@/features/parts/hooks/useJobParts';
import { useRequestPart } from '@/features/parts/hooks/useRequestPart';
import {
  MAX_NOTE,
  MAX_OTHER,
  OTHER,
  buildPartRequest,
  filterParts,
  wasAlreadyRequested,
} from '@/features/parts/picker';
import { errorText } from '@/i18n/errorText';
import { color } from '@/theme/semantic';

/** Search appears only when the list is long enough to need it. */
const SEARCH_THRESHOLD = 8;

export interface PartRequestScreenProps {
  jobId: string;
}

/**
 * Ask the parts store for a spare part on this job.
 *
 * Net-new — not in the prototype; Task 15 PROPOSED copy. It mirrors
 * `CancelJobScreen`: a radio list, and one footer button whose label IS the
 * requirement while it is blocked (Select a part → Type the part's name →
 * Request part).
 *
 * The server's `canRequest` / `partsEnabled` decide whether the form is shown at
 * all — the status may have moved while this screen was open, and the stage
 * helper only decides whether to SHOW the way in. Part names are catalogue data
 * and are rendered exactly as sent.
 */
export function PartRequestScreen({ jobId }: PartRequestScreenProps) {
  const router = useRouter();
  const { t } = useTranslation();
  const parts = useJobParts(jobId);
  const request = useRequestPart(jobId);

  const [selected, setSelected] = useState<string | null>(null);
  const [otherName, setOtherName] = useState('');
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');

  const data = parts.data;
  const noFacility = data?.partsEnabled === false;
  const canAsk = !!data && !noFacility && data.canRequest;

  const body = buildPartRequest(selected, otherName, note);
  const label =
    selected === null
      ? t('parts.request.selectPart')
      : body === null
        ? t('parts.request.typeName')
        : t('parts.request.submit');

  const submit = () => {
    if (!body || !data) return;
    const before = data.requests;
    request.mutate(body, {
      onSuccess: (after) => {
        showToast(
          t(wasAlreadyRequested(before, after.requests) ? 'parts.request.already' : 'parts.request.sent'),
        );
        router.back();
      },
    });
  };

  const catalogue = data?.catalogue ?? [];
  const shown = filterParts(catalogue, query);

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="dark" />
      <TitleBar title={t('parts.request.title')} />

      <KeyboardFlow
        footer={
          canAsk ? (
            <View
              style={{
                backgroundColor: color.surfaceRaised,
                borderTopWidth: 1,
                borderTopColor: color.border,
                paddingTop: 12,
                paddingHorizontal: 16,
                paddingBottom: 16,
              }}
            >
              {/* The server's sentence, not a generic apology: a status that
                  moved or a franchise with no store is not fixed by tapping
                  again, and the code lets another language say so too. */}
              {request.isError ? (
                <Text
                  accessibilityRole="alert"
                  style={{
                    fontFamily: 'Roboto_500Medium',
                    fontSize: 12.5,
                    lineHeight: 18,
                    color: color.debit,
                    marginBottom: 10,
                  }}
                >
                  {request.error instanceof Error
                    ? errorText(request.error, t('parts.request.failed'))
                    : t('parts.request.failed')}
                </Text>
              ) : null}

              <Button
                label={label}
                disabled={body === null}
                loading={request.isPending}
                onPress={submit}
              />
            </View>
          ) : undefined
        }
      >
        <View style={{ padding: 16, paddingBottom: 20 }}>
          {parts.isError ? (
            <ErrorState body={t('parts.loadFailed')} onRetry={() => parts.refetch()} />
          ) : parts.isPending ? (
            <View style={{ gap: 12 }}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} width="100%" height={52} rounded={13} />
              ))}
            </View>
          ) : noFacility ? (
            <Notice text={t('parts.request.noFacility')} />
          ) : !canAsk ? (
            <Notice text={t('parts.request.notNow')} />
          ) : (
            <>
              <Text
                style={{
                  fontFamily: 'Roboto_400Regular',
                  fontSize: 13.5,
                  lineHeight: 20,
                  color: color.textLabel,
                  marginHorizontal: 2,
                  marginBottom: 14,
                }}
              >
                {t('parts.request.intro')}
              </Text>

              {catalogue.length > SEARCH_THRESHOLD ? (
                <View style={{ marginBottom: 14 }}>
                  <Input
                    value={query}
                    onChangeText={setQuery}
                    placeholder={t('parts.request.search')}
                  />
                </View>
              ) : null}

              {catalogue.length === 0 ? (
                <Text
                  style={{
                    fontFamily: 'Roboto_400Regular',
                    fontSize: 13,
                    lineHeight: 19,
                    color: color.textSecondary,
                    marginHorizontal: 2,
                    marginBottom: 12,
                  }}
                >
                  {t('parts.request.noParts')}
                </Text>
              ) : shown.length === 0 ? (
                <Text
                  style={{
                    fontFamily: 'Roboto_400Regular',
                    fontSize: 13,
                    lineHeight: 19,
                    color: color.textSecondary,
                    marginHorizontal: 2,
                    marginBottom: 12,
                  }}
                >
                  {t('parts.request.noMatch', { query: query.trim() })}
                </Text>
              ) : (
                shown.map((part) => (
                  <RadioRow
                    key={part.id}
                    // Catalogue data — never through `t()`.
                    label={part.name}
                    selected={selected === part.id}
                    onPress={() => setSelected(part.id)}
                  />
                ))
              )}

              <RadioRow
                label={t('parts.request.other')}
                selected={selected === OTHER}
                onPress={() => setSelected(OTHER)}
              />

              {selected === OTHER ? (
                <View style={{ marginBottom: 14 }}>
                  <Input
                    label={t('parts.request.otherLabel')}
                    value={otherName}
                    onChangeText={setOtherName}
                    placeholder={t('parts.request.otherPlaceholder')}
                    maxLength={MAX_OTHER}
                    autoFocus
                  />
                </View>
              ) : null}

              <View style={{ marginTop: 6 }}>
                <Input
                  label={t('parts.request.noteLabel')}
                  value={note}
                  onChangeText={setNote}
                  placeholder={t('parts.request.notePlaceholder')}
                  maxLength={MAX_NOTE}
                  multiline
                />
              </View>
            </>
          )}
        </View>
      </KeyboardFlow>
    </View>
  );
}

/** The `CancelJobScreen` reason row — a 22 px ring that fills when chosen. */
function RadioRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          backgroundColor: color.surfaceRaised,
          borderWidth: 1.5,
          borderColor: selected ? color.borderFocus : color.border,
          borderRadius: 13,
          paddingVertical: 14,
          paddingHorizontal: 15,
          marginBottom: 10,
        }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            borderWidth: 2,
            borderColor: selected ? color.borderFocus : color.borderStrong,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: 11,
              height: 11,
              borderRadius: 5.5,
              backgroundColor: selected ? color.actionBg : 'transparent',
            }}
          />
        </View>

        <Text
          style={{
            flex: 1,
            fontFamily: 'Roboto_500Medium',
            fontSize: 14.5,
            color: color.textPrimary,
          }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

/** A reason there is no form — no button follows it. */
function Notice({ text }: { text: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: color.surfaceSunken,
        borderRadius: 14,
        paddingVertical: 14,
        paddingHorizontal: 15,
      }}
    >
      <Icon name="info" size={20} color={color.textLabel} strokeWidth={1.8} />
      <Text
        style={{
          flex: 1,
          fontFamily: 'Roboto_500Medium',
          fontSize: 13,
          lineHeight: 19,
          color: color.textLabel,
        }}
      >
        {text}
      </Text>
    </View>
  );
}
