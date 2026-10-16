# Task 14 — Mobile: the technician's base location

> Layer: **mobileapp**. Depends on Task **10** (base-location API, `TechnicianSessionOut.baseLocation`) and on
> Task **07**'s release being live (index X4). Read [00-index.md](00-index.md) first.
> Adds the one native module the index allows (X3): **`react-native-webview`** — a new Play build is
> required (§5.0). Copy in §5.9 is **PROPOSED** (X2).

---

## 1. Goal & why

Travel allowance is measured **from the technician's base to the customer** (TA1). With no base, every job
the technician accepts pays ₹0 travel (TA8) — and nothing on the phone says so today. This task lets the
technician set their base three ways, nags gently until they do, and lets them change it later.

> **Worked example.** Ravi, a SkyFix freelancer, lives in 500049 (Miyapur). SkyFix's range is
> 500030–500040, so Miyapur is **outside** it.
>
> 1. Ravi joins from an invite. After *Confirm your number* he lands on a new last step,
>    **"Where do you start from?"** (step 5 of 5). He types **500049** under *My home pincode* and taps
>    *Use 500049*. The server answers *"That pincode is outside your service area…"* — the screen shows it
>    under the box and points at the other two options.
> 2. He taps **Use my current location** at home: the phone asks for location permission (already
>    declared for proof photos), finds him to ±12 m, and he taps *Save this location*. Home opens.
> 3. A week later he moves. **Profile → Base location** shows *Your location · set 15 Oct*. He taps
>    **Drop a pin on the map**: an OpenStreetMap map opens in a web view, he drags the pin onto his new
>    street and taps *Save this pin*.
> 4. Sunita, a SkyFix employee added directly by Meena, never saw the onboarding step. Her **Home** shows a
>    card, *Set your base location — until you do, jobs pay no travel allowance.* She taps it, types her
>    pincode 500035 (inside the range) and is done: the server uses that pincode's centre.
>
> A base only affects jobs accepted **after** it is set (TA5) — the screen says so.

---

## 2. Decisions implemented

