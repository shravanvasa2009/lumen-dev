import numpy as np
import pandas as pd
import pytest

from datasets import paths
from datasets.splits import ExternalDataError
from train import butppg, sqi_split
from train import sqi_windows as sw


def write_butppg_tables(root, rows):
    folder = root / "open" / "butppg"
    folder.mkdir(parents=True)
    spots = pd.DataFrame({"ID": [row[0] for row in rows], "Ear/finger": [row[1] for row in rows]})
    labels = pd.DataFrame({"ID": [row[0] for row in rows], "Quality": [row[2] for row in rows], "HR": 70})
    # The real files start with a UTF-8 byte-order mark.
    spots.to_csv(folder / "subject-info.csv", index=False, encoding="utf-8-sig")
    labels.to_csv(folder / "quality-hr-ann.csv", index=False, encoding="utf-8-sig")


def test_finger_records_keep_finger_only_and_key_subjects_by_prefix(data_dir):
    write_butppg_tables(data_dir, [("100001", 1, 1), ("100002", 0, 1), ("132005", 1, 0)])
    table = butppg.finger_records()
    assert table["record"].tolist() == ["100001", "132005"]
    assert table["subject"].tolist() == ["100", "132"]
    assert table["quality"].tolist() == [1, 0]


def test_butppg_reads_are_refused_inside_external(data_dir, monkeypatch):
    monkeypatch.setattr(butppg, "butppg_dir", lambda: paths.external_dir() / "butppg")
    with pytest.raises(ExternalDataError):
        butppg.finger_records()


@pytest.mark.skipif(not (butppg.butppg_dir() / "132001").exists(), reason="BUT PPG is not downloaded")
def test_both_record_layouts_decode_to_negative_red():
    # First release: 300 one-sample signals, already inverted. Second release: raw R, G, B means.
    first, second = butppg.negative_red("100001"), butppg.negative_red("132001")
    assert first.shape == second.shape == (300,)
    assert first.max() <= 0 and second.max() <= 0
    # Raw red sits near the top of the 0–255 range under the flash; −R is its negative.
    assert -255 <= second.min() and np.abs(np.diff(second)).max() < 20


def test_reference_must_match_the_verified_beats():
    # The helper's reference is 72 bpm: beats every 0.8 s (75 bpm) agree, every 0.75 s (80 bpm) do not.
    assert butppg.reference_consistent(recording([], np.arange(0.0, 10.0, 0.8)))
    assert not butppg.reference_consistent(recording([], np.arange(0.0, 10.0, 0.75)))
    assert not butppg.reference_consistent(recording([], [0.5, 1.2]))


def test_split_holds_out_subjects_from_both_releases():
    subjects = [f"{number}" for number in [*range(100, 112), *range(132, 150)]]
    first, again = sqi_split.split_subjects(subjects), sqi_split.split_subjects(subjects)
    assert first == again and set(first) == set(subjects)
    held_out = [subject for subject, split in first.items() if split == "dev-val"]
    assert any(subject < "112" for subject in held_out) and any(subject >= "112" for subject in held_out)
    assert len(held_out) == 4 + 5


def test_a_ten_second_record_gives_six_windows_of_256():
    frames = np.sin(2 * np.pi * 1.2 * np.arange(300) / 30.0)
    windows = sw.raw_windows(frames)
    assert len(windows) == 6 and all(len(window) == 256 for window in windows)


def recording(frames, peaks, quality=1):
    return butppg.Recording(
        "132001", "132", quality, 72.0, np.asarray(frames, float), np.asarray(peaks, float)
    )


def pulse_train(peaks_s, foot_lag_s, count=300):
    # A fast rise and slow fall starting foot_lag_s after each R-peak.
    times = np.arange(count) / 30.0
    signal = np.zeros(count)
    for peak in peaks_s:
        since = times - (peak + foot_lag_s)
        rising = (since >= 0) & (since < 0.12)
        falling = since >= 0.12
        signal[rising] += since[rising] / 0.12
        signal[falling] += np.exp(-(since[falling] - 0.12) / 0.25)
    return signal


