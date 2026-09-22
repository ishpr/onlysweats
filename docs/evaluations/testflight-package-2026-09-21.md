# Standalone iPhone and Watch package — September 21, 2026

The standalone package is built and signed. TestFlight delivery is **not yet
complete**: Apple returned HTTP 502 during upload from both EAS Submit and the
local Xcode 27 uploader. No processed build or installable TestFlight release has
been verified.

## Package and source

- Version `1.0.0`, build `3`, bundle ID `app.samepace`.
- Xcode `27.0 (27A266a)` with iOS/watchOS 27 SDKs.
- Store-distribution `Release`, with embedded JavaScript and the live
  `https://samepace.app` API. It does not need Metro or a computer to run.
- Phone, widget and Watch have matching version/build numbers and App Store
  provisioning. Deep code-signature validation passes. Phone HealthKit and
  background-delivery entitlements and Watch HealthKit are present.
- The embedded JavaScript is 7,647,948 bytes. The production API URL is present;
  the development-token variable and synthetic-session marker are absent.
- IPA size: 31,037,204 bytes. SHA-256:
  `76f68ea8ed7202216081c7d83247c34823116c07a347b2d2d4e6cc0c794452a9`.
- Source started at `8a11bcf`; packaging/config changes are in `4c6f697`.
  Recorded checksums match all mobile/shared runtime sources at archive time.
  Submission metadata in `eas.json` was added afterward. Claude's subsequent
  presentation changes in PR #50 (`81e9ea2`) are not in this preserved IPA;
  merging them into main does not update its embedded JavaScript.

The first archive was withheld: its widget had build `1` while the phone and
Watch had build `2`. `with-widget-version` now uses a complete source plist
instead of letting Xcode's generated widget metadata overwrite EAS's remote
version. A fresh prebuild, regression test and the exported build `3` verify the
fix. Mobile types, focused lint, two Watch target tests, two live-mirror tests
and the widget-version test pass.

Expo's Release package retains an unused `_expo._tcp` Bonjour declaration and
dev-launcher permission-description string. The launcher entry is guarded by
`APP_DEBUG`, which is disabled in the Release archive. These declarations are
not evidence of a running development server or a Metro dependency; actual
standalone launch on the member's phone still needs observation.

## Store setup and delivery

[SamePace's App Store Connect record](https://appstoreconnect.apple.com/apps/6814677892/testflight/ios)
has Apple ID `6814677892`. The existing team submission key is stored in EAS;
no new provider secrets are in source control. The internal `SamePace Owner`
group has automatic build access and exactly one tester: the authenticated
owner. No other admins, external testers or public links were enabled.

Apple returned `502 Bad Gateway` when creating the upload container on
[the first EAS submission](https://expo.dev/accounts/servesys-corporation/projects/samepace/submissions/bab204fa-4228-4eb1-84b7-51a6812df693)
and [its retry](https://expo.dev/accounts/servesys-corporation/projects/samepace/submissions/e71f2b68-fa2b-4a92-aff0-fd399f5c05e0).
The local Xcode 27 uploader also returned 502 for `GET APP SETTINGS` using the
same authorized key. Its retry was stopped after repeated identical responses
and no upload progress; its temporary key file was removed. App creation, authenticated reads and owner-group
assignment succeed; no binary-validation rejection has been returned. Retry
delivery of the same audited IPA after the upload service responds, then verify
Apple processing and owner-group build access before calling the beta available.

EAS's optional release-note upload requires an Enterprise plan. The ordinary
binary submission was used without purchasing or changing a plan.

## Retry the preserved package

The audited IPA is also preserved outside the release worktree at
`/Users/ishprasad/code/samepace-shared-workouts/.vercel/launch-acceptance-2026-09-21/samepace-testflight.ipa`
with mode `0600` inside a mode `0700` evidence directory. Its checksum matches
the package above. No temporary upload-key directory remains.

After the release changes are merged and the live checkout is updated, first
check whether Apple has received build `3`:

```sh
cd /Users/ishprasad/code/samepace-shared-workouts/mobile
npx --yes eas-cli submit:status --platform ios --json --non-interactive
```

If that version/build is still absent, submit this same artifact without a
rebuild. EAS retrieves the existing submission credential securely:

```sh
npx --yes eas-cli submit --platform ios --profile production \
  --path ../.vercel/launch-acceptance-2026-09-21/samepace-testflight.ipa \
  --no-auto-testflight-setup --non-interactive --wait
```

Confirm Apple processing succeeds and build `3` is available to the internal
`SamePace Owner` group. Only then should the owner open TestFlight and install
SamePace. Do not enable external testing or submit an App Store release as part
of this retry.

## Physical acceptance

Read-only inventory identifies the connected iPhone 17 Pro Max on iOS 27 with
installed `app.samepace` version `1.0.0`, build `1`. Build `3` has not been
installed or exercised. No physical Watch was detected and paired-Watch
availability was not confirmed. Device Hub's remote view and actions were
unreliable. No new genuine HealthKit permission/source comparison, real Watch
recording, sensor, pairing, background-delivery or battery acceptance was
established by this pass.

Protected, ignored evidence is under `.vercel/launch-acceptance`: source
checksums, build/configuration reports, IPA/signature audit, compressed Xcode
logs, submission logs and owner-group verification. Temporary local build trees
and their transient signing material were removed after preserving the evidence.
