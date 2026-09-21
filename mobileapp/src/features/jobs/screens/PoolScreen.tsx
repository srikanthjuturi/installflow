import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, View } from 'react-native';

import { ErrorState, JobCardSkeleton } from '@/components/feedback';
import { ScreenStatusBar, TitleBar } from '@/components/layout';
import { FilterChips, type FilterChipOption, Text } from '@/components/ui';
import { useAcceptingWork } from '@/features/availability/hooks/useAvailability';
import { PoolJobCard } from '@/features/jobs/components/PoolJobCard';
import { usePool } from '@/features/jobs/hooks/useJobs';
import { useMe } from '@/features/profile/hooks/useMe';
import { useButtonNavInset } from '@/hooks/useButtonNavInset';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { shortCategory } from '@/lib/shortCategory';
import { color } from '@/theme/semantic';

/** The chip that filters nothing. Safe beside the others: those are UUIDs. */
const ALL = 'all';

/**
 * Screen 4 — Open job pool.
 *
 * Two kinds of job now, and the card says which. One carries a
 * customer-confirmed slot and the only decision is whether to commit to that
 * time. The other has no time yet: it is offered from the moment the vendor
 * raises it, in parallel with the customer being asked to pick a window, and
 * accepting it commits to the JOB rather than to an hour.
 *
 * Both are real work and both pay the same, which is why they share a list.
 *
 * The intro sits in the content rather than the title bar, and states
 * first-accept-wins up front: a technician who reads a card carefully can lose
 * it to someone faster, and that has to read as the rule rather than a fault.
 *
 * The category chips NARROW a list the server has already limited to what this
 * technician is certified for. They filter the page already on the phone, so
 * switching is instant and every chip can carry its count — and they never
 * widen anything, because eligibility is decided in SQL, not here.
 */
export function PoolScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const online = useAcceptingWork();
  const { data, isPending, isError, refetch } = usePool();
  const { data: me } = useMe();
  // Local, not a store: pushing an offer leaves this screen mounted underneath,
  // so the choice survives a look at a job and resets on the next visit.
  const [filter, setFilter] = useState<string>(ALL);
  // Room for the ◁ ○ □ bar, so the last card clears it — see the hook.
  const navInset = useButtonNavInset();
  // The list polls itself, but a technician who has just been told about a job
  // on the phone will pull anyway — and being unable to is what makes an app
  // feel stuck. The spinner follows the pull only: tied to `isRefetching` it
  // also lit up on every poll, with nobody touching the screen.
  const pull = usePullToRefresh(refetch);

  const subcategories = me?.subcategories;
  const chips = useMemo<FilterChipOption<string>[]>(() => {
    // One category is nothing to choose between — "All" and it are the same
    // list. And an API that predates `nodePathIds` gives nothing to match on;
    // drawing chips then would make every category read 0.
    if (!data || data.length === 0 || !subcategories || subcategories.length < 2) return [];
    if (data.some((job) => !job.nodePathIds)) return [];

    return [
      { value: ALL, label: t('jobs.pool.all'), count: data.length },
      ...subcategories.map((s) => ({
        value: s.id,
        label: shortCategory(s.name),
        // Their certified id ANYWHERE on the job's path — the test the server
        // used to offer it — so a *Television* chip counts *Android TV* jobs.
        count: data.filter((job) => job.nodePathIds?.includes(s.id)).length,
      })),
    ];
  }, [data, subcategories, t]);

  // A chip that has gone — a manager removed that category, and `me` refreshed
  // — falls back to All rather than leaving the list filtered by a choice
  // nobody can see. So does a row that is not drawn at all.
  const active = chips.find((c) => c.value === filter);
  const activeValue = active?.value ?? ALL;
  const visible =
    activeValue === ALL
      ? (data ?? [])
      : (data ?? []).filter((job) => job.nodePathIds?.includes(activeValue));

  return (
    <View style={{ flex: 1, backgroundColor: color.surface }}>
      <ScreenStatusBar style="dark" />
      <TitleBar title={t('jobs.pool.title')} onBack={() => router.replace('/(app)/(tabs)')} />

      <ScrollView
        contentContainerStyle={{
          paddingTop: 14,
          paddingHorizontal: 16,
          paddingBottom: 24 + navInset,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...pull} />}
      >
        <Text
          style={{
            fontFamily: 'Roboto_400Regular',
            fontSize: 12.5,
            lineHeight: 19,
            color: color.textSecondary,
            marginHorizontal: 2,
            marginBottom: 14,
          }}
        >
          {/* ⚠ CHANGED FROM APPROVED COPY, and it had to be. The approved line
              opened "Confirmed slots matching your category & pincodes", which
              is no longer true: a job is offered from the moment it is raised,
              before the customer has picked a time. Leaving it would be the
              screen telling a technician every card has a slot while some of
              them plainly say otherwise.

              Pending sign-off. The two clauses that ARE approved — first to
              accept wins, details masked until you accept — are kept verbatim,
              because neither changed. */}
          {t('jobs.pool.intro')}
        </Text>

        {!online ? (
          /* `usePool` is `enabled: online`, and a DISABLED query in Query v5
             never leaves `pending` — so without this branch an offline
             technician sat in front of three loading skeletons forever, with
             nothing saying why or how to fix it. */
          <Notice
            title={t('jobs.pool.offlineTitle')}
            body={t('jobs.pool.offlineBody')}
          />
        ) : isPending ? (
          <>
            <JobCardSkeleton />
            <JobCardSkeleton />
            <JobCardSkeleton />
          </>
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : data.length === 0 ? (
          <Notice title={t('jobs.pool.emptyTitle')} body={t('jobs.pool.emptyBody')} />
        ) : (
          <>
            {chips.length > 0 ? (
              <View style={{ marginBottom: 14 }}>
                <FilterChips options={chips} value={activeValue} onChange={setFilter} />
              </View>
            ) : null}
            {visible.length === 0 && active ? (
              // Not "Pool is empty": there IS work, just not in this category,
              // and the chips stay above so the way back is one tap.
              <Notice
                title={t('jobs.pool.noneInCategory', { category: active.label })}
                body={t('jobs.pool.tapAll', { all: t('jobs.pool.all') })}
              />
            ) : (
              visible.map((job) => (
                <PoolJobCard
                  key={job.id}
                  job={job}
                  onPress={() => router.push(`/pool/${job.id}`)}
                />
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

/** The screen's three no-cards states — offline, empty, and empty for a chip. */
function Notice({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 50, paddingHorizontal: 20 }}>
      <Text style={{ fontFamily: 'Roboto_700Bold', fontSize: 14.5, color: color.textLabel }}>
        {title}
      </Text>
      <Text
        style={{
          fontFamily: 'Roboto_400Regular',
          fontSize: 12.5,
          color: color.textMuted,
          marginTop: 4,
          textAlign: 'center',
        }}
      >
        {body}
      </Text>
    </View>
  );
}
