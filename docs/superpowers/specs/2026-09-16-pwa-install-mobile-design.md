# Home-screen icon for ZENVIA Gestión

## Goal
When a user manually uses the browser action to add ZENVIA Gestión to the phone home screen, the shortcut should use ZENVIA branding instead of a generic browser icon.

## Scope
- No automatic install prompt.
- No install button inside the app.
- No iPhone/iPad installation guide.
- No service worker and no offline behavior changes.
- No changes to authentication, navigation or business data flows.

## Implementation
- Add a Web App Manifest with the app name, start URL and ZENVIA icon metadata for Android/Chromium home-screen shortcuts.
- Add `apple-touch-icon` metadata for iPhone/iPad.
- Generate the install icon files from the existing `ZENVIA_LOGO` source in `src/branding.ts` before development and production builds, so the home-screen image stays aligned with the actual app branding.
- Generate both the original WebP logo and a square SVG wrapper suitable for home-screen presentation.

## Testing
- Regression test verifies manifest presence and icon references.
- Regression test verifies iOS touch-icon metadata.
- Regression test verifies the icon generator runs in both `dev` and `build` scripts.
- Regression test verifies no install-prompt UI is added.
- Existing application tests and production build must remain green.

## Deployment
Merge only after GitHub Actions passes tests and the production build, then verify the Vercel deployment status of the merged `main` commit.
