# Showcase recordings

Each take is two files, recorded together:

- **`<take>.json`: the beats.** The showcase build plays them through the live pipeline instead of the camera
  (`../scanSource.ts`).
- **`<take>.mp4`: the finger video.** The camera picture recorded with the take. The dial plays it in sync with
  the beats (`../filmVideo.tsx`).

The iPhone plays `nitin-*` and the Galaxy A17 plays `shravan-*`. `*-practice` is the setup's practice reading,
which also feeds the Lumen score. `*-scan` is the Full Scan. Each take is one continuous piece: the camera on the
carpet for 2–4 s, the finger landing, then the finger held still. The film shows the app refusing to read before
it counts.

**All eight files here are SYNTHETIC STAND-INS** (`tools/showcase/make-standins.mjs`), recorded from no one.
Before filming, replace them **locally** with the real takes and never commit the real ones:

```
node tools/showcase/video-take.mjs <Camera app video> --name shravan-scan --bpm 74 [--from <s of "Go">]
```

It cuts the finger video, builds the beats (real colours until the finger lands, then a covered lens with a
generated pulse), and runs `check-timing.mjs`. Shravan 74 bpm, Nitin 62 bpm. The older Lab path
(`import-capture.mjs`, `finger-video.mjs`, `generate-pulse.mjs`) still works.
