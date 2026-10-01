import argparse
import logging
import shutil
import zipfile
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, NamedTuple

import numpy as np
import pandas as pd
import wfdb
import wfdb.processing

from datasets import download, paths, registry
from datasets.splits import ensure_not_external

Label = Literal["sinus", "af", "other"]

# DSP-9 plausible interval range (seconds); anything outside is a detection error or a pause.
MIN_INTERVAL_S, MAX_INTERVAL_S = 0.25, 2.5
# Rhythm-Net reads 32-interval windows, so an episode needs at least 33 beats.
MIN_INTERVALS = 32
# An isolated ectopic beat plus 16 beats either side is exactly one 33-beat "other" episode.
ECTOPY_CONTEXT_BEATS = 16

# WFDB beat annotation codes (https://archive.physionet.org/physiobank/annotations.shtml); everything
# else (rhythm "+", noise "~", non-conducted P "x", ...) is not a heartbeat.
BEAT_SYMBOLS = frozenset("NLRBAaJSVrFejnE/fQ?")
# Atrial, aberrated atrial, nodal, supraventricular, and ventricular premature beats, R-on-T, fusion.
PREMATURE_SYMBOLS = frozenset("AaJSVrF")
# Escape beats arrive late rather than early, but they still break sinus regularity.
ECTOPIC_SYMBOLS = PREMATURE_SYMBOLS | frozenset("Eejn")

CINC_LABELS: dict[str, Label | None] = {"N": "sinus", "A": "af", "O": "other", "~": None}
CINC_RECORDS_DIR = "training2017"

OUTPUT_COLUMNS = [
    "dataset",
    "subject",
    "record",
    "episode",
    "label",
    "intervals_ms",
    "premature",
    "r_peak_sample_rate",
]

log = logging.getLogger("datasets.build_intervals")


class Episode(NamedTuple):
    label: Label
    intervals_ms: list[float]
    premature: list[bool]


@dataclass(frozen=True)
class AnnotatedSource:
    # The first extension that exists for a record supplies the R-peaks.
    beat_extensions: tuple[str, ...]
    rhythm_extension: str
    split_ectopy: bool
    subject_of: Callable[[str], str]


def same_subject(record: str) -> str:
    return record


def mitdb_subject(record: str) -> str:
    # "Records 201 and 202 came from the same male subject" (mitdbdir/intro.htm).
    return "201" if record == "202" else record


ANNOTATED_SOURCES = {
    # afdb: only 05091 and 07859 ship corrected beats (.qrsc); the rest have only the unaudited .qrs.
    "afdb": AnnotatedSource(("qrsc", "qrs"), "atr", split_ectopy=False, subject_of=same_subject),
    # ltafdb: .atr holds the reviewed beat labels and the rhythm changes together.
    "ltafdb": AnnotatedSource(("atr",), "atr", split_ectopy=False, subject_of=same_subject),
    "mitdb": AnnotatedSource(("atr",), "atr", split_ectopy=True, subject_of=mitdb_subject),
}
RHYTHM_KEYS = (*ANNOTATED_SOURCES, "cinc2017")


def rhythm_label(aux_note: str) -> Label:
    code = aux_note.strip("\x00 ")
    if code == "(AFIB":
        return "af"
    if code == "(N":
        return "sinus"
    return "other"


def cut_episodes(
    beat_samples: np.ndarray, segment_ids: np.ndarray, labels: np.ndarray, premature: np.ndarray, fs: float
) -> list[Episode]:
    intervals_s = np.diff(beat_samples) / fs
    usable = (
        (segment_ids[:-1] >= 0)
        & (segment_ids[:-1] == segment_ids[1:])
        & (labels[:-1] == labels[1:])
        & (intervals_s >= MIN_INTERVAL_S)
        & (intervals_s <= MAX_INTERVAL_S)
    )
    edges = np.diff(np.concatenate([[0], usable.astype(np.int8), [0]]))
    starts, stops = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
    return [
        Episode(
            label=str(labels[start]),
            intervals_ms=(intervals_s[start:stop] * 1000).tolist(),
            # Interval i ends at beat i + 1, so its flag is that beat's.
            premature=premature[start + 1 : stop + 1].tolist(),
        )
        for start, stop in zip(starts, stops, strict=True)
        if stop - start >= MIN_INTERVALS
    ]


