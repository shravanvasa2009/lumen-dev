# sqi-rule 1.0.0 (ablation model, not shipped)

Lumen is a screening prototype, not a diagnosis.

## Intended use

Experimental. An extra, reject-only guard on each 4-second fingertip window during capture (owner decision H-024 option B): the rule-based checks, DSP-4 contact and exposure and the DSP-9 artifact rules, are the quality gate, and SQI-Net may only reject more windows; it never accepts a window the rules reject. The owner re-decides its role after the M2 team captures (hand-labeled clean and bad windows from the owner's phone), the data §11.2 asks for. Version 1 sees only the inverted red channel, z-scored per window (ADR 0023); green is added in version 2. Part of a screening prototype, not a diagnosis.

This is an ablation model and does not ship; the app loads sqi-finger for the sqi family (ADR 0031). On development subjects it did not beat sqi-finger (window-level AUROC for clean vs bad on dev-val subjects).

## Data

Only finger recordings are used; BUT PPG ear and front-camera recordings are excluded (ADR 0023). Clean windows: BUT PPG finger windows whose PPG heart rate matches the ECG reference; clean BUT PPG beats re-timed with real interval patterns from AF and premature-beat episodes (MIT-BIH AF, Long-Term AF, MIT-BIH Arrhythmia); team captures hand-labeled clean. Bad windows: synthetic motion, pressure, flicker, and dropout corruptions of clean windows, and team captures hand-labeled bad. MIMIC PERform AF is never used for training or tuning.

Trained on: butppg, afdb, ltafdb, mitdb. Splits are by subject: no person appears in both development-train and development-validation.

Training notes, as written at training time:

- Data: BUT PPG 2.0.0 finger recordings only (subject-info.csv 'Ear/finger' = 1; the dataset page says 'measurement spot: 0 (ear) or 1 (finger)', https://physionet.org/content/butppg/2.0.0/). Clean = quality 1, which the dataset defines as most annotators' PPG HR within 5 bpm of the ECG reference (§11.2's clean definition). Quality 0 records are bad.
- Windows: −R (DSP-3) at 30 fps, DSP-2 cubic spline to 64 Hz, 4 s windows every 1 s, z-scored by lumen_dsp sqi_model_input; flat windows are excluded, as the app never scores them.
- Re-timed clean windows (§11.2): clean records are cut into beats at ECG R-peaks plus a per-record lag (the foot of the record's mean pulse) and kept only if their beats correlate with their mean (median r ≥ 0.8); 138 dev-train records qualified. Beats are laid out on real AF, premature-beat, and sinus intervals from MIT-BIH AF, Long-Term AF, and MIT-BIH Arrhythmia (dev-train subjects of ml/splits/rhythm.json for training, dev-val subjects for the ML-4 proxy), with systole kept and diastole stretched, each pulse scaled by its preceding interval over the median (clamped to 0.4–1.2), on the record's own DC level.
- Bad windows: one corrupted copy of every dev-train clean window (natural and re-timed) and of every dev-val natural clean window: band-limited 0.5–5 Hz motion bursts at 1–5× the window SD, pressure (80% AC loss, then clipping), 1–2% ambient flicker at 0.5–14.5 Hz on the camera frames, or a dropout (frozen frames or a level step). Burst and dropout lengths are assumptions.
- Training, early stopping, and the rule's logistic fit weight windows so clean and bad carry equal weight; clean kinds (natural and each re-timed rhythm) carry equal weight; among bad kinds, poor-quality records carry half and the corruptions share the other half; within a kind, every subject carries equal weight.
- Records whose quality-hr-ann.csv HR differs by more than 5 bpm from 60 / median R-R of their own verified .qrs beats are left out, since quality is defined against that HR (ADR 0038); this removes most records of subjects 142–149.
- Design changes made after earlier dev-val runs in which no τ reached 0.95: the reference check; poor-quality records weighted as half of the bad side (was one kind of five); learning rate 3e-4 with patience 8 (was 1e-3, 6); keeping poor-quality records out of τ. A run that also gave natural clean windows half of the clean side failed the ML-4 proxy, so clean kinds stay equal (ADR 0028: the proxy informs training against the rhythm trap).
- Threshold basis 'synthetic-bad-only' is PROPOSED (ADR 0038 item 7), awaiting the owner's decision in H-024: τ is the lowest score with clean precision ≥ 0.95 over dev-val natural clean windows and one synthetic corruption of each, checked by assert_precision on the same scores, with quality-0 records left out. With quality-0 counted as bad, no τ reaches 0.95 for the shipped model. Its 20 highest-scoring quality-0 windows come from records 136057, 136074, 149019, 149073, 149074. A phone frame-timing fault in those recordings is a hypothesis, not checked; the app's real frame timestamps (DSP-1) are expected to prevent it, but that is not verified. The Threshold section gives both precisions at the same τ. Precision depends on the mix of clean and bad windows; real captures will have a different mix.
- spectralHrWithin5BpmOfAllNaturalClean is the ML-2 proxy's ceiling: the share of all dev-val natural clean windows whose spectral-peak HR is within 5 bpm, whatever the model accepts. Much of the proxy's shortfall from 95% is the 4 s spectral estimator, not the quality check.
- Dev-val numbers are optimistic: early stopping and τ were chosen on dev-val. MIMIC PERform AF (ML-4) is the external check and has not been run.
- ML-2 proxy: HR is the window's spectral peak in 0.6–3.5 Hz, compared with the record's reference HR (the 10 s record's ECG HR from quality-hr-ann.csv). The app's HR uses beats over a whole reading.
- ML-4 proxy (ADR 0028): acceptance of re-timed sinus minus re-timed AF windows, with 1776 AF and 1776 sinus windows.
- Ship rule (window-level AUROC for clean vs bad on dev-val subjects): sqi-finger ships.
- The rule baseline (sqi-rule) leaves out §11.1's acquisition checks (DSP-4 contact, clipping, exposure), which need camera frames that BUT PPG does not have.
- The shipped model's ML-2 proxy is below the 95% that ML-2 requires.

## Development metrics

Development-validation subjects: 9. Confidence intervals resample subjects.

| metric | estimate | 95% CI low | 95% CI high |
|---|---|---|---|
| windowAuroc | 0.5424610366074665 | 0.49949381061652587 | 0.5873790500424483 |

## Threshold

Threshold basis: synthetic-bad-only. Status: PROPOSED, awaiting owner (H-024). ADR 0038 item 7; nothing ships on this basis until then.

With quality-0 counted as bad, the best precision any τ reaches while accepting at least 10% of natural clean windows is 0.382 (clean recall 0.866); no τ reaches 0.95.

These numbers follow design iteration on the same 9 dev-val subjects (the reference check; poor-quality records weighted as half of the bad side (was one kind of five); learning rate 3e-4 with patience 8 (was 1e-3, 6); keeping poor-quality records out of τ), so they are optimistic.

Hypothesis, not verified: the 20 highest-scoring quality-0 windows come from records 133036, 133040, 133082, 133088, 133089, 136072, 137030, 137035, 137058, 137060, 137061, 137065, 137104, 137105, 147089; 0 of them are accepted at τ_clean, and their spectral-peak HR is a median 23.2 bpm from the record's reference HR. A phone frame-timing fault in those recordings may explain this; it has not been checked. The app's real frame timestamps (DSP-1) are expected to prevent such a fault, but that has not been verified.

Label check, dev-train: 445 of 1370 finger records removed (CSV reference HR more than 5 bpm from the record's own .qrs beats); 6 of 21 subjects lost records, 0 lost all of them.

Label check, dev-val: 111 of 556 finger records removed (CSV reference HR more than 5 bpm from the record's own .qrs beats); 2 of 9 subjects lost records, 0 lost all of them.

## Ablation

The neural model ships only if it beats its classical baseline on held-out subjects.

| model | window AUROC (95% CI) | τ_clean | clean precision | clean recall | corrupted rejected | clean precision with poor-quality records | ML-2 proxy | ML-4 proxy gap, points |
|---|---|---|---|---|---|---|---|---|
| sqi-finger | 0.839 (0.775-0.891) | 0.5958 | 0.951 (0.933-0.975) | 0.637 (0.555-0.754) | 0.967 (0.947-0.985) | 0.663 (0.446-0.816) | 0.668 (0.417-0.811) | 2.309 (-2.415-15.001) |
| sqi-rule | 0.542 (0.499-0.587) | no threshold reaches 0.95 clean precision |  |  |  |  |  |  |

## Calibration

Not measured yet: no training run is recorded for this model version.

## External test

Dataset: mimic-perform-af. Not run yet. Run once per model version, only after the owner approves (need-human).

## Limitations

- If clean training windows were all regular, the model could reject AF windows as noisy. The rhythm-bias check (ML-4) on the external test measures this.
- Trained mostly on public smartphone data; phones and skin tones outside it may behave differently.

## What the app shows when the model abstains

A window that the rule checks or SQI-Net rejects is not used. The live check coaches the user (finger position, pressure, staying still) and capture continues. If the model fails to load, the rule-based quality checks run alone and the result card says "basic analysis."
