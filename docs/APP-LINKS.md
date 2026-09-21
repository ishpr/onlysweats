# App links

The native build claims only `samepace.app` routes `/invite/*`, `/session/*`, `/training-block/*`, `/verified`, and `/billing-return`. There is no wildcard host or arbitrary redirect destination. Public handoff pages reveal no private workout details. Invite codes remain on the public invite screen during sign-in; other accepted destinations pass through the public `/open` screen, which waits for sign-in before navigating. Only the documented invite and Stripe checkout ID parameters survive. A payment return URL does not prove payment; Billing must load the member's server state.

## Association files

- `https://samepace.app/.well-known/apple-app-site-association` returns application ID `NZBE9W77FA.app.samepace`, matching the existing Apple team and native bundle.
- `https://samepace.app/.well-known/assetlinks.json` uses server configuration `APP_LINK_ANDROID_SHA256_FINGERPRINTS`: comma-separated SHA-256 certificates, each 32 colon-separated hex bytes. Use the certificate actually signing the installed distribution. With Play App Signing this is the **app signing** certificate from Play Console, not the upload key. No certificate is guessed. Missing configuration serves `[]` with no caching (no Android association); malformed configuration returns 503 with no caching. Multiple explicit certificates support a deliberate signing rotation.

Both files return JSON directly without authentication or redirects. Associated domains and Android auto-verification are declared in `mobile/app.json`; they require a new native build, not just a JavaScript update. No new native dependency is required. Do not claim device verification from unit tests or publishing the files alone.

## Release verification

1. Deploy the association endpoints and confirm HTTPS 200, JSON content type, correct IDs, and no redirects at both exact URLs. Android remains pending until its real signing certificate is supplied.
2. Build/install the signed app with the new entitlements. Apple caches association data; use Developer Settings → Universal Links diagnostics if the CDN has not refreshed.
3. From Notes or Messages, tap a real invite while the app is stopped, then while open. Repeat signed out: sign in and confirm the **same invite** opens. Try an expired/malformed link; no private details or crash should appear. Repeat a shared session and training block link.
4. Test verification and billing returns. Cancelled sign-in must keep the pending destination; verification/payment status must come from the signed-in API. Account changes must not adopt a previous member's pending response.
5. On Android, reset and re-verify with `adb shell pm set-app-links --package app.samepace 0 all`, then `adb shell pm verify-app-links --re-verify app.samepace`, and inspect `adb shell pm get-app-links app.samepace`. Finally tap the HTTPS link from another app without an explicit package override.
6. Without the app installed, the browser handoff remains usable; install the app and reopen the original link. This is not deferred attribution across an app-store installation.

Sources: [Expo iOS Universal Links](https://docs.expo.dev/linking/ios-universal-links/), [Expo Android App Links](https://docs.expo.dev/linking/android-app-links/), [Apple associated domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains), [Android certificate association](https://developer.android.com/training/app-links/configure-assetlinks), [Android verification](https://developer.android.com/training/app-links/verify-applinks).
