"""Listen to local clips with MOSS on Apple MPS. Run with python3.

MOSS-Music key and tempo estimates are informational only and cannot be used as checks.
"""

import argparse
from collections import Counter
from contextlib import ExitStack
import json
import math
import os
from pathlib import Path
import random
import re
from statistics import mean
import subprocess
from tempfile import TemporaryDirectory
from uuid import uuid4
import wave


RUBRIC = {
    "appeal": "overall appeal for a cheerful handmade fantasy walking toy",
    "fold_pop": "how pleasant and distinct the papery folds and soft pops sound",
    "musicality": "how melodic, in tune, and pleasant the music is",
    "vocals": "how cute and pleasant the character vocals are",
    "clarity": "how clearly the quiet sounds come through the loudest sound",
    "fatigue": "how irritating the loudest sound would be after a minute of looping",
}
# These scores stayed identical on all four clean-versus-tone control windows.
INSENSITIVE_ITEMS = frozenset({"fold_pop", "musicality", "clarity"})
WINDOW_SECONDS = 12
VOICE_PRESENCE_PROMPT = "Is there a voice in this audio? Answer yes or no."
VOICE_PROMPT = "What is the voice's apparent age, pitch, timbre, and emotion? Say no voice if absent."
WINDOW_CAPTION_PROMPT = "List the sounds you hear."
DEFECT_PROMPTS = {
    "steady_tone": "Do you hear a loud, steady high-pitched tone? Answer yes or no.",
    "clipping": "Do you hear crunchy distortion or clipping? Answer yes or no.",
    "loud_voice": "Is a voice too loud compared with the other sounds? Answer yes or no.",
    "harsh_sound": "Is any sound harsh or scary for a children's toy? Answer yes or no.",
    "repetition": "Does the same sound repeat enough to become annoying? Answer yes or no.",
}
# Neither control validated a question in at least three of four aligned windows.
ACTIVE_DEFECTS = frozenset()
MUSIC_ESTIMATE_NOTE = "Key and tempo estimates are informational only and cannot be used as checks."
MUSIC_PROMPTS = {
    "key": "What is the musical key? Say unclear if there is no clear key.",
    "bpm": "What is the tempo in BPM? Say unclear if there is no steady beat.",
    "mood": "What mood does this audio convey?",
}
SIDES = ("X", "Y")
NUMBER_WORDS = "zero one two three four five six seven eight nine ten".split()
SCORE = re.compile(
    r"^(?:(?:score|rating)\s*:\**\s*\**)?(?P<value>\d+(?:\.\d+)?|" + "|".join(NUMBER_WORDS)
    + r")\b\**(?:\s*(?:/\s*10|out of (?:10|ten))\b\**)?"
    r"(?=$|[\n.,:;!?)]|\s+[-–—]\s+(?!\d)|\s+(?-i:[A-Z]))",
    re.IGNORECASE,
)
CHOICE = re.compile(
    r"^(?:the\s+)?(first|second|neither)\b"
    r"(?=$|\**[\s.,:;!?)]|\**$)(?!\s+or\b)",
    re.IGNORECASE,
)


def parse_score(answer):
    match = SCORE.match(answer.strip().lstrip("*").strip())
    if not match:
        return None
    value = match["value"].lower()
    score = NUMBER_WORDS.index(value) if value in NUMBER_WORDS else float(value)
    return score if 1 <= score <= 10 else None


def parse_choice(answer):
    match = CHOICE.match(answer.strip().lstrip("*").strip())
    return match[1].lower() if match else None


def parse_yes_no(answer):
    response = answer.strip(" \t\r\n*_.!\"'").lower()
    return {"yes": True, "no": False}.get(response)


def read_yes_no(order, answers, field):
    results = {}
    for label in order:
        answer = next(answers)
        results[label] = {**answer, field: parse_yes_no(answer["answer"])}
    return results


def balanced_orders(repeats, rng):
    first = SIDES if rng.randrange(2) == 0 else SIDES[::-1]
    return [first if index % 2 == 0 else first[::-1] for index in range(repeats)]


def rubric_prompt(item, paired):
    subject = RUBRIC[item]
    if paired:
        return (
            f"Which of the two clips rates higher on {subject}? "
            "Answer first or second, then one sentence."
        )
    return f"Rate {subject} from 1 to 10. Reply with the number, then one sentence."


