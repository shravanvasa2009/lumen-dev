import zipfile
from dataclasses import replace

import numpy as np
import pandas as pd
import pytest
import wfdb

from datasets import build_intervals, download, registry
from datasets.splits import ExternalDataError


def prepare(key: str):
    dataset = next(entry for entry in registry.DATASETS if entry.key == key)
    dataset.local_dir.mkdir(parents=True, exist_ok=True)
    download.write_marker(dataset)
    return dataset.local_dir


def write_annotations(directory, record, extension, samples, symbols, aux_notes, fs):
    listing = directory / "RECORDS"
    listed = listing.read_text(encoding="utf-8").split() if listing.exists() else []
    if record not in listed:
        listing.write_text(" ".join([*listed, record]), encoding="utf-8")
    wfdb.wrann(
        record,
        extension,
        np.asarray(samples, dtype=np.int64),
        symbol=list(symbols),
        aux_note=list(aux_notes),
        fs=fs,
        write_dir=str(directory),
    )


def beats_from(start: int, gaps) -> np.ndarray:
    return start + np.concatenate([[0], np.cumsum(gaps)]).astype(np.int64)


def write_rhythm_record(directory, record, beat_extension, fs=250):
    # 50 sinus beats 800 ms apart, 40 AF beats, then 20 flutter beats (too few to keep).
    rng = np.random.default_rng(1)
    sinus = beats_from(100, np.full(49, 200))
    fibrillation = beats_from(10_050, rng.integers(100, 300, 39))
    flutter = beats_from(int(fibrillation[-1]) + 300, np.full(19, 150))
    rhythm_starts = [0, 10_000, int(fibrillation[-1]) + 150]
    write_annotations(directory, record, "atr", rhythm_starts, "+++", ["(N", "(AFIB", "(AFL"], fs)
    beats = np.concatenate([sinus, fibrillation, flutter])
    write_annotations(directory, record, beat_extension, beats, "N" * len(beats), [""] * len(beats), fs)
    return np.diff(fibrillation) / fs * 1000


def read_output(data_dir) -> pd.DataFrame:
    return pd.read_parquet(data_dir / "derived" / "intervals.parquet")


def test_afdb_episodes_follow_rhythm_annotations(data_dir):
    directory = prepare("afdb")
    af_intervals = write_rhythm_record(directory, "04015", "qrsc")
    build_intervals.main(["--only", "afdb"])
    episodes = read_output(data_dir)
    assert list(episodes["label"]) == ["sinus", "af"]
    assert list(episodes["episode"]) == [0, 1]
    assert set(episodes["subject"]) == {"04015"}
    assert set(episodes["r_peak_sample_rate"]) == {250.0}
    sinus, fibrillation = episodes["intervals_ms"]
    np.testing.assert_allclose(sinus, np.full(49, 800.0))
    np.testing.assert_allclose(fibrillation, af_intervals)
    assert not any(any(flags) for flags in episodes["premature"])


def test_afdb_uses_unaudited_qrs_when_no_corrected_file(data_dir):
    directory = prepare("afdb")
    write_rhythm_record(directory, "00735", "qrs")
    build_intervals.main(["--only", "afdb"])
    assert list(read_output(data_dir)["label"]) == ["sinus", "af"]


def test_afdb_prefers_corrected_beats(data_dir):
    directory = prepare("afdb")
    write_rhythm_record(directory, "04015", "qrsc")
    junk = np.arange(100, 30_000, 70)
    write_annotations(directory, "04015", "qrs", junk, "N" * len(junk), [""] * len(junk), 250)
    build_intervals.main(["--only", "afdb"])
    np.testing.assert_allclose(read_output(data_dir)["intervals_ms"][0], np.full(49, 800.0))


