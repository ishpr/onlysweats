# Apple Health sync

The first implementation imports private workout history and selected Apple Health readings. It is read-only, manually triggered, and disabled unless the API environment sets `HEALTH_SYNC_ENABLED=true`. Jev inference and A2A health sharing are not enabled by connecting Apple Health.

## Run and integrate

1. Apply `0014_health_sync.sql` using the normal migration process on an isolated development database. Local embedded Postgres applies it automatically.
2. Start the API with `HEALTH_SYNC_ENABLED=true`. The production flag was enabled at the user’s request; physical-device acceptance is still required before a broader rollout.
3. Rebuild the iOS development client. The local Expo module and `mobile/plugins/with-healthkit.js` add the HealthKit capability and a read-permission description. Expo Go, web, and Android cannot read HealthKit.
4. Open the mobile route `/health` (`samepace://health`), sign in, choose readings, and tap **Connect Apple Health**. Then tap **Sync now**. The initial window starts 30 days before first connection; later queries keep that exact boundary and apply source changes.

The new standalone screen uses existing primitives. The release integrates the committed redesign and adds entries under You. The design pass can add an entry under You, reskin the standalone screen, or compose the same hook elsewhere:

```tsx
const [session] = useState(captureApiSession);
const health = useHealthSync({ ownerId: member.id, session });
```

Key the containing component by member ID. Mounting refreshes status only; `connect(types)` is an explicit opt-in to private cloud storage, and `sync()` imports. All requests retain the captured session token. Account changes or cleanup invalidate pending work; an old import cannot adopt another account's token. Do not replace this transport with the mutable global `api()` helper inside a long-running sync.

Useful entry points:

- `shared/health.ts`: source-preserving wire types.
- `mobile/modules/samepace-healthkit`: native HealthKit bridge and serialization.
- `mobile/src/lib/health/controller.ts`: sync lifecycle, retry, and cancellation.
- `mobile/src/hooks/use-health-sync.ts`: React binding; no background imports.
- `mobile/src/lib/health/api.ts`: typed private API client, including paginated export.
- `mobile/src/app/health.tsx`: working connection, sync, history, and deletion screen.
- `src/lib/health`: validation, persistence, calculations, and request bounds.

## Imported data

| Type | Source value and canonical unit |
| --- | --- |
| `workout` | Activity, source active duration in seconds, start/end time, optional source distance in meters and active energy in kcal |
| `heart_rate`, `resting_heart_rate` | Beats per minute |
| `heart_rate_variability` | HealthKit SDNN, milliseconds |
| `sleep` | Source interval and stage: in bed, unspecified sleep, awake, core, deep, or REM |
| `steps` | Source step count |
| `distance` | Walking/running distance samples, meters |
| `active_energy` | Source active-energy samples, kcal |
| `blood_glucose` | Source glucose samples, mg/dL |

Workouts are required; other reading types are individually selected. Workout totals supplied by HealthKit are part of the workout object, distinct from optionally imported distance/energy sample streams. Every object retains its HealthKit UUID, source bundle/name, timestamps, and units. Sleep stages and overlapping sources are not summed into invented daily totals.