def make_job(audio, prompt):
    return {"audio": [str(Path(path).resolve(strict=True)) for path in audio], "prompt": prompt}


def rubric_jobs(clips, paired, has_vocals):
    groups = [clips] if paired else [[clip] for clip in clips]
    return [
        make_job(group, rubric_prompt(item, paired))
        for item in RUBRIC if item != "vocals" or has_vocals
        for group in groups
    ]


def excerpt_windows(duration, repeats):
    if duration <= 0:
        raise ValueError("Both clips need audio samples")
    length = min(WINDOW_SECONDS, duration / repeats)
    gap = (duration - length) / (repeats - 1) if repeats > 1 else 0
    return [
        {"start_seconds": index * gap, "end_seconds": index * gap + length}
        for index in range(repeats)
    ]


def open_pcm(path, temp):
    try:
        return wave.open(path, "rb")
    except wave.Error:
        # The model can also read WAV encodings that wave cannot slice, such as float PCM.
        converted = temp / f"{uuid4().hex}.wav"
        subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-c:a", "pcm_s32le", converted],
            check=True,
        )
        return wave.open(str(converted), "rb")


def stage_excerpts(pair, orders, labels, temp):
    with ExitStack() as stack:
        inputs = {
            label: stack.enter_context(open_pcm(pair[side], temp))
            for label, side in labels.items()
        }
        duration = min(clip.getnframes() / clip.getframerate() for clip in inputs.values())
        for order, window in zip(orders, excerpt_windows(duration, len(orders))):
            paths = []
            for label in order:
                source = inputs[label]
                rate = source.getframerate()
                start = round(window["start_seconds"] * rate)
                end = round(window["end_seconds"] * rate)
                if end <= start:
                    raise ValueError("Clips are too short for the requested repeats")
                source.setpos(start)
                path = temp / f"{uuid4().hex}.wav"
                with wave.open(str(path), "wb") as output:
                    output.setparams(source.getparams())
                    output.writeframes(source.readframes(end - start))
                paths.append(path)
            yield {"order": order, "window": window, "clips": paths}


def model_paths(family):
    home = Path.home()
    repo = home / ".local" / "share" / f"moss-{family}" / "repo"
    cache = (
        home / ".cache" / "huggingface" / "hub"
        / f"models--OpenMOSS-Team--MOSS-{family.title()}-8B-Instruct"
    )
    main_ref = cache / "refs" / "main"
    if main_ref.is_file():
        snapshot = cache / "snapshots" / main_ref.read_text().strip()
        if snapshot.is_dir():
            return repo, snapshot
    snapshots = [path for path in (cache / "snapshots").glob("*") if path.is_dir()]
    if len(snapshots) != 1:
        raise ValueError(f"Could not identify a local {family} snapshot in {cache}")
    return repo, snapshots[0]


def run_jobs(family, jobs, temp):
    repo, snapshot = model_paths(family)
    job_file = temp / "jobs.json"
    write_json(job_file, jobs)
    result = subprocess.run(
        [repo / ".venv" / "bin" / "python", Path(__file__).with_name("moss_ask.py").resolve(),
         "--family", family, "--model", snapshot, "--jobs", job_file],
        cwd=repo,
        env={
            **os.environ, "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
            "PYTHONDONTWRITEBYTECODE": "1", "PYTORCH_ENABLE_MPS_FALLBACK": "0",
        },
        stdout=subprocess.PIPE, text=True, check=True,
    )
    answers = [json.loads(line) for line in result.stdout.splitlines()]
    if len(answers) != len(jobs):
        raise ValueError(f"Expected {len(jobs)} model answers, got {len(answers)}")
    return answers


def preferred(left, right):
    if left == right:
        return "tie"
    return SIDES[0] if left > right else SIDES[1]


def win_counts(winners):
    counts = Counter(winners)
    return {"wins": {label: counts[label] for label in SIDES}, "ties": counts["tie"]}


def score_defects(questions, active):
    comparable = [
        sides for item, sides in questions.items()
        if item in active and all(sides[label]["yes"] is not None for label in SIDES)
    ]
    yes_counts = {label: sum(sides[label]["yes"] for sides in comparable) for label in SIDES}
    return {
        "questions": questions,
        "compared_questions": len(comparable),
        "yes_counts": yes_counts,
        "preferred": preferred(*(-yes_counts[label] for label in SIDES)),
    }


