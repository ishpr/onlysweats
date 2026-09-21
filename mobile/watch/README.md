# SamePace Watch recorder

`../plugins/with-watch.js` generates a native SwiftUI companion target from the
sources here during Expo prebuild. Register it after `with-healthkit` in the mobile
config. It uses `<phone bundle ID>.watchkitapp`, the phone version/build number,
and the configured Apple team. Do not hand-edit the generated iOS target.

The Watch requires watchOS 10; source zones/cues require watchOS 27 and an
Xcode 27 build. `compiler(>=6.4)` guards omit the new APIs and cue selection
when built with an older SDK. `SAMEPACE_HEALTH_LEGACY_SDK` can exercise that
fallback branch in local compile checks; it is not needed on older compilers. The current
implementation records run, walk, ride and strength workouts with
`HKWorkoutSession` and `HKLiveWorkoutBuilder`. Permission is requested on an
explicit Start. Workout write permission is checked separately from opaque read
permission. Pause/resume, stop → end collection → finish → end session, save
retry, and active-workout recovery are implemented. A nil workout after a
successful finish is treated as saved (HealthKit may hide the sample while
locked).

Cues are off by default. A selected heart-rate target uses the recording's
HealthKit zone configuration, with source thresholds; no age-derived zones,
readiness estimate, AI call, or network dependency. Missing/stale heart readings
silence cues. A ten-second dwell and thirty-second cooldown bound haptics.

HealthKit mirrors the running session to iPhone. Snapshots remain in memory and
never create cloud records. The phone shows readings only for a connected local
Health device, filters heart rate by its selected data types, clears old readings
at 15 seconds, and clears an inactive mirror at 30 seconds. Account/session
cleanup clears Live Activities. Finishing saves to Apple Health; the existing
anchored import later syncs that source workout and chosen readings. Apple may
delay Watch → iPhone Health replication; no synthetic substitute is created.

The plugin adds HealthKit capability and EAS target metadata. Physical builds
need Apple Developer provisioning for both phone and Watch bundle IDs, a paired
Watch, and the HealthKit capability. Phone background-delivery provisioning must
also include the entitlement added by `with-healthkit`.

Validation completed with Xcode 27: native Swift typecheck with watchOS 10 minimum,
Expo prebuild generated a target, and `xcodebuild` produced the Watch simulator
app. Pure deterministic cue checks execute without HealthKit or personal data:

```sh
swiftc watch/SamePaceWatch/ZoneCue.swift watch/ZoneCueChecks.swift -o /tmp/samepace-zone-cues
/tmp/samepace-zone-cues
```

A physical phone/Watch acceptance pass remains necessary: permission denial,
start/pause/resume, real heart-rate freshness and source zones, offline recording,
phone reconnection, recovery after app interruption, successful save/import,
account switch, and removal of synced data. Simulator compilation does not prove
sensor accuracy, background delivery, signing, or pairing.

Apple references: [running workout sessions](https://developer.apple.com/documentation/healthkit/running-workout-sessions),
[workout zone configurations](https://developer.apple.com/documentation/healthkit/hkworkoutzoneconfiguration),
[mirroring](https://developer.apple.com/documentation/healthkit/hkworkoutsession/startmirroringtocompaniondevice(completion:)),
[finishing a workout](https://developer.apple.com/documentation/healthkit/hkworkoutbuilder/finishworkout(completion:)).
