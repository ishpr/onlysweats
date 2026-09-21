# SamePace Apple Health reader

Local Expo module for read-only, foreground import. It needs a native iOS build;
`isAvailable()` returns false in Expo Go, Android, and web. The config plugin adds
the HealthKit capability and explains that selected records sync to the user's
private SamePace account. It requests no write access or background delivery.

Exports `isAvailable()`, `requestAuthorization(types)`, and
`readChanges({ type, anchor, sinceAt, limit? })`. Types and records use
[`shared/health.ts`](../../../shared/health.ts). Authorization completion does
**not** prove read permission: HealthKit deliberately masks denial as missing
data. Never label an empty result as proof of access or absence of activity.

The caller keeps `sinceAt` fixed, uploads each complete page, and persists its
opaque anchor only after durable server acceptance. Pages contain at most 200
added/deleted records. A full page requests another page, which may be empty.
Invalid anchors and unrepresentable records reject the page rather than silently
losing records. Anchors use secure HealthKit archives, without local persistence.

Workouts retain source duration, distinct from elapsed time. Quantities convert
to their declared units; unavailable workout distance/energy remains null.
Distance samples are walking/running distance. Workout totals use HealthKit
statistics for the workout's activity, including cycling and swimming where
present. No measured facts or model interpretations are fabricated.

On a Mac with Xcode, run serialization checks without querying or writing any
personal data:

```sh
xcrun swiftc ios/HealthKitReader.swift tests/HealthKitReaderChecks.swift -o /tmp/samepace-healthkit-checks
/tmp/samepace-healthkit-checks
```

Also build the generated iOS app and test authorization, deletions, pagination,
locked-device behavior, and permission changes on a physical device before
release. The standalone checks cannot validate those HealthKit behaviors.

References: [Apple anchored queries](https://developer.apple.com/documentation/healthkit/hkanchoredobjectquery/init(type:predicate:anchor:limit:resultshandler:)),
[read-authorization privacy](https://developer.apple.com/documentation/healthkit/hkauthorizationstatus),
[Expo local modules](https://docs.expo.dev/modules/autolinking/).