def test_out_of_range_interval_cuts_the_episode(data_dir):
    directory = prepare("afdb")
    fs = 250
    # 81 sinus beats with one 3 s gap after beat 40: two runs of 40 and 39 intervals. A second record
    # has its gap after beat 20, leaving runs of 19 and 60 intervals; the first is too short.
    for record, gap_at in (("05091", 40), ("05121", 20)):
        gaps = np.full(80, 200)
        gaps[gap_at - 1] = 3 * fs
        beats = beats_from(100, gaps)
        write_annotations(directory, record, "atr", [0], "+", ["(N"], fs)
        write_annotations(directory, record, "qrsc", beats, "N" * len(beats), [""] * len(beats), fs)
    build_intervals.main(["--only", "afdb"])
    episodes = read_output(data_dir)
    assert [len(intervals) for intervals in episodes["intervals_ms"]] == [39, 40, 60]
    assert list(episodes["record"]) == ["05091", "05091", "05121"]
    assert all(max(intervals) <= 2500 for intervals in episodes["intervals_ms"])


def write_mitdb_record(directory, record, fs=360):
    # 100 sinus beats 800 ms apart, with a ventricular premature beat at index 50 (500 ms coupling,
    # 1100 ms compensatory pause).
    gaps = np.full(99, 288)
    gaps[49], gaps[50] = 180, 396
    beats = beats_from(50, gaps)
    symbols = ["N"] * 100
    symbols[50] = "V"
    samples = np.concatenate([[0], beats])
    write_annotations(directory, record, "atr", samples, ["+", *symbols], ["(N"] + [""] * 100, fs)


def test_mitdb_premature_beat_makes_an_other_episode_with_context(data_dir):
    directory = prepare("mitdb")
    write_mitdb_record(directory, "119")
    build_intervals.main(["--only", "mitdb"])
    episodes = read_output(data_dir)
    assert list(episodes["label"]) == ["sinus", "other", "sinus"]
    # Beats 34-66 are within 16 beats of the premature beat: 33 beats, 32 intervals.
    assert [len(intervals) for intervals in episodes["intervals_ms"]] == [33, 32, 32]
    ectopic = episodes.iloc[1]
    flags = list(ectopic["premature"])
    assert flags.index(True) == 15 and sum(flags) == 1
    assert ectopic["intervals_ms"][15] == pytest.approx(500.0)
    assert ectopic["intervals_ms"][16] == pytest.approx(1100.0)


def test_mitdb_records_201_and_202_share_a_subject(data_dir):
    directory = prepare("mitdb")
    for record in ("201", "202", "203"):
        write_mitdb_record(directory, record)
    build_intervals.main(["--only", "mitdb"])
    subjects = read_output(data_dir).groupby("record")["subject"].first().to_dict()
    assert subjects == {"201": "201", "202": "201", "203": "203"}


def test_ltafdb_marks_ectopy_context_like_mitdb(data_dir):
    directory = prepare("ltafdb")
    fs = 128
    # 100 sinus beats with an atrial premature beat at index 50, then 50 AF beats with one ventricular
    # premature beat that must stay AF.
    sinus = beats_from(10, np.full(99, 102))
    symbols = ["N"] * 100
    symbols[50] = "A"
    fibrillation = beats_from(int(sinus[-1]) + 200, np.random.default_rng(3).integers(60, 150, 49))
    af_symbols = ["N"] * 50
    af_symbols[25] = "V"
    samples = np.concatenate([[0], sinus, [int(sinus[-1]) + 100], fibrillation])
    all_symbols = ["+", *symbols, "+", *af_symbols]
    aux_notes = ["(N", *([""] * 100), "(AFIB", *([""] * 50)]
    write_annotations(directory, "00", "atr", samples, all_symbols, aux_notes, fs)
    build_intervals.main(["--only", "ltafdb"])
    episodes = read_output(data_dir)
    assert list(episodes["label"]) == ["sinus", "other", "sinus", "af"]
    assert [len(intervals) for intervals in episodes["intervals_ms"]] == [33, 32, 32, 49]
    assert list(episodes["premature"][1]).index(True) == 15
    assert not any(episodes["premature"][0]) and not any(episodes["premature"][2])
    assert list(episodes["premature"][3]).index(True) == 24