def aggregate_defects(rounds):
    results = [round_["defects"] for round_ in rounds]
    return {
        "questions": {
            item: {"prompt": prompt, "status": "active" if item in ACTIVE_DEFECTS else "insensitive"}
            for item, prompt in DEFECT_PROMPTS.items()
        },
        **win_counts(result["preferred"] for result in results),
        "compared_questions": sum(result["compared_questions"] for result in results),
        "yes_counts": {
            label: sum(result["yes_counts"][label] for result in results) for label in SIDES
        },
    }


def probe_two_audio(order, answers):
    trials = []
    for sequence, answer in zip((order, order[::-1]), answers):
        choice = parse_choice(answer["answer"])
        label = {"first": sequence[0], "second": sequence[1]}.get(choice)
        trials.append({"order": sequence, **answer, "choice": choice, "preferred": label})
    first, second = (trial["preferred"] for trial in trials)
    return {"passed": first is not None and first == second, "trials": trials}


def both_have_voices(presence):
    return all(presence[label]["present"] is True for label in SIDES)


def score_repeat(order, answers, paired, presence):
    items = {}
    scores = {}
    ceiling = 1 if paired else 11
    for item in RUBRIC:
        if item == "vocals" and not both_have_voices(presence):
            raw, values = [], (None, None)
        elif paired:
            raw = [next(answers)]
            choice = parse_choice(raw[0]["answer"])
            values = {"first": (1, 0), "second": (0, 1)}.get(choice, (None, None))
        else:
            raw = [next(answers) for _ in order]
            values = [parse_score(answer["answer"]) for answer in raw]
        items[item] = {"answers": raw, "scores": dict(zip(order, values))}
        if item in INSENSITIVE_ITEMS:
            items[item]["status"] = "insensitive"
        scores[item] = {
            label: ceiling - value if item == "fatigue" and value is not None else value
            for label, value in zip(order, values)
        }
    # Compare only items scored for both clips in this repeat.
    matched = [
        score for item, score in scores.items()
        if item not in INSENSITIVE_ITEMS and all(v is not None for v in score.values())
    ]
    totals = [sum(score[label] for score in matched) for label in SIDES]
    return {
        "order": order, "items": items, "scores": scores,
        "voice_presence": presence, "preferred": preferred(*totals),
    }


def score_window(repeat, answers, paired):
    ratings = score_repeat(repeat["order"], answers, paired, repeat["voice_presence"])
    rating_preferred = ratings["preferred"]
    defects = repeat["defects"]
    return {
        **ratings,
        "window": repeat["window"],
        "captions": repeat["captions"],
        "defects": defects,
        "rating_preferred": rating_preferred,
        "preferred": defects["preferred"] if rating_preferred == "tie" else rating_preferred,
    }


def aggregate(rounds):
    outcomes = win_counts(round_["preferred"] for round_ in rounds)
    wins = outcomes["wins"]
    means = {label: {} for label in SIDES}
    for label in SIDES:
        for item in RUBRIC:
            scores = [round_["scores"][item][label] for round_ in rounds]
            valid = [score for score in scores if score is not None]
            means[label][item] = mean(valid) if valid else None
    leading = preferred(*(wins[label] for label in SIDES))
    threshold = math.ceil(3 * len(rounds) / 4)
    return {
        **outcomes, "mean_scores": means,
        "preferred": leading if leading != "tie" and wins[leading] >= threshold else "tie",
    }


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def read_pairs(path):
    pairs = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(pairs, list) or not pairs:
        raise ValueError("The pairs file must be a nonempty JSON list")
    seen = {"key"}
    for pair in pairs:
        name = pair.get("pair") if isinstance(pair, dict) else None
        if (not isinstance(name, str) or not name.strip() or name in (".", "..")
                or "/" in name or "\\" in name or name.casefold() in seen):
            raise ValueError(f"Invalid, duplicate, or reserved pair ID: {name!r}")
        seen.add(name.casefold())
        for side in ("a", "b"):
            if not isinstance(pair.get(side), str) or not Path(pair[side]).is_file():
                raise ValueError(f"Pair {name!r} needs an existing WAV path for {side}")
    return pairs


