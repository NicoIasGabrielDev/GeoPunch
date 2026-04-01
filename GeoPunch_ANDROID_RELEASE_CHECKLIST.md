# GeoPunch Android Release Checklist

## Current technical release state

- Android package id: `com.geopunch.app`
- Expo app version: `1.0.0`
- EAS project id is configured in `frontend/app.json`
- Production EAS profile is present in `frontend/eas.json`
- Android release path should be an `.aab` via EAS production build
- Android location scope was reduced to foreground-only for the first release
- Hardcoded Google Maps Android key was removed from native Android

## Required public env vars

- `EXPO_PUBLIC_BACKEND_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`
- `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY`

## Recommended key split

- Use `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` for Android Maps SDK
- Use `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` for Places Autocomplete requests
- If you temporarily use one key for both, make sure the enabled APIs and restrictions still allow both native Maps SDK and client-side Places requests

## Local checks before build

- Confirm the backend is reachable at `https://geopunch.onrender.com`
- Confirm Supabase auth works with the production anon key
- Confirm the Google Maps Android key is valid for package `com.geopunch.app`
- Confirm the Places API key has Places Autocomplete enabled
- Log in to Expo/EAS with the correct account

## Production build command

Run from `frontend/`:

```bash
eas build --platform android --profile production
```

## Optional local native validation

Run from `frontend/android/` after exporting env vars:

```bash
gradlew.bat bundleRelease
```

This validates the Android native bundle locally, but a Play-ready signed upload should use EAS-managed credentials unless you explicitly wire your own release keystore into Gradle.

If you run this on Windows from a long folder path, the native build can fail on New Architecture CMake path length limits. In that case, prefer EAS cloud build or move the repo to a shorter path before retrying local Gradle validation.