def test_cut_lag_finds_the_pulse_foot():
    peaks = np.arange(0.2, 9.8, 0.8)
    lag = sw.cut_lag_s(pulse_train(peaks, 0.3), peaks)
    assert abs(lag - 0.3) < 0.05


def test_regular_beats_are_cut_and_noise_is_refused():
    peaks = np.arange(0.2, 9.8, 0.8)
    beats = sw.cut_beats(recording(pulse_train(peaks, 0.3), peaks))
    assert beats is not None and len(beats) >= sw.MIN_BEATS
    assert all(abs(beat.shape[0]) < 1e-9 and abs(beat.shape[-1]) < 1e-9 for beat in beats)
    noise = np.random.default_rng(0).normal(size=300)
    assert sw.cut_beats(recording(noise, peaks)) is None


def test_warp_keeps_systole_and_fits_the_new_interval():
    shape = np.r_[np.linspace(0, 1, 31), np.linspace(1, 0, 211)[1:]]
    beat = sw.Beat(shape=shape, peak_index=30)
    for duration in (0.4, 0.8, 1.4):
        warped = sw.warp_beat(beat, duration)
        assert len(warped) == round(duration * sw.FINE_RATE_HZ)
    # 0.8 s keeps the 0.1 s rise to the peak unchanged.
    assert int(np.argmax(sw.warp_beat(beat, 0.8))) == 30


def test_retimed_pulses_follow_the_pattern_and_scale_with_the_preceding_interval():
    shape = np.r_[np.linspace(0, 1, 31), np.linspace(1, 0, 211)[1:]]
    beats = [sw.Beat(shape=shape, peak_index=30)]
    source = recording(np.full(300, -200.0), [])
    intervals = np.array([0.8, 0.8, 0.4, 1.2, *([0.8] * 12)])
    frames = sw.retimed_frames(source, beats, sw.Pattern("afdb:1", intervals))
    pulse = frames + 200.0
    onsets = np.r_[0, np.cumsum(intervals[1:])]
    peaks = [pulse[int(round((onset + 0.1) * 30))] for onset in onsets[:4]]
    # Beat 2 follows the 0.4 s interval: 0.4 / median 0.8 = 0.5. Beat 3 follows 1.2 s: clamped to 1.2.
    assert peaks[0] == pytest.approx(1.0, abs=0.05)
    assert peaks[2] == pytest.approx(0.5, abs=0.05)
    assert peaks[3] == pytest.approx(1.2, abs=0.06)


def episodes_frame():
    return pd.DataFrame(
        {
            "dataset": ["afdb", "afdb", "mitdb", "mitdb", "cinc2017"],
            "subject": ["1", "2", "100", "101", "A1"],
            "label": ["af", "af", "other", "sinus", "af"],
            # mitdb 100's intervals differ by 1 ms each, so a drawn chunk shows where it came from.
            "intervals_ms": [
                [700.0] * 40,
                [500.0] * 40,
                [800.0 + i for i in range(40)],
                [900.0] * 40,
                [600.0] * 40,
            ],
            "premature": [
                [False] * 40,
                [False] * 40,
                [False] * 20 + [True] + [False] * 19,
                [False] * 40,
                [False] * 40,
            ],
        }
    )


def test_pattern_pool_uses_only_its_split_and_named_databases():
    assignment = {
        "afdb:1": "dev-train",
        "afdb:2": "dev-val",
        "mitdb:100": "dev-train",
        "mitdb:101": "dev-train",
        "cinc2017:A1": "dev-train",
    }
    pool = sw.PatternPool(episodes_frame(), assignment, "dev-train", "af")
    assert pool.subjects == ["afdb:1"]
    pattern = pool.draw(np.random.default_rng(0), 10.0)
    assert pattern.intervals_s[1:].sum() >= 10.0


def test_premature_patterns_contain_the_premature_beat():
    assignment = {"mitdb:100": "dev-train"}
    pool = sw.PatternPool(episodes_frame(), assignment, "dev-train", "premature")
    for seed in range(10):
        laid_out = np.rint(pool.draw(np.random.default_rng(seed), 10.0).intervals_s[1:] * 1000) - 800
        # Interval 20 ends at the premature beat; it is among the first four laid out.
        assert 20 in laid_out[:4]