def ab(args, temp):
    pairs = read_pairs(args.pairs)
    rng = random.Random(args.seed)
    key = {}
    prepared = []
    for pair in pairs:
        labels = dict(zip(SIDES, rng.sample(("a", "b"), 2)))
        key[pair["pair"]] = {
            label: {"side": side, "file": pair[side]} for label, side in labels.items()
        }
        orders = balanced_orders(args.repeats, rng)
        prepared.append((pair["pair"], list(stage_excerpts(pair, orders, labels, temp))))

    repeats = [repeat for _, pair_repeats in prepared for repeat in pair_repeats]
    first = repeats[0]
    probe_jobs = [
        make_job(clips, rubric_prompt("appeal", True))
        for clips in (first["clips"], first["clips"][::-1])
    ]
    probed = {
        item: prompt for item, prompt in DEFECT_PROMPTS.items()
        if args.probe_all_defects or item in ACTIVE_DEFECTS
    }
    audit_prompts = (VOICE_PRESENCE_PROMPT, WINDOW_CAPTION_PROMPT, *probed.values())
    audit_jobs = [
        make_job([clip], prompt)
        for repeat in repeats for prompt in audit_prompts for clip in repeat["clips"]
    ]
    probe_and_audit = run_jobs("audio", probe_jobs + audit_jobs, temp)
    probe = {"window": first["window"], **probe_two_audio(first["order"], probe_and_audit[:2])}
    paired = probe["passed"]
    audit_answers = iter(probe_and_audit[2:])
    for repeat in repeats:
        order = repeat["order"]
        repeat["voice_presence"] = read_yes_no(order, audit_answers, "present")
        repeat["captions"] = {label: next(audit_answers) for label in order}
        repeat["defects"] = score_defects({
            item: read_yes_no(order, audit_answers, "yes") for item in probed
        }, ACTIVE_DEFECTS)

    jobs = [
        job for repeat in repeats for job in rubric_jobs(
            repeat["clips"], paired, both_have_voices(repeat["voice_presence"])
        )
    ]
    answers = iter(run_jobs("audio", jobs, temp))
    write_json(args.out / "key.json", key)
    for name, pair_repeats in prepared:
        rounds = [score_window(repeat, answers, paired) for repeat in pair_repeats]
        report = {
            "mode": "paired_choice" if paired else "single_clip_rating",
            "repeats": rounds,
            "aggregate": aggregate(rounds),
            "defects": aggregate_defects(rounds),
            "insensitive_items": sorted(INSENSITIVE_ITEMS),
        }
        if name == prepared[0][0]:
            report["two_audio_test"] = probe
        write_json(args.out / f"{name}.json", report)


def captions(args, temp):
    music = args.command == "music"
    prompts = MUSIC_PROMPTS if music else {"caption": args.prompt}
    jobs = [make_job([path], prompt) for path in args.files for prompt in prompts.values()]
    answers = iter(run_jobs("music" if music else "audio", jobs, temp))
    results = []
    for path in args.files:
        result = {"file": path, **{field: next(answers) for field in prompts}}
        if music:
            result["estimate_note"] = MUSIC_ESTIMATE_NOTE
        results.append(result)
    write_json(args.out, results)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    ab_parser = commands.add_parser("ab", help="score blind pairs (paths relative to cwd)")
    ab_parser.add_argument("--pairs", required=True, type=Path)
    ab_parser.add_argument("--out", required=True, type=Path)
    ab_parser.add_argument("--repeats", type=int, default=4)
    ab_parser.add_argument("--seed", type=int)
    ab_parser.add_argument(
        "--probe-all-defects", action="store_true",
        help="also record insensitive defect answers for calibration",
    )
    for command in ("describe", "music"):
        sub = commands.add_parser(command, description=MUSIC_ESTIMATE_NOTE if command == "music" else None)
        sub.add_argument("--files", required=True, nargs="+")
        sub.add_argument("--out", required=True, type=Path)
        if command == "describe":
            sub.add_argument("--prompt", default=VOICE_PROMPT)
    args = parser.parse_args()
    if args.command == "ab" and args.repeats < 1:
        parser.error("--repeats must be at least 1")
    try:
        with TemporaryDirectory(prefix="moss-listen-") as directory:
            (ab if args.command == "ab" else captions)(args, Path(directory))
    except (OSError, ValueError, wave.Error, subprocess.CalledProcessError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
