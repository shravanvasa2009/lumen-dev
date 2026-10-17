# Showcase recordings

The showcase build plays these through the live pipeline instead of the camera (`../scanSource.ts`).
The iPhone plays `nitin-*` and the Galaxy A17 plays `shravan-*`. `*-attempt1` is the first capture of a
run (the refused one), and `*-scan` is every capture after it.

**The four files here now are SYNTHETIC STAND-INS** for rehearsal. `tools/showcase/make-standins.mjs`
generated them. They are not recorded from anyone. Before filming, replace them with real Lab captures:

```
node tools/showcase/import-capture.mjs <captures/folder> --name shravan-scan --from 3 --to 115 --motion 20-24,45-49,70-74
node tools/showcase/check-timing.mjs shravan-scan
```

`motion` holds the stretches, in seconds of the recording, when the person moved. Lab captures have no
accelerometer stream, so these stretches stand in for it.
