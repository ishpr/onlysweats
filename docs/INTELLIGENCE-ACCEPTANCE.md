# Physical iPhone and Watch acceptance

Implementation and simulator checks are complete enough for a device acceptance
pass; the unchecked cases below have **not** been demonstrated on paired hardware.
Use a signed SamePace development build with its generated `SamePaceWatch` target,
a paired Apple Watch, and a disposable test member. Migration `0028_health_zones`
is required on the test server. Source zones and RMSSD require iOS/watchOS 27;
recording supports watchOS 10+, and cycling-power imports require iOS 17+.
The full zone/RMSSD feature build also needs Xcode 27 (Swift 6.4). Older SDK
builds intentionally omit those symbols and hide the unavailable capture/cue
options; runtime OS 27 alone cannot add a feature omitted at build time. Use
the installed Xcode 27 locally unless a matching EAS image is officially listed.
Provision both app IDs (`app.samepace` and `app.samepace.watchkitapp`) for HealthKit;
the phone profile also needs HealthKit Background Delivery. Expo Go is insufficient.

Record build/commit, OS versions, device pair, time, outcome, and redacted evidence
for each case. Do not put account tokens or personal sensor exports in test logs.

| Done | Case                                                                                        | Expected result                                                                                                                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ ]  | Open Apple Health settings without connecting                                               | No Health permission prompt, cloud connection, or import. Old connections default to manual sync.                                                                                                                                                                                                   |
| [ ]  | Connect with workouts only, then add heart rate, SDNN, RMSSD and cycling power individually | System permission prompt follows explicit selection. Unsupported OS types are hidden. SDNN and RMSSD remain different exported types, both in milliseconds; power uses watts.                                                                                                                       |
| [ ]  | Deny a reading in the system prompt; later revoke it in Health settings                     | No fabricated values or permission-success claim. Missing/denied readings remain unavailable. An empty query does not prove absence of activity.                                                                                                                                                    |
| [ ]  | Import an existing workout containing zones; compare with its recording source              | Exact source thresholds, open-ended bounds, metric, system/user/app origin and durations are retained. Missing duration differs from zero. Different workouts may have different boundaries; no estimated zones appear.                                                                             |
| [ ]  | Withdraw heart-rate or power selection and save                                             | That reading type and its embedded workout zones disappear from SamePace. Previous fitness-derived chat is cleared. Apple Health stays unchanged.                                                                                                                                                   |
| [ ]  | Enable automatic sync; save a workout in Health; reopen SamePace on another screen          | Incremental import resumes without another prompt, coalescing automatic batches at a maximum of one per thirty seconds. Workout history refreshes after saved pages. Background notification may be throttled; locked/cold/suspended apps defer uploads until a usable foreground login exists.     |
| [ ]  | Turn automatic sync off, including during a delayed refresh/read                            | No new automatic import adopts the disabled connection. Old generations cannot commit. Manual Sync still works.                                                                                                                                                                                     |
| [ ]  | Interrupt network access during a multi-page sync, then restore and reopen                  | Resume from the last acknowledged server anchor; no lost pages or duplicates. A large backlog continues in bounded batches.                                                                                                                                                                         |
| [ ]  | Log out during a read, sign in as another test member, then reconnect                       | No prior member's readings, mirror, activity surface, or delayed upload appears in the new account. No native bearer token is persisted. A connection from another iPhone is not silently adopted.                                                                                                  |
| [ ]  | Open Watch recorder; deny workout write permission, then grant it                           | Recording requires an explicit Watch Start and authorized workout write access. Permission denial gives an actionable error; read denial does not masquerade as a zero measurement.                                                                                                                 |
| [ ]  | Start a normal run/walk/ride/strength recording; pause and resume                           | Real elapsed active time and available source measurements update. Paused/stale heart readings are hidden; unavailable distance/energy stays absent. Starting a second recording is blocked.                                                                                                        |
| [ ]  | On watchOS 27, select a heart-rate cue target; observe natural zone changes                 | Cues default off. Configured cues use HealthKit thresholds locally, wait ten seconds outside the chosen zone, and recur no faster than thirty seconds. Missing/stale readings and pauses silence cues. This is not a readiness or medical assessment.                                               |
| [ ]  | Disconnect the phone during recording; reconnect later                                      | Watch continues recording without network/AI credentials. While the app runs, its mirror expires within thirty seconds and heart readings expire at fifteen seconds. A suspended Live Activity is marked stale by its sixty-second system deadline. Reconnection supplies a fresh mirrored session. |
| [ ]  | Finish and save; allow Watch → iPhone Health replication; sync                              | One saved source workout imports with its original UUID and chosen readings. Repeated sync does not duplicate it. Record actual replication delay; no synthetic replacement is created while waiting.                                                                                               |
| [ ]  | Exercise interrupted-app recovery and a recoverable save failure                            | Active recording recovers through HealthKit; stopped recording finishes saving. Retry does not create a new recording. A successful finish with a temporarily hidden locked sample is treated as saved.                                                                                             |
| [ ]  | Inspect lock screen/Dynamic Island while recording, paused, offline, ended and logged out   | One current workout activity takes precedence over arrival status. End/disconnect/logout clears it. The Live Activity hides readings at its system stale deadline (at most sixty seconds after its last update); system denial of Live Activities does not interrupt recording.                     |
| [ ]  | Remove an imported workout; repeat sync; disconnect and delete data                         | Removed UUID remains tombstoned; disconnect purges records/cursors. Fitness-derived chat is cleared. A later explicit reconnect starts a new consent generation. Watch/Apple Health originals remain unchanged.                                                                                     |

