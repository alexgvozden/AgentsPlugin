# Test matrix: screens and devices

Use the project's own configuration first (e.g. Playwright `projects`, existing simulators). These are the defaults when the project has none.

## Web

| Choice | Viewports (CSS px) | Playwright device names |
|---|---|---|
| Desktop only | 1440 × 900 (plus 1280 × 800 if the layout changes there) | `Desktop Chrome` (add `Desktop Safari`/`Desktop Firefox` if the project already runs them) |
| Desktop + mobile web | Desktop above, plus 390 × 844 (iPhone) and 412 × 915 (Android) | `Desktop Chrome`, `iPhone 15` (WebKit), `Pixel 7` (Chromium) |
| All screens | Desktop + mobile above, plus tablet 768 × 1024 and 1024 × 1366 | add `iPad (gen 7)` and `iPad Pro 11` |

Standard checks per changed page and size:

- The e2e flow passes (`npx playwright test --project=<name>` or the project's script).
- No horizontal scroll at mobile widths; no console errors.
- Keyboard: every interactive element reachable and visible on focus.
- Accessibility: `@axe-core/playwright` (or the project's checker) reports no violations.
- A screenshot saved per page and size; list the paths.

## iOS (macOS only)

- Simulators: `xcrun simctl list devices available`.
- Unit and UI tests: `xcodebuild test -scheme <Scheme> -destination 'platform=iOS Simulator,name=<device>'`.
- Default devices: the smallest supported (e.g. iPhone SE 3rd generation) and a current large one (e.g. iPhone 15 Pro Max); add iPad if the app supports it.
- Screenshots: `xcrun simctl io booted screenshot <path>`.
- Not possible on Windows or Linux: say so; suggest CI (macOS runner) or skipping.

## Android

- Devices: `adb devices`; emulators: `emulator -list-avds` (start one with `emulator -avd <name>` if none is running).
- Unit tests: `./gradlew testDebugUnitTest`; instrumented UI tests: `./gradlew connectedDebugAndroidTest`; build: `./gradlew assembleDebug`.
- Default devices: a small phone (about 360 × 640 dp) and a large one (Pixel 7 class); tablet if supported.
- Screenshots: `adb exec-out screencap -p > <path>`.

## Cross-platform

- **Flutter:** `flutter test`; `flutter test integration_test -d <device id>` per device from `flutter devices`; `flutter build apk` / `flutter build ios --no-codesign` (macOS).
- **React Native / Expo:** `npx jest`; Detox (`detox test -c <config>`) or Maestro (`maestro test <flow>`) if the project has them; `npx expo run:android` / `run:ios` builds. If no UI test tool exists, ask before adding one.

## Backend, CLI, library

- The full test suite plus integration tests against a local service or container if the project has them.
- Show the main request/response or command output in the conversation, since the goal checker cannot run anything itself.