def mark_ectopy_context(labels: np.ndarray, ectopic: np.ndarray) -> np.ndarray:
    window = np.ones(2 * ECTOPY_CONTEXT_BEATS + 1)
    near_ectopy = np.convolve(ectopic.astype(float), window, mode="same") > 0
    marked = labels.copy()
    # Only sinus stretches become "other"; ectopy inside AF stays AF.
    marked[near_ectopy & (labels == "sinus")] = "other"
    return marked


def annotated_record_episodes(record_path: Path, source: AnnotatedSource) -> tuple[float, list[Episode]]:
    rhythm = wfdb.rdann(str(record_path), source.rhythm_extension)
    is_rhythm = np.array([symbol == "+" for symbol in rhythm.symbol]) & np.array(
        [note.startswith("(") for note in rhythm.aux_note]
    )
    segment_starts = rhythm.sample[is_rhythm]
    segment_labels = np.array([rhythm_label(note) for note in np.array(rhythm.aux_note)[is_rhythm]])

    present = [ext for ext in source.beat_extensions if record_path.with_suffix(f".{ext}").exists()]
    if not present:
        raise FileNotFoundError(f"{record_path}: none of {source.beat_extensions} beat files exist")
    beat_extension = present[0]
    beats = (
        rhythm if beat_extension == source.rhythm_extension else wfdb.rdann(str(record_path), beat_extension)
    )
    fs = beats.fs or rhythm.fs
    if not fs:
        raise ValueError(f"{record_path}: no sampling rate in the annotations or the header")
    symbols = np.array(beats.symbol)
    is_beat = np.isin(symbols, list(BEAT_SYMBOLS))
    beat_samples, beat_symbols = beats.sample[is_beat], symbols[is_beat]

    # Beats before the first rhythm annotation have no label (segment -1) and are never used.
    segment_ids = np.searchsorted(segment_starts, beat_samples, side="right") - 1
    # Object dtype so relabelling never truncates to the width of the labels already present.
    labels = np.where(segment_ids >= 0, segment_labels[np.maximum(segment_ids, 0)], "").astype(object)
    if source.split_ectopy:
        labels = mark_ectopy_context(labels, np.isin(beat_symbols, list(ECTOPIC_SYMBOLS)))
    premature = np.isin(beat_symbols, list(PREMATURE_SYMBOLS))
    return float(fs), cut_episodes(beat_samples, segment_ids, labels, premature, float(fs))


def annotated_records(directory: Path) -> list[str]:
    # RECORDS is the release's own list; globbing *.atr would also pick up mitdb's 102-0.atr, an
    # alternate annotation set for record 102, and count that subject twice.
    return sorted((directory / "RECORDS").read_text(encoding="utf-8").split())


def cinc_record_episodes(record_path: Path, label: Label) -> tuple[float, list[Episode]]:
    recording = wfdb.rdrecord(str(record_path), channels=[0])
    signal = recording.p_signal[:, 0]
    fs = float(recording.fs)
    # XQRS over gqrs: on 50 real CinC 2017 records (every 170th) XQRS took 1.1 s and gqrs 1.8 s for
    # 2,095 vs 2,089 beats, so XQRS is faster with the same yield. The whole set runs in minutes.
    peaks = wfdb.processing.xqrs_detect(signal, fs, verbose=False)
    # Detections can sit a few samples off the R apex; snapping to it makes intervals measure R to R.
    peaks = wfdb.processing.correct_peaks(
        signal, peaks, search_radius=int(0.05 * fs), smooth_window_size=int(0.1 * fs), peak_dir="compare"
    )
    peaks = np.unique(peaks[peaks >= 0])
    segment_ids = np.zeros(len(peaks), dtype=int)
    labels = np.full(len(peaks), label)
    premature = np.zeros(len(peaks), dtype=bool)
    return fs, cut_episodes(peaks, segment_ids, labels, premature, fs)