## Repeatable local checks

Run from the repository root with Node dependencies and Xcode 27 installed:

```sh
node --experimental-strip-types --test src/lib/health/health.test.ts mobile/src/lib/health/controller.test.mjs mobile/src/lib/health/watch.test.mjs
node --test mobile/plugins/with-watch.test.cjs
swiftc mobile/watch/SamePaceWatch/ZoneCue.swift mobile/watch/ZoneCueChecks.swift -o /tmp/SamePaceZoneCueChecks
/tmp/SamePaceZoneCueChecks
xcrun --sdk watchsimulator swiftc -typecheck -target arm64-apple-watchos10.0-simulator mobile/watch/SamePaceWatch/*.swift
xcrun --sdk iphonesimulator swiftc -target arm64-apple-ios27.0-simulator -o /tmp/SamePaceHealthKitChecks mobile/modules/samepace-healthkit/ios/HealthKitReader.swift mobile/modules/samepace-healthkit/ios/HealthChangeObserver.swift mobile/modules/samepace-healthkit/ios/WatchWorkoutMirror.swift mobile/modules/samepace-healthkit/tests/HealthKitReaderChecks.swift
xcrun simctl list devices booted
xcrun simctl spawn <booted-iOS-27-simulator-id> /tmp/SamePaceHealthKitChecks
```

The native executable creates unsaved HealthKit fixtures only. It checks RMSSD
conversion, source-zone serialization, open bounds, zero versus missing duration,
source units, workout duration, and secure anchors. The pure cue executable checks
dwell/cooldown, disabled targets, pause and stale/future timestamps. Controller
regressions include opt-out between refresh and the sync job's fresh connection
fetch, and opt-out during a cursor conflict. Plugin tests cover fresh dependency
sections, host → Watch build dependency, idempotence, and existing-target repair.

From `mobile`, regenerate rather than hand-edit native targets:

```sh
CI=1 npx expo prebuild --platform ios --no-install
cd ios
pod install
xcodebuild -workspace SamePace.xcworkspace -scheme SamePace -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/samepace-intelligence-native-check CODE_SIGNING_ALLOWED=NO
```

Standalone Watch verification used `xcodebuild -project ios/SamePace.xcodeproj
-target SamePaceWatch -sdk watchsimulator -configuration Debug
CODE_SIGNING_ALLOWED=NO CONFIGURATION_BUILD_DIR=/tmp/samepace-watch-products build`
from an isolated prebuild copy. It produced `SamePaceWatch.app`. The combined phone
build must also succeed: standalone compilation does not prove Watch embedding.

Local evidence paths for this implementation session: `/tmp/samepace-health-final-tests.log`,
`/tmp/samepace-health-controller-final.log`, `/tmp/samepace-watch-prebuild.log`,
`/tmp/samepace-watch-xcodebuild.log`, and `/tmp/samepace-intelligence-native-build.log`.
These temporary logs are not shipped test evidence and may be replaced by reruns.
Physical sensor accuracy, OS background scheduling, provisioning and pairing are
not established by these checks.