| # | How |
|---|---|
| TA7 | Three ways: home pincode in the franchisee's range (its centre), *Use my current location* (GPS), OSM map pin in a web view. Onboarding step, Profile → Base location, Home card until set. |
| TA8 | Home card and Profile say plainly that no base = no travel allowance; accepting is never blocked. |
| TA5 | The screen states that a change affects jobs accepted from now on. |
| X3 | `react-native-webview` only — no `react-native-maps`. Flagged per root AGENTS.md (§5.0). |
| X2 | All strings PROPOSED, in all five locale files (§5.9). |
| Task 10 W8 | The phone sends only `pincode`, `gps` or `map` — never `manual` (that is a typed console coordinate). |
| R9 (owner ruling 2026-10-15) | A self-set base needs **no approval and no cooldown**: the phone saves straight away. The source and "set by the technician" are shown to the franchisee admin (and home managers) on the technician's profile and list, and the franchisee admin can correct the base at any time — so the app needs no extra screen, only the same `source` it already sends. Jobs already accepted keep their frozen base (the existing TA5 line). |
| R10 (owner ruling 2026-10-15) | **No travel estimate before accepting.** Nothing on the pool offer or its masked card shows a distance or an amount; travel appears only after accept (Task 15's Allowances card). |
| Mobile hard rules | Routes ~15 lines in `app/`; screens in `src/features/base-location/screens/`; server state in TanStack Query (the base lives on `qk.me()`); no hex outside `src/theme`; semantic colour roles; loading / empty / error states. |

---

## 3. Schema

None.

---

## 4. API contract assumed — Task 10 §4.7, as written

```
GET  /technicians/me/base-location      → BaseLocationOut | null       (technician principal, no feature key)
PUT  /technicians/me/base-location      → BaseLocationOut
GET  /technicians/me                    → TechnicianSessionOut + "baseLocation": BaseLocationOut | null
POST /auth/otp/verify                   → data.technicianProfile carries the same field
```

PUT body — exactly one of:

```json
{ "pincode": "500035" }
{ "latitude": 17.49512, "longitude": 78.35631, "source": "gps" }
{ "latitude": 17.49512, "longitude": 78.35631, "source": "map" }
```

`BaseLocationOut`:

```json
{ "latitude": 17.4951, "longitude": 78.3563, "pincode": null, "source": "gps",
  "setAt": "2026-10-15T05:30:00Z", "setBySelf": true }
```

`source` ∈ `pincode | gps | map | manual` (`manual` only ever set by a manager in the console). There is
**no DELETE** — a base is moved, never removed.

Errors (the app translates by `code`; English is the server's `message`):

| Status | Code | Server English (Task 10) |
|---|---|---|
| 422 | `PINCODE_OUTSIDE_FRANCHISEE` | That pincode is outside your service area. Drop a pin on the map or use your current location instead. |
| 400 | `PINCODE_HAS_NO_LOCATION` | We don't have a map location for that pincode yet. Drop a pin on the map or use your current location instead. |
| 400 | `BASE_OUTSIDE_INDIA` | That location is outside India. Check the pin and try again. |
| 422 | — | Send a pincode, or a location with its source — not both. |

**Choice made here (the brief left it open): validate on submit, no pincode list.** Task 10 ships no
endpoint listing a franchisee's pincodes, and for the **home** franchisee the "range" is every active
pincode nobody else owns — thousands of codes, not a list anybody scrolls. A technician knows their own
home pincode; six digits and a server answer is the shortest correct path, and the refusal names the way
out. *Decision (writer).*

**No field on the register body.** The onboarding step runs **after** the account exists (§5.4), through
the same PUT as Profile, and `POST /onboarding/invites/{token}/register` carries no base (index §6b — Task 10
adds none). Reason: a refused pincode in the register call would refuse the whole registration on its last
screen, two screens away from the box that caused it; after sign-in, a refusal is just a line under that box.

Unknown fields are ignored by the app; an API without `baseLocation` reads as `undefined`, which this task
treats as **unknown, never as "not set"** (no nagging against an old server, §5.3).

---

## 5. Client changes

All paths under `mobileapp/`.

### 5.0 The native module — flagged (root AGENTS.md: "Do not add any other third-party native module … without flagging it first")

```bash
cd mobileapp
npx expo install react-native-webview      # resolves to 13.15.0 — SDK 54's bundledNativeModules.json
```

- **Expo Go:** included in Expo Go for SDK 54 — developers can test with `npm start` today.
- **Dev client / production:** a **new EAS build** is required (`preview` for testing, `production` for
  Play). The app ships no OTA updates (`expo-updates` is not a dependency), so a JS bundle that imports the
  module never runs on a binary without it — there is no crash window, only the wait for the Play release.
- **No config plugin** is needed for `react-native-webview`.
- `app.json` → `expo-location` → `locationWhenInUsePermission` (iOS only; Android shows no text) grows to
  mention the base: see §5.9. A native string → needs the same new build.
- Test the Play flow per root AGENTS.md (internal testing track), never a preview APK, for the in-app update
  sheet.

### 5.1 Types, API, hooks

| File | Change |
|---|---|
| `src/types/domain.ts` | `export type BaseSource = 'pincode' \| 'gps' \| 'map' \| 'manual';` `export interface BaseLocation { latitude: number; longitude: number; pincode: string \| null; source: string; setAt: string; setBySelf: boolean }` (`source` a string, read through `baseSummary`, so a newer word cannot break a screen). On `TechnicianSession`: `baseLocation?: BaseLocation \| null` — **optional**: a session persisted before Task 10 has no key, and `undefined` means *unknown*. |
| `src/features/base-location/api/baseLocation.ts` (**new**) | `export type BaseLocationBody = { pincode: string } \| { latitude: number; longitude: number; source: 'gps' \| 'map' };` `saveMyBaseLocation(body) → authedRequest<BaseLocation>('/technicians/me/base-location', { method: 'PUT', body })`. A `BaseLocationError extends Error` carrying `code` for the three codes (the `PayoutCodeError` precedent) so the screen can tell *which option* refused. |
| `src/features/base-location/hooks/useSaveBaseLocation.ts` (**new**) | `useMutation({ mutationFn: saveMyBaseLocation, onSuccess })` — `onSuccess(base)`: `queryClient.setQueryData(qk.me(), (me) => me && { ...me, baseLocation: base })`, `useSession.getState().setTechnician({ ...current, baseLocation: base })` (the seed for the next cold start — `useMe`'s own pattern), then `invalidateQueries({ queryKey: qk.me() })`. No new query key: the base lives on `me`, which Home and Profile already read. |
| `src/lib/queryKeys.ts` | none. |
| `src/features/auth/api/session.ts` | none — `TechnicianSession` is the DTO; the field rides along. |

### 5.2 Pure helpers (tested in §6)

| File | Exports |
|---|---|
| `src/features/base-location/lib/baseSummary.ts` | `needsBaseLocation(me) → boolean` — **true only when `me.baseLocation === null`** (undefined = old API/session → false). `baseSummary(base) → { key: ParseKeys; params }` — `pincode` → `baseLocation.current.pincode` `{ pincode }`; `gps` → `…gps`; `map` → `…map`; `manual` or `setBySelf === false` → `…byManager`; unknown source → `…set`. `baseShortLabel(base)` for the Profile row (pincode digits, or a short key). |
| `src/features/base-location/lib/pincode.ts` | `cleanPincode(text)` → digits only, max 6; `isPincode(text)` → `/^[1-9][0-9]{5}$/`. |
| `src/features/base-location/lib/coords.ts` | `INDIA = { lat: [6, 38], lng: [68, 98] }` (mirrors `api/app/core/coordinates.INDIA_LAT/LON`, comment says so), `inIndia(lat, lng)`, `round5(n)` (what is sent — ≈1 m), `INDIA_CENTRE = { lat: 22.5, lng: 79.0, zoom: 5 }`. |
| `src/features/base-location/map/mapHtml.ts` | `buildMapHtml({ lat, lng, zoom, pinColor, ringColor }) → string` — §5.6. Numbers are serialised with `Number.isFinite` guards and `JSON.stringify`, never string-concatenated from user input. |
| `src/features/base-location/map/mapMessage.ts` | `type MapMessage = { type: 'ready' } \| { type: 'moved'; lat: number; lng: number } \| { type: 'failed'; reason: 'leaflet' \| 'tiles' }`; `parseMapMessage(raw: string): MapMessage \| null` — `JSON.parse` in `try`; `type` must be one of the three; `moved` needs finite numbers within the globe (−90..90, −180..180), rounded with `round5`; `failed.reason` must be one of the two; anything else → `null` (ignored). India is **not** enforced here — the screen shows *outside India* and disables Save, so the pin can still be dragged back. |

### 5.3 Screens and routes

Routes stay ~15 lines (mobile rule 4):

```tsx
// app/(app)/base-location/index.tsx
import { useLocalSearchParams } from 'expo-router';
import { BaseLocationScreen } from '@/features/base-location/screens/BaseLocationScreen';

/** Profile → Base location, the Home card, and the last onboarding step (?onboarding=1). */
export default function BaseLocationRoute() {
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  return <BaseLocationScreen onboarding={onboarding === '1'} />;
}

// app/(app)/base-location/map.tsx
import { useLocalSearchParams } from 'expo-router';
import { BaseMapScreen } from '@/features/base-location/screens/BaseMapScreen';

/** Full-screen OpenStreetMap pin. Saves, then goes back to where it came from. */
export default function BaseMapRoute() {
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  return <BaseMapScreen onboarding={onboarding === '1'} />;
}
```

Both inherit `app/(app)/_layout.tsx`'s signed-in guard; no `Stack.Screen` entry is needed (default push).

**`src/features/base-location/screens/BaseLocationScreen.tsx`** — `Screen`/`TitleBar` (`baseLocation.title`;
in onboarding mode no back chevron and a `StepDots total={REGISTRATION_STEP_COUNT} current={stepNumber('base')}`
in the title bar's `right`). Reads `useMe()`.

1. **Current base card** (hidden in onboarding when none): `Card` with eyebrow `baseLocation.current.label`,
   `t(baseSummary(base).key, …)`, *Set {date}* (`utils/date.dayMonthLabel` at render). Then the TA5 note.
   When `me.baseLocation === null`: the warn line `baseLocation.current.none`.
   `useMe` pending with no seed → `Skeleton` card; error → `ErrorState` with retry (mobile rule 5 — it is the
   one read this screen makes).
2. **Option 1 — My home pincode.** `Input` (`keyboardType="number-pad"`, `maxLength={6}`, `cleanPincode`),
   hint `baseLocation.pincode.body`. `Button` *Use {pincode}* (`disabledHint` `baseLocation.pincode.typeSix`
   until `isPincode`). On `PINCODE_OUTSIDE_FRANCHISEE`: the screen's own sentence `baseLocation.pincode.outside`
   (not `errorText` — the generic `errors.code.PINCODE_OUTSIDE_FRANCHISEE` is Task 07's coverage sentence and
   says nothing about pins); on `PINCODE_HAS_NO_LOCATION`: the translated sentence via `errorText`. Either
   shows under the box, and the two other options stay where they are — the sentence already says "use the
   map or your current location".
3. **Option 2 — Use my current location.** `Button variant="outline" leadingIcon="navigation"`. On press:
   `Location.requestForegroundPermissionsAsync()`; denied → the `gps.denied` line with an *Open settings*
   link (`Linking.openSettings()`); granted → *Finding your location…* and the **bounded** fix exactly as
   `features/proof/screens/CaptureScreen.tsx` does it (`getLastKnownPositionAsync` first, then
   `getCurrentPositionAsync({ accuracy: Balanced })` raced against a timeout). Found → *Found you · ±{m} m*
   (`units.accuracy`), a warn line when accuracy > 200 m, and **Save this location**
   (`{ latitude: round5, longitude: round5, source: 'gps' }`). Outside India → `BASE_OUTSIDE_INDIA`'s
   translated sentence, Save disabled. Timeout → `gps.failed`.
4. **Option 3 — Drop a pin on the map.** `Button variant="outline" leadingIcon="geo"` →
   `router.push(onboarding ? '/base-location/map?onboarding=1' : '/base-location/map')`.
5. **Onboarding only:** footer `Button variant="ghost"` *Skip for now* → `router.replace('/(app)/(tabs)')`.
6. **On any save:** toast `baseLocation.saved` (`components/feedback/toast`), then onboarding →
   `router.replace('/(app)/(tabs)')`, otherwise `router.back()`. Mutation errors other than the three codes →
   `baseLocation.saveFailed` via `errorText`. One mutation instance; `loading` on the pressed button only.

**`src/features/base-location/screens/BaseMapScreen.tsx`** — §5.6.

### 5.4 Onboarding step

| File | Change |
|---|---|
| `src/store/registration.store.ts` | `REGISTRATION_STEPS = ['invite', 'profile', 'coverage', 'verify', 'base'] as const` — so `REGISTRATION_STEP_COUNT` is **5** on every screen's `StepDots`. Nothing is added to the draft: the base is saved after the account exists. Persist `version` unchanged (no field added). |
| `src/features/onboarding/screens/RegisterVerifyScreen.tsx` | After `clear()`: `router.replace('/base-location?onboarding=1')` instead of `'/(app)/(tabs)'`. The `onboarding.verify.codeSentTo` sentence loses *"This is the last step."* (§5.9 — a changed string). |
| `.claude/skills/reliance-greentech-tech-app/SKILL.md` | §2 table: a row for `(app)/base-location` (+ `/map`) marked **NEW**; R2's note "StepDots is now 4" → **5**, with the same "lead the copy-approval request with this" warning (a change to an approved visual). |

Why after verify, not before: §4. The flow for an invite is now
`invite → profile → coverage → verify → base → Home`; a direct-add technician never sees the step and
gets the Home card instead.

### 5.5 Home card and Profile row

| File | Change |
|---|---|
| `src/features/base-location/components/BaseLocationCard.tsx` (**new**) | A `Pressable` card in the shape of Home's pool banner (`HomeScreen.tsx` ~L242: row, 42×42 icon well, title + body, chevron): icon `home` on `color.statusStartingSoon.bg` / `.fg` (secondary/amber — "needs doing", not an error), title `baseLocation.home.title`, body `baseLocation.home.body`, `accessibilityRole="button"`, label = title. → `router.push('/base-location')`. |
| `src/features/jobs/screens/HomeScreen.tsx` | Render `<BaseLocationCard />` above the pool banner when `needsBaseLocation(me)` (`useMe()`, already seeded). Nothing else moves. |
| `src/features/profile/screens/ProfileScreen.tsx` | A row **after Payout account**, the same markup (icon `home`, label `baseLocation.title`, value `baseShortLabel(me.baseLocation)` or `—`, chevron) → `router.push('/base-location')`. Hidden when `me.baseLocation === undefined` (an API that predates it — a row leading to a screen whose save 404s would be worse than none). |

### 5.6 The map — `BaseMapScreen` + Leaflet in a WebView

```tsx
<WebView
  source={{ html, baseUrl: API_ORIGIN }}          // origin of API_BASE_URL — gives OSM a Referer (policy)
  originWhitelist={['https://*']}
  onMessage={(e) => handle(parseMapMessage(e.nativeEvent.data))}
  onShouldStartLoadWithRequest={(req) => {        // the attribution link, or anything else, opens outside
    if (req.url === 'about:blank' || req.url.startsWith(API_ORIGIN)) return true;
    void Linking.openURL(req.url);
    return false;
  }}
  onError={() => setFailed('load')}
  onHttpError={() => setFailed('load')}
  applicationNameForUserAgent="RelianceGreenTechTechnician"   // OSM asks apps to identify themselves; infra name, never shown
  javaScriptEnabled
  domStorageEnabled={false}
  allowFileAccess={false}
  setSupportMultipleWindows={false}
  mixedContentMode="never"
  cacheEnabled                                     // honour tile cache headers (policy)
  style={{ flex: 1 }}
/>
```

`API_ORIGIN` = `new URL(API_BASE_URL).origin` (from `lib/api.ts`). `applicationNameForUserAgent` uses the
infrastructure name (root AGENTS.md: the Android package and slug keep it) — no person reads it.

**`buildMapHtml`** returns one self-contained page:

- `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">`.
- Leaflet **1.9.4** from `https://unpkg.com/leaflet@1.9.4/dist/leaflet.css` and `…/leaflet.js` with
  `integrity` (the SRI hashes published on leafletjs.com/download.html for 1.9.4 —
  `sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=` for the CSS and
  `sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=` for the JS; **verify against that page when
  implementing**) and `crossorigin=""`. The script tag's `onerror` posts `{type:'failed', reason:'leaflet'}`.
- `L.map('map', { zoomControl: true, attributionControl: true })`; tile layer
  `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, `maxZoom: 19`, attribution
  `&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors` (**never
  translated or hidden** — a legal notice naming a brand; kept as a constant in `mapHtml.ts`, not in
  `en.json`. *Decision (writer).* Lint's copy rule covers JSX only, so this does not trip it).
- One **draggable** marker drawn as a `L.divIcon` (a 20 px circle, `pinColor` fill, white 3 px ring) — no
  marker PNGs to load. `map.on('click')` and `marker.on('dragend')` move it and post
  `{type:'moved', lat, lng}`. On load it posts `{type:'ready'}` and the initial point as `moved`.
- `tileerror` counter: on the 4th, post `{type:'failed', reason:'tiles'}` once.
- Posting is `window.ReactNativeWebView.postMessage(JSON.stringify(msg))`.
- Colours come in as arguments from `color` (`color.actionBg`, `color.surfaceRaised`) — **no hex literal in
  `src/` outside `src/theme`** (hard rule 1), even inside an HTML string.

**Initial point:** the current base if any; else the phone's last-known position **only if location
permission is already granted** (`getForegroundPermissionsAsync`, never a prompt from this screen); else
`INDIA_CENTRE` at zoom 5. The map is built once per mount (`useMemo`), never re-rendered from React state
(re-setting `source.html` reloads the page and the tiles).

**Screen states** (mobile rule 5):

| State | Shown |
|---|---|
| loading (no `ready` yet) | the WebView with a `Skeleton` overlay and `baseLocation.map.loading`; a **10 s** timer with no `ready` → failed |
| ready | the map; a bottom sheet-like footer with `baseLocation.map.hint`, the coordinates (`lat, lng` to 5 dp, `RobotoMono`), and **Save this pin** (`disabledHint` `baseLocation.map.outside` when `!inIndia`) |
| failed (`leaflet`, `load`, timeout) | `EmptyState`-style block: icon `warn`, `baseLocation.map.failedTitle` / `…failedBody`, **Try again** (re-mounts the WebView via a `key`) and **Use my current location instead** (back to the base screen) |
| failed (`tiles`) | the map stays (the pin still works over a grey grid); an inline warn line `baseLocation.map.tilesFailed` above Save |

Save → `useSaveBaseLocation().mutate({ latitude, longitude, source: 'map' })`; success → toast, then
onboarding `router.replace('/(app)/(tabs)')`, otherwise **`router.back()` once** — back to the base screen,
which now shows the new base (the honest landing; it also covers arriving from the Home card). Error → the
translated line above the button.

### 5.7 Error text

`errors.code.PINCODE_HAS_NO_LOCATION` and `errors.code.BASE_OUTSIDE_INDIA` in all five locale files —
`errorText` already looks up `errors.code.<CODE>` (`src/i18n/errorText.ts`). `errors.code.PINCODE_OUTSIDE_FRANCHISEE`
is **Task 07's** (generic, for coverage at registration — Task 04); this screen renders its own
`baseLocation.pincode.outside` for that code (reconciled, index §6b).

### 5.8 Colour and layout

Semantic roles only: the card uses `color.statusStartingSoon` (amber "to do"); warn lines use
`color.slotFg` on `color.slotBg` (the existing amber surface); the *outside India* / refusal lines use
`color.textDanger`. Gutter 16, radius 14/18 as the surrounding screens. No dark mode (mobile hard rule 7).
Static NativeWind classes only, or inline `style` with `color.*` as the existing screens do.

### 5.9 PROPOSED copy — `src/i18n/locales/en.json` (+ hi, te, kn, ta)

Add each key to **all five** files, translated per `src/i18n/README.md` (polite "you", glossary, Latin
letters for *OTP, ₹, km, m*, short buttons), queued for native review. `npm run i18n:check -- --verbose`
must list none of these as identical to English.

| Key | English (PROPOSED) |
|---|---|
| `baseLocation.title` | Base location |
| `baseLocation.intro` | Travel allowance is worked out from here to each customer. Set the place you usually start your day from. |
| `baseLocation.changeNote` | A change applies to jobs you accept from now on. |
| `baseLocation.current.label` | Your base |
| `baseLocation.current.pincode` | Pincode {{pincode}} (area centre) |
| `baseLocation.current.gps` | Your location |
| `baseLocation.current.map` | Pin on the map |
| `baseLocation.current.byManager` | Set by your manager |
| `baseLocation.current.set` | Set |
| `baseLocation.current.setOn` | Set {{date}} |
| `baseLocation.current.none` | Not set yet — jobs you accept pay no travel allowance. |
| `baseLocation.short.gps` | Your location |
| `baseLocation.short.map` | Map pin |
| `baseLocation.short.manager` | By manager |
| `baseLocation.pincode.title` | My home pincode |
| `baseLocation.pincode.body` | We use the centre of your pincode's area. |
| `baseLocation.pincode.placeholder` | 6-digit pincode |
| `baseLocation.pincode.use` | Use {{pincode}} |
| `baseLocation.pincode.typeSix` | Type your 6-digit pincode |
| `baseLocation.gps.title` | Use my current location |
| `baseLocation.gps.body` | Do this at home — we save where your phone is now. |
| `baseLocation.gps.finding` | Finding your location… |
| `baseLocation.gps.found` | Found you · {{accuracy}} |
| `baseLocation.gps.rough` | This fix is rough. Step outside for a better one, or save it anyway. |
| `baseLocation.gps.save` | Save this location |
| `baseLocation.gps.denied` | Location access is off. Allow it in Settings, or use your pincode or the map. |
| `baseLocation.gps.openSettings` | Open settings |
| `baseLocation.gps.failed` | Couldn't get a location fix. Step outside and try again, or use your pincode or the map. |
| `baseLocation.map.title` | Drop a pin on the map |
| `baseLocation.map.body` | For when you live outside your service area, or your pincode isn't accepted. |
| `baseLocation.map.loading` | Loading the map… |
| `baseLocation.map.hint` | Tap the map or drag the pin to your home. |
| `baseLocation.map.save` | Save this pin |
| `baseLocation.map.outside` | Move the pin inside India |
| `baseLocation.map.failedTitle` | The map couldn't load |
| `baseLocation.map.failedBody` | Check your connection and try again, or use your pincode or current location instead. |
| `baseLocation.map.useLocation` | Use my current location instead |
| `baseLocation.map.tilesFailed` | Some of the map didn't load. The pin still works. |
| `baseLocation.saved` | Base location saved |
| `baseLocation.saveFailed` | Couldn't save your base location. Try again. |
| `baseLocation.onboarding.title` | Where do you start from? |
| `baseLocation.onboarding.body` | Jobs farther away pay a travel allowance, measured from your base. You can change it later in Profile. |
| `baseLocation.onboarding.skip` | Skip for now |
| `baseLocation.home.title` | Set your base location |
| `baseLocation.home.body` | Until you do, jobs pay no travel allowance. |
| `baseLocation.pincode.outside` | That pincode is outside your service area. Drop a pin on the map or use your current location instead. |
| `errors.code.PINCODE_HAS_NO_LOCATION` | We don't have a map location for that pincode yet. Drop a pin on the map or use your current location instead. |
| `errors.code.BASE_OUTSIDE_INDIA` | That location is outside India. Check the pin and try again. |
| `onboarding.verify.codeSentTo` *(changed)* | Enter the 6-digit code sent to <bold>{{phone}}</bold>. |

**Native strings (not i18n — `app.json`, iOS only):** `locationWhenInUsePermission` →
*"Reliance GreenTech Technician records where the live site photo was taken, and, if you choose, where you
start your day from."* (`app.config.ts` rebrands the name for a white-label build.)

**Glossary additions** to `src/i18n/README.md` (first drafts, flagged for native review):

| English | हिन्दी | తెలుగు | ಕನ್ನಡ | தமிழ் |
|---|---|---|---|---|
| Base location | बेस लोकेशन | బేస్ లొకేషన్ | ಬೇಸ್ ಸ್ಥಳ | அடிப்படை இருப்பிடம் |
| Travel allowance | यात्रा भत्ता | ప్రయాణ భత్యం | ಪ್ರಯಾಣ ಭತ್ಯೆ | பயணப்படி |
| Map / pin | मैप / पिन | మ్యాప్ / పిన్ | ನಕ್ಷೆ / ಪಿನ್ | வரைபடம் / பின் |

---

## 6. Unit tests (jest-expo — Task 00 harness, `**/__tests__/**/*.test.ts?(x)`, `@/` mapped)

| File | Cases |
|---|---|
| `src/features/base-location/__tests__/mapMessage.test.ts` | `ready` → `{type:'ready'}`; `moved` with numbers → rounded to 5 dp; `moved` with strings, `NaN`, `Infinity`, lat 91, lng −181 → `null`; `failed` with `leaflet` / `tiles` → itself, with `'other'` → `null`; unknown `type`, missing `type`, `"null"`, `"[]"`, `"42"`, non-JSON text, `'{"type":"__proto__"}'` → `null`; a point outside India but on the globe (51.5, −0.12) → parsed (India is the screen's check). |
| `src/features/base-location/__tests__/mapHtml.test.ts` | Contains `tile.openstreetmap.org/{z}/{x}/{y}.png` and **not** `{s}.`; contains `openstreetmap.org/copyright` and `OpenStreetMap</a> contributors`; contains `leaflet@1.9.4` twice with `integrity="sha256-` both times; embeds the given lat/lng/zoom; `NaN`/`Infinity` inputs fall back to `INDIA_CENTRE`; the pin colour argument appears and **no other `#rrggbb`** literal does (regex over the output minus the argument); posts via `window.ReactNativeWebView.postMessage`. |
| `src/features/base-location/__tests__/baseSummary.test.ts` | `needsBaseLocation`: `{baseLocation: null}` → true; `{}` (undefined) → false; a base → false; `null`/`undefined` me → false. `baseSummary` per source (`pincode` names the code; `gps`; `map`; `manual` → byManager; `setBySelf: false` with `map` → byManager; `'satellite'` → `set`). `baseShortLabel` → pincode digits for a pincode base. |
| `src/features/base-location/__tests__/pincode.test.ts` | `cleanPincode('50 00-49x')` → `'500049'`; 7 digits → first 6; `isPincode` true for `500049`, false for `050004`, `50004`, `5000490`, `''`. |
| `src/features/base-location/__tests__/coords.test.ts` | `inIndia` at both bounds inclusive, just outside each; `round5(17.4401234)` → `17.44012`; negative rounding symmetric. |
| `src/store/__tests__/registration.steps.test.ts` | `jest.mock('@/lib/secureStorage')`; `REGISTRATION_STEP_COUNT === 5`; `stepNumber('base') === 5`; `stepNumber('verify') === 4`. |

---

## 7. Acceptance criteria

On a dev-client or Expo Go build against the dev API with Task 10 deployed.

1. **Given** an invited technician completing *Confirm your number*, **when** registration succeeds, **then**
   they land on *Where do you start from?* with step dots 5 of 5 and no back chevron; every earlier step's dots
   read N of 5.
2. **Given** that screen, **when** they tap *Skip for now*, **then** Home opens and shows the *Set your base
   location* card.
3. **Given** a pincode inside their franchisee's range, **when** they type it and tap *Use {pincode}*, **then**
   the request body is `{"pincode":"…"}`, the toast *Base location saved* shows, Home opens, and the card is gone.
4. **Given** a pincode outside the range, **then** the translated `baseLocation.pincode.outside` sentence shows
   under the box (in each of the five languages), nothing else on the screen changes, and the other two options
   still work.
5. **Given** fewer than six digits, the button reads *Type your 6-digit pincode* and is disabled.
6. **Given** location permission is denied, tapping *Use my current location* shows the denied line with
   *Open settings*; no crash, no toast.
7. **Given** permission, the screen shows *Finding your location…*, then *Found you · ±N m*; *Save this
   location* sends `source: "gps"` with 5-dp coordinates. Indoors with no fix, the bounded wait ends in the
   failed line rather than spinning.
8. **Given** the map screen online, the OSM tiles and the attribution appear; tapping or dragging moves the pin
   and the coordinates update; *Save this pin* sends `source: "map"` and returns to the base screen showing
   *Pin on the map*.
9. **Given** airplane mode, the map screen shows *The map couldn't load* within 10 s with *Try again* and *Use
   my current location instead*; *Try again* reloads once the network is back.
10. **Given** the attribution link is tapped, it opens in the phone's browser, not inside the web view.
11. **Given** the pin dragged outside India, Save is disabled with *Move the pin inside India*.
12. **Given** a technician whose manager set the base in the console, Profile → Base location shows *By
    manager* and the base screen *Set by your manager*.
13. **Given** an API without Task 10 (field absent), no Home card and no Profile row appear.
14. **Given** a language switch to తెలుగు on the base screen, every string on it switches, including the
    *Set {date}* line (dates formatted at render).
15. **Given** a saved base, the next cold start shows it immediately (seeded session) and then refreshes.
16. **Lists and states:** the base screen shows a skeleton while `me` loads with no seed, `ErrorState` with
    retry on failure; the map shows loading, failed and tiles-failed states as in §5.6.
17. **Gates:** `npm run lint` (incl. `i18n:check` — all five files carry every new key with identical
    placeholders and tags), `npm run typecheck`, `npm test` and `npm run doctor` pass (`expo-doctor` accepts
    `react-native-webview@13.15.0` for SDK 54). No hex outside `src/theme` (lint).
18. **Release:** a production EAS build is uploaded to Play's internal track and the map screen works from an
    install off that track before the release is promoted.

---

## 8. Out of scope / traps

- **Out of scope:** a pincode search list (§4 — the home range is thousands of codes); a base on the register
  body (§4 — there is none); showing distance or travel estimates on the pool offer (Task 10 W4 — **ruled out by the owner 2026-10-15, R10**: travel is shown only after accept); the console pin
  (Task 13); travel/speed on the job and Earnings (Task 15).
- **OpenStreetMap tile usage policy** (operations.osmfoundation.org/policies/tiles): attribution visible and
  linked; an identifying User-Agent (`applicationNameForUserAgent`); a Referer (the `baseUrl` origin); no
  pre-fetching or offline tile packs; honour caching (`cacheEnabled`). Usage here is a handful of map opens per
  technician per year. If that ever changes, switch the tile URL to a keyed provider in `mapHtml.ts` — one line.
- **unpkg is a runtime dependency of the map**, not of the app. If it is down the map fails into its error
  state and the other two options still work. Bundling Leaflet into the app as a string asset (~150 kB) is the
  fallback if this proves flaky — not done now (larger bundle for a screen opened once).
- **`source.html` must not change after mount** — changing it reloads Leaflet and every tile. Build the HTML in
  `useMemo` from the initial point only; later moves come from the page, not from React.
- **`postMessage` is untrusted input** — the page is ours, but the WebView executes remote JS (Leaflet). Every
  message goes through `parseMapMessage`; never `eval` or spread it into state.
- **Do not prompt for location on the map screen.** Only the explicit *Use my current location* button asks;
  the map uses a last-known fix silently when permission already exists.
- **`undefined` ≠ `null`.** `baseLocation: undefined` (old API, old persisted session) must never show the nag;
  only an explicit `null` from a server that knows the field does.
- **iOS permission text** is baked into the binary — it changes only with the new build this task already needs.
- **StepDots 4 → 5 changes an approved visual** (the R2 note in the skill). Lead the copy sign-off with it.
- **Translations are first drafts** — the README's review table applies; a language should be read on a phone
  by a native speaker before a production build.
- **Commit rhythm:** one commit per screen — (1) webview + pure helpers + tests, (2) base screen + Profile row +
  Home card, (3) map screen, (4) onboarding step. `npm run lint && npm run typecheck` first.