def extract_cinc(directory: Path) -> Path:
    records_dir = directory / CINC_RECORDS_DIR
    if records_dir.is_dir():
        return records_dir
    staging = directory / f"{CINC_RECORDS_DIR}.extracting"
    if staging.exists():
        shutil.rmtree(staging)
    with zipfile.ZipFile(directory / "training2017.zip") as archive:
        archive.extractall(staging)
    extracted = staging / CINC_RECORDS_DIR
    if not extracted.is_dir():
        raise FileNotFoundError(f"training2017.zip has no top-level {CINC_RECORDS_DIR}/ folder")
    # Renaming only after a full extract means an interrupted unzip is never mistaken for a finished one.
    extracted.replace(records_dir)
    staging.rmdir()
    return records_dir


def cinc_labels(directory: Path) -> dict[str, Label | None]:
    table = pd.read_csv(directory / "REFERENCE-v3.csv", header=None, names=["record", "code"], dtype=str)
    unknown = sorted(set(table["code"]) - set(CINC_LABELS))
    if unknown:
        raise ValueError(f"REFERENCE-v3.csv has unknown labels {unknown}")
    return {record: CINC_LABELS[code] for record, code in zip(table["record"], table["code"], strict=True)}


def episode_rows(key: str, subject: str, record: str, fs: float, episodes: list[Episode]) -> list[dict]:
    return [
        {
            "dataset": key,
            "subject": subject,
            "record": record,
            "episode": index,
            "label": episode.label,
            "intervals_ms": episode.intervals_ms,
            "premature": episode.premature,
            "r_peak_sample_rate": fs,
        }
        for index, episode in enumerate(episodes)
    ]


def checked_dataset_dir(key: str) -> Path:
    dataset = next(entry for entry in registry.DATASETS if entry.key == key)
    ensure_not_external(dataset.local_dir, "train")
    if not download.is_complete(dataset):
        raise FileNotFoundError(f"{key} is not fully downloaded; run python -m datasets.download --open")
    return dataset.local_dir


def build_dataset(key: str) -> list[dict]:
    directory = checked_dataset_dir(key)
    rows: list[dict] = []
    if key in ANNOTATED_SOURCES:
        source = ANNOTATED_SOURCES[key]
        for record in annotated_records(directory):
            fs, episodes = annotated_record_episodes(directory / record, source)
            rows += episode_rows(key, source.subject_of(record), record, fs, episodes)
        return rows

    records_dir = extract_cinc(directory)
    # Noisy recordings ("~") are excluded per spec §11.3.
    labelled = {record: label for record, label in cinc_labels(directory).items() if label is not None}
    for record in sorted(labelled):
        fs, episodes = cinc_record_episodes(records_dir / record, labelled[record])
        # CinC 2017 publishes no subject IDs, so each recording counts as its own subject.
        rows += episode_rows(key, record, record, fs, episodes)
    return rows


def summarize(episodes: pd.DataFrame) -> pd.DataFrame:
    return (
        episodes.assign(interval_count=episodes["intervals_ms"].map(len))
        .groupby(["dataset", "label"])
        .agg(
            episodes=("episode", "size"),
            subjects=("subject", "nunique"),
            intervals=("interval_count", "sum"),
        )
    )


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m datasets.build_intervals")
    parser.add_argument("--only", nargs="+", choices=RHYTHM_KEYS, help="rebuild only these datasets")
    args = parser.parse_args(argv)
    keys = args.only or list(RHYTHM_KEYS)

    rows: list[dict] = []
    for key in keys:
        log.info("%s: reading", key)
        rows += build_dataset(key)
    rebuilt = pd.DataFrame(rows, columns=OUTPUT_COLUMNS)

    output = paths.derived_dir() / "intervals.parquet"
    if output.exists():
        kept = pd.read_parquet(output)
        rebuilt = pd.concat([kept[~kept["dataset"].isin(keys)], rebuilt], ignore_index=True)
    rebuilt = rebuilt.sort_values(["dataset", "record", "episode"], ignore_index=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    partial = output.with_name(output.name + ".partial")
    rebuilt.to_parquet(partial, index=False)
    partial.replace(output)
    log.info("wrote %s\n%s", output, summarize(rebuilt).to_string())


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    main()