The app cannot determine whether the member denied read access. A completed authorization request means only that the request finished. Empty query results can mean no matching records or no access. See [Apple's authorization guidance](https://developer.apple.com/documentation/healthkit/hkauthorizationstatus).

Saved HealthKit records are not a live heart-rate stream. No observer/background delivery, automatic foreground sync, watch recorder, or writeback is implemented. Source changes become visible on a later manual sync. The native bridge follows [anchored queries](https://developer.apple.com/documentation/healthkit/hkanchoredobjectquery) and the [local Expo module architecture](https://docs.expo.dev/modules/get-started/).

## Private API

All paths are under `/api/v1`, require the normal signed-in member session, return `cache-control: no-store`, and return `404` while the feature flag is off. Delegation credentials cannot use this API. Other members cannot retrieve or mutate an owner's records.

| Method and path | Request / result |
| --- | --- |
| `GET /health/connection` | `{ connection: HealthConnection | null }` |
| `POST /health/connection` | `{ deviceId, types }` → `{ connection }`; explicit connection/update |
| `DELETE /health/connection` | `{ ok: true }`; removes imported records, tombstones, connection, and cursors |
| `POST /health/sync` | `HealthSyncInput` → `{ connection }` with acknowledged cursors |
| `GET /health/workouts?limit=20&cursor=…` | `{ workouts, nextCursor }`; max 50, newest first |
| `GET /health/workouts/:id` | `{ workout }`; source workout UUID, scoped to owner |
| `DELETE /health/workouts/:id` | `{ ok: true }`; removes the workout and keeps a minimal tombstone |
| `GET /health/export?limit=200&cursor=…` | `{ records, nextCursor }`; all selected source record types, without tombstones or credentials |

One installation is active for each member. Connecting another iPhone or changing selected types rotates the connection generation and resets its anchors. A removed type's records are purged. Existing selected records deduplicate on reimport. The user may reconnect after disconnect to import a fresh history.

Each type has an opaque anchor and sequence. A sync page supplies the expected sequence, device ID, and generation. The server locks the owner and connection, validates the complete page, writes records/deletions, and advances the cursor in one transaction. A stale sequence or generation returns `409`. Client retries use the server's acknowledged cursor; a lost response does not require guessing whether the write committed.

Pages contain at most 200 records and 200 deletion IDs; native queries cap their combined total at 200. Requests are capped at 512 KiB, including streamed requests without a length header. The controller processes at most 20 pages per action, rotating through selected types. **Continue sync** resumes larger imports. No raw records or anchors are written to local persistent storage or error logs; the device keychain stores only an installation identifier. Network interruption leaves source records in HealthKit for the next attempt.

HealthKit replacements use new source UUIDs. Source deletions and user-removed workouts leave only member-scoped type/UUID tombstones, so ordinary resync cannot restore them. Disconnect purges those identifiers too; a later explicit reconnection can import records still present in Apple Health. Account deletion cascades from the authentication identity, independently of retained anonymous social history.

## Calculations and future Jev inputs

Code computes elapsed time, active-duration pace for running/walking/hiking, and an arithmetic heart-rate sample mean, min/max, count, and first/last sample time. Only heart-rate samples from the workout's source bundle and within its time interval contribute. The arithmetic sample mean is not time-weighted. Unavailable readings remain null; there is no invented recovery score, calorie count, or rep count.

`PrivateWorkout.revision` versions the workout source record only. Late heart-rate readings, deletion of readings, and consent changes can change derived summaries without changing that field. Before adding Jev, fingerprint the **entire authorized input snapshot**, including selected readings, their freshness, workout revision, and connection/consent generation. Reject stale results against that fingerprint. The release adds the separately consented TypeSafe adapter, editable exercise drafts, and bounded workout-note interpretation described in [Jev fitness](./JEV-FITNESS.md). Inputs exclude raw heart-rate samples and sleep history.

## Verification and remaining acceptance

All **458 tests** pass, including 46 new tests for health persistence/validation, sync lifecycle, captured sessions, and private-cache invalidation. Web and mobile typechecks pass, web/mobile lint passes (two existing web warnings), the web development build passes, and mobile export includes 23 routes. Local HTTP smoke coverage exercises the real sign-in/API boundary, disabled-feature responses, summary values, cursor conflicts, deletion/purge, and the rejection of A2A credentials.

The unsigned iOS simulator build and real-framework serialization checks pass. These do not prove behavior with a member's health store. Before rollout, test a physical iPhone with:

- All/some/no read permissions; later permission changes; an empty Health store.
- Real workouts plus heart-rate, HRV, sleep, and other selected samples; check source units against Apple Health.
- More than one sync page, repeated sync, offline interruption, and a lost response.
- Source additions/deletions, two recording sources, a locked phone, account switching, and a second iPhone.
- Remove workout, remove a type, disconnect/purge, reconnect, and account deletion.

Redesigned navigation, persistent correction overlays, manual set logging, native sharing of complete paginated exports, operational counts, and a separately consented Jev pilot are now implemented. Remaining acceptance includes actual iPhone source changes, locked-device behavior, multiple devices, permissions, and battery behavior. Background sync and broader daily/context summaries remain future work. See the [vision roadmap](./VISION-ROADMAP.md).
