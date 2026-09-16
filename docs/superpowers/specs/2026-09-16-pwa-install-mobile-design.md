# PWA install experience for mobile

## Goal
Make ZENVIA Gestión installable from mobile browsers and place a ZENVIA-branded shortcut/app on the home screen on Android and iPhone/iPad, without changing the existing business workflows.

## User experience
- On the first mobile visit, if the app is not already running as an installed web app, show a compact install prompt with `Instalar` and `Ahora no`.
- Dismissing the first prompt is remembered locally so the prompt is not shown repeatedly.
- While the app is not installed, keep a small install action available in the mobile top-right controls, next to the existing theme/logout controls, rather than adding another item to the already crowded bottom navigation.
- Once the app is running in standalone mode, hide all install UI.

### Android / Chromium
- Capture the `beforeinstallprompt` event and defer it until the user taps `Instalar`.
- The prompt action opens the browser-native installation dialog.
- Handle `appinstalled` to remove the install UI immediately.

### iPhone / iPad
- Safari/WebKit does not provide the Chromium `beforeinstallprompt` flow. The install action therefore opens a short guided sheet telling the user to use Share -> Add to Home Screen.
- On current iOS/iPadOS, sites added to the Home Screen can run as web apps; the manifest remains useful for identity, name, icon and standalone behavior.
- Detect standalone mode using the standards-based display-mode media query and the iOS standalone signal where available.

## PWA application metadata
- Add a Web App Manifest with:
  - name: `ZENVIA Gestión`
  - short_name: `ZENVIA`
  - id/start_url/scope rooted at `/`
  - display: `standalone`
  - theme/background colors aligned with the existing UI
  - ZENVIA app icons
- Add iOS web-app metadata and touch icon metadata to the document head.
- Reuse the current ZENVIA visual identity for installed-app icons; create dedicated install icon assets rather than relying only on the browser favicon.

## Service worker and caching
- Register a service worker through Vite's PWA integration.
- Cache only the application shell/static build assets needed to launch the UI reliably.
- Do not cache Supabase/API business responses as authoritative offline data. Orders, invoices, customers, products and authentication must continue to come from the live backend.
- Use an update strategy that activates new builds predictably and avoids trapping users on an old business application version.

## Code structure
- `vite.config.ts`: add PWA plugin configuration, manifest and service-worker strategy.
- `src/components/InstallAppPrompt.tsx`: own install-state detection, Android prompt handling, iOS instructions, first-visit dismissal and standalone detection.
- `src/App.tsx`: render the install component for authenticated users.
- mobile CSS: style the banner, install icon and iOS instruction sheet without disturbing the bottom navigation.
- static icon assets: ZENVIA-branded install icons/touch icon.

## Error and compatibility behavior
- If the browser does not expose a native install event, do not present a broken native-install button; show platform-appropriate guidance when install-to-home-screen is available.
- If service-worker registration fails, the app must continue to work as the existing website.
- Installation is additive only; login, navigation and data mutations must behave exactly as before.

## Testing
Add regression tests that verify:
1. PWA manifest/plugin configuration exists and uses standalone mode.
2. The install UI listens for `beforeinstallprompt` and `appinstalled`.
3. Android install action calls the deferred prompt.
4. iOS receives manual Add to Home Screen guidance instead of a non-existent native prompt.
5. Install UI is hidden in standalone mode.
6. First-prompt dismissal is persisted.
7. ZENVIA icon metadata is wired for manifest and iOS.
8. Existing application logic tests and the production build remain green.

## Deployment validation
- Run the full GitHub Actions test/build workflow on a feature branch.
- Merge only after tests and `npm run build` pass.
- Verify the production Vercel status on the merged `main` commit before considering the work complete.