def test_corruptions_match_the_spec():
    rng = np.random.default_rng(1)
    window = -200 + np.sin(2 * np.pi * 1.2 * np.arange(256) / 64.0)
    pressed = sw.corrupt_window(window, "pressure", rng)
    assert np.mean(pressed == pressed.max()) >= 0.3
    assert np.ptp(pressed) <= sw.PRESSURE_AC_KEPT * np.ptp(window) + 1e-9
    moved = sw.corrupt_window(window, "motion", np.random.default_rng(2))
    changed = np.flatnonzero(np.abs(moved - window) > 1e-9)
    assert sw.MOTION_BURST_S[0] * 64 - 2 <= len(changed) <= sw.MOTION_BURST_S[1] * 64
    dropped = sw.corrupt_window(window, "dropout", np.random.default_rng(3))
    assert 0.3 * 64 - 1 <= np.sum(dropped != window) <= 1.5 * 64
    frames = np.full(300, -240.0)
    flickered = sw.flicker_frames(frames, np.random.default_rng(4)) - frames
    assert 0.01 * 240 * 0.9 <= np.abs(flickered).max() <= 0.02 * 240


def test_every_clean_window_gets_one_corrupted_copy_and_flat_windows_are_dropped():
    peaks = np.arange(0.2, 9.8, 0.8)
    rows = sw.Rows()
    sw.add_clean_and_corrupted(
        rows, pulse_train(peaks, 0.3), sw.NATURAL, recording([], peaks), np.random.default_rng(0)
    )
    windows = rows.window_set()
    assert (windows.labels == sw.CLEAN).sum() == (windows.labels == sw.BAD).sum() == 6
    assert set(windows.kinds[windows.labels == sw.BAD]) <= set(sw.CORRUPTIONS)
    assert np.all(windows.reference_hr_bpm[windows.labels == sw.CLEAN] == 72.0)
    flat = sw.Rows()
    flat.add(np.zeros(256), sw.CLEAN, sw.NATURAL, recording([], peaks))
    assert not flat


def test_window_cache_round_trips(tmp_path):
    peaks = np.arange(0.2, 9.8, 0.8)
    rows = sw.Rows()
    sw.add_clean_and_corrupted(
        rows, pulse_train(peaks, 0.3), sw.NATURAL, recording([], peaks), np.random.default_rng(0)
    )
    path = tmp_path / "train.npz"
    stored = sw.cached(path, rows.window_set)
    assert not list(tmp_path.glob("*.partial*"))
    for name, column in rows.window_set()._asdict().items():
        np.testing.assert_array_equal(getattr(stored, name), column)


def test_build_covers_every_rhythm_even_when_beats_round_down():
    # 14 intervals of 714.2858 ms just pass 10 s, but each is 214.29 fine samples and rounds down to 214.
    episodes = pd.DataFrame(
        {
            "dataset": ["afdb", "mitdb", "mitdb"],
            "subject": ["1", "100", "101"],
            "label": ["af", "other", "sinus"],
            "intervals_ms": [[714.2858] * 60] * 3,
            "premature": [[False] * 60, [False] * 30 + [True] + [False] * 29, [False] * 60],
        }
    )
    assignment = {"afdb:1": "dev-train", "mitdb:100": "dev-train", "mitdb:101": "dev-train"}
    pools = {rhythm: sw.PatternPool(episodes, assignment, "dev-train", rhythm) for rhythm in sw.RHYTHMS}
    peaks = np.arange(0.2, 9.8, 0.8)
    plan = sw.BuildPlan(natural=True, retimed_per_rhythm=1, corrupt_retimed=False)
    windows = sw.build_window_set([recording(pulse_train(peaks, 0.3), peaks)], pools, plan, seed=1)
    counts = {kind: int((windows.kinds == kind).sum()) for kind in (sw.NATURAL, *sw.RETIMED)}
    assert counts == dict.fromkeys((sw.NATURAL, *sw.RETIMED), 6)
