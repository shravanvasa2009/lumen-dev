# Lumen

![Lumen](apps/mobile/assets/brand/lockup-light.svg)

Lumen measures your pulse with the phone's rear camera and flashlight. Lay a finger across the flash
and the lens; in 30–90 seconds it reports heart rate, checks the pulse rhythm for an irregular
pattern, and shows HRV and breathing rate. It refuses to report when the signal isn't clean, and
every number carries a label that says how well it has been tested.

> **Screening prototype. Not a diagnosis. Not FDA-cleared.** If you have chest pain, fainting, or
> trouble breathing, call 911.

## What it does

- Heart rate and slow/fast resting-rate flags, plus four target conditions: an irregular rhythm
  like AFib, a racing regular rhythm (possible PSVT), the heart-rate pattern of POTS on standing,
  and a pulse-shape pattern linked to diabetes in research (not a diabetes test). HRV (on phones
  filming at ≥ 60 fps) and breathing rate.
- Every flag is gated by measured evidence; a result that has not met its accuracy floor is shown
  as Experimental and never flagged.
- A live quality gate that counts only clean seconds and coaches the user.
- A per-phone Compatibility Rating that decides which features a phone can run.
- Evidence labels ("Checked vs reference", "Tested on public data", "Experimental") read from
  `docs/validation/evidence.json`, plus an in-app "How accurate is Lumen?" screen.
- Light and dark mode, home-screen and lock-screen widgets, a standing-test live timer, and local
  reminders that never show health details on the lock screen.
- Everything runs on the phone. No account, no server, no analytics. English and Spanish.

## Requirements

- Node.js LTS (20 or newer), npm, Git
- Expo account and EAS CLI (`npm install -g eas-cli`) for development and release builds
- For iPhone builds: an Apple Developer Program membership (builds run in the cloud with EAS)
- For Android UI work: Android Studio emulator or another Android emulator with ADB
- For the ML pipeline: [uv](https://docs.astral.sh/uv/) and Python 3.11

Run `npm run doctor` to check your environment.

## Getting started

```bash
npm ci
npm run doctor
cd apps/mobile
eas build --profile development --platform ios   # or: npx expo run:android
npx expo start --dev-client
```

## Useful scripts

| Script                              | What it does                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm run doctor`                    | Checks the development environment and prints fixes                                                    |
| `npm run verify:fast`               | Scope, privacy, style, contrast, lock-screen copy, diabetes wording, brand, lint, types, changed tests |
| `npm run proof -- m0` … `m6`, `m4d` | Checks a milestone's acceptance criteria                                                               |
| `npm run receiver`                  | Development-only receiver for Lab-mode captures                                                        |

## Repository layout

| Path                     | Contents                                                             |
| ------------------------ | -------------------------------------------------------------------- |
| `apps/mobile`            | Expo app (routes, UI, storage) and the `lumen-capture` native module |
| `packages/core`          | Signal processing in pure TypeScript                                 |
| `packages/device-db`     | Phone layouts and the rating formula                                 |
| `tools/replay`           | Replays recorded captures through the same pipeline (validation)     |
| `tools/capture-receiver` | Development-only capture receiver                                    |
| `ml`                     | Python training and evaluation (uv)                                  |
| `models`                 | ONNX models, manifest, and model cards                               |
| `docs/validation`        | Aggregate validation results (no personal data)                      |

See `ARCHITECTURE.md` for how the pieces fit together.

## Tested devices

Generated from `packages/device-db/devices.json` by `npm run devices:table`.

| Phone | Tier | HR error vs ECG strap | Interval error | Notes |
| ----- | ---- | --------------------- | -------------- | ----- |
| iPhone 16 | — | — | — | Not tested yet |

## Privacy

Lumen saves only color averages from the camera, never video or images. Readings stay on the phone.
Release builds make no network requests during a reading.

## License

Not yet chosen.
