# SamePace Apple Health reader

Local Expo module for Apple Health import and transient Watch mirroring. It needs a native iOS build;
`isAvailable()` returns false in Expo Go, Android, and web. The config plugin adds
the HealthKit capability and explains that selected records sync to the user's
private SamePace account. The phone import requests no write access. Background
change notification is separately enabled only by a saved automatic-sync opt-in;
the companion Watch explicitly requests workout write access when recording.

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

Workouts retain source duration, distinct from elapsed time. iOS 27 source zone
groups preserve metric, unit, system/user/app origin, exact open-ended thresholds,
and source durations (missing is not zero). Heart-rate and cycling-power zones
require the corresponding reading consent. Withdrawal scrubs embedded zone data.
The legacy `heart_rate_variability` type is SDNN; `heart_rate_variability_rmssd`
is separately authorized and available only on iOS 27 in an Xcode 27 build.
Compile-time guards omit the new SDK symbols on older build images. Cycling power requires
iOS 17 and retains watts. Quantities convert
to their declared units; unavailable workout distance/energy remains null.
Distance samples are walking/running distance. Workout totals use HealthKit
statistics for the workout's activity, including cycling and swimming where
present. No measured facts or model interpretations are fabricated.

Native observers register on application launch and call their completion after
persisting a change counter. Only a type list and counters enter UserDefaults;
no health measurements, cursors, identity or bearer token is saved there. Cloud
uploads use a captured, current login while the app can run; a suspended/cold
launch queues notifications and resumes import in the foreground. A shared
`HealthSyncBoundary` owns one controller across screens. Existing connections
default to manual sync. HealthKit can throttle notifications, and background
delivery requires physical-device validation.

On a Mac with Xcode 27 and a booted iOS 27 simulator, compile and run the native
serialization checks without reading or saving any personal health data:

```sh
xcrun --sdk iphonesimulator swiftc -target arm64-apple-ios27.0-simulator ios/HealthKitReader.swift tests/HealthKitReaderChecks.swift -o /tmp/samepace-healthkit-checks
xcrun simctl spawn <iOS-27-simulator-id> /tmp/samepace-healthkit-checks
```

Also build the generated iOS app and test authorization, deletions, pagination,
locked-device behavior, and permission changes on a physical device before
release. The standalone checks cannot validate those HealthKit behaviors.

References: [Apple anchored queries](https://developer.apple.com/documentation/healthkit/hkanchoredobjectquery/init(type:predicate:anchor:limit:resultshandler:)),
[read-authorization privacy](https://developer.apple.com/documentation/healthkit/hkauthorizationstatus),
[Expo local modules](https://docs.expo.dev/modules/autolinking/).