def synthetic_ecg(seconds: float, rr_s: float, fs: int = 300) -> np.ndarray:
    times = np.arange(int(seconds * fs)) / fs
    signal = np.zeros_like(times)
    for peak in np.arange(0.5, seconds - 0.2, rr_s):
        signal += np.exp(-0.5 * ((times - peak) / 0.012) ** 2)
    return signal + np.random.default_rng(0).normal(0, 0.01, len(times))


def write_cinc(directory, recordings: dict[str, tuple[np.ndarray, str]]):
    staging = directory / "staging"
    staging.mkdir()
    with zipfile.ZipFile(directory / "training2017.zip", "w") as archive:
        for record, (signal, _) in recordings.items():
            wfdb.wrsamp(
                record,
                fs=300,
                units=["mV"],
                sig_name=["ECG"],
                p_signal=signal[:, None],
                fmt=["16"],
                write_dir=str(staging),
            )
            for suffix in (".hea", ".dat"):
                archive.write(staging / f"{record}{suffix}", f"training2017/{record}{suffix}")
    labels = "".join(f"{record},{label}\n" for record, (_, label) in recordings.items())
    (directory / "REFERENCE-v3.csv").write_text(labels, encoding="utf-8")


def test_cinc2017_detects_peaks_and_maps_labels(data_dir):
    directory = prepare("cinc2017")
    write_cinc(
        directory,
        {
            "A00001": (synthetic_ecg(40, 0.75), "N"),
            "A00002": (synthetic_ecg(40, 0.6), "~"),
            "A00003": (synthetic_ecg(10, 0.75), "A"),
            "A00004": (synthetic_ecg(40, 0.7), "O"),
        },
    )
    build_intervals.main(["--only", "cinc2017"])
    episodes = read_output(data_dir)
    assert list(episodes["record"]) == ["A00001", "A00004"]
    assert list(episodes["label"]) == ["sinus", "other"]
    assert list(episodes["subject"]) == ["A00001", "A00004"]
    # One sample at 300 Hz is 3.3 ms.
    np.testing.assert_allclose(episodes["intervals_ms"][0], 750.0, atol=3.4)
    assert (directory / "training2017" / "A00001.hea").exists()


def test_only_replaces_rows_of_rebuilt_datasets(data_dir):
    write_mitdb_record(prepare("mitdb"), "100")
    write_rhythm_record(prepare("afdb"), "04015", "qrsc")
    build_intervals.main(["--only", "afdb"])
    build_intervals.main(["--only", "mitdb"])
    build_intervals.main(["--only", "mitdb"])
    assert read_output(data_dir).groupby("dataset").size().to_dict() == {"afdb": 2, "mitdb": 3}


def test_unfinished_download_raises(data_dir):
    (data_dir / "open" / "afdb").mkdir(parents=True)
    with pytest.raises(FileNotFoundError, match="datasets.download"):
        build_intervals.main(["--only", "afdb"])


def test_dataset_under_external_is_refused(data_dir, monkeypatch):
    moved = tuple(
        replace(entry, use="external") if entry.key == "afdb" else entry for entry in registry.DATASETS
    )
    monkeypatch.setattr(registry, "DATASETS", moved)
    write_rhythm_record(prepare("afdb"), "04015", "qrsc")
    with pytest.raises(ExternalDataError):
        build_intervals.main(["--only", "afdb"])


def test_unknown_rhythm_key_is_rejected(data_dir):
    with pytest.raises(SystemExit):
        build_intervals.main(["--only", "butppg"])


def test_only_records_listed_in_records_file_are_read(data_dir):
    directory = prepare("mitdb")
    write_mitdb_record(directory, "102")
    # An alternate annotation file, like mitdb's 102-0.atr, that RECORDS does not list.
    wfdb.wrann(
        "102-0",
        "atr",
        np.array([0, 10]),
        symbol=["+", "N"],
        aux_note=["(N", ""],
        fs=360,
        write_dir=str(directory),
    )
    build_intervals.main(["--only", "mitdb"])
    assert set(read_output(data_dir)["record"]) == {"102"}
