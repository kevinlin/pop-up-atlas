import json
from pathlib import Path
import random
from struct import pack, unpack
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import UUID
import wave

from audio import listen, moss_ask


def answer(text):
    return {"answer": text, "seconds": 1.0}


def voices(x, y):
    return {"X": {"present": x}, "Y": {"present": y}}


def write_clip(path, rate, duration, offset=0):
    values = [offset + index * (16 // rate) for index in range(duration * rate)]
    with wave.open(str(path), "wb") as clip:
        clip.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        clip.writeframes(pack(f"<{len(values)}h", *values))


class ListenTests(unittest.TestCase):
    def test_balanced_orders(self):
        for seed in range(10):
            with self.subTest(seed=seed):
                orders = listen.balanced_orders(4, random.Random(seed))
                self.assertEqual(orders, listen.balanced_orders(4, random.Random(seed)))
                self.assertEqual(orders[::2], [orders[0]] * 2)
                self.assertEqual(orders[1::2], [orders[0][::-1]] * 2)
        orders = listen.balanced_orders(5, random.Random(42))
        self.assertEqual(sorted([orders.count(listen.SIDES), orders.count(listen.SIDES[::-1])]), [2, 3])

    def test_parse_score(self):
        for text, score in [
            ("8. Pleasant sounds.", 8), ("Score: **7.5**.", 7.5), ("**Seven** out of ten.", 7),
            ("10/10", 10), ("  Nine\nPleasant sound.", 9), ("8 - Clear mix.", 8),
            ("8 The sounds are crisp.", 8), ("**Rating:** **9/10** Clear mix.", 9),
            ("5/9", None), ("7-8", None), ("7 - 8", None), ("-1", None), ("11", None), ("0", None),
            ("There are 7 sounds.", None), ("", None), ("1000000!!!!", None),
        ]:
            with self.subTest(text=text):
                self.assertEqual(listen.parse_score(text), score)
        self.assertIsNone(listen.parse_score("Zero. No vocals."))

    def test_parse_choice(self):
        self.assertEqual(listen.parse_choice("**First.** The mix is clearer."), "first")
        self.assertEqual(listen.parse_choice("The second clip is clearer."), "second")
        self.assertIsNone(listen.parse_choice("First or second."))
        self.assertIsNone(listen.parse_choice("Clip quality is high."))

    def test_rating_aggregation(self):
        answers = [answer(text) for text in (
            "8", "6", "good", "3", "5", "5", "7", "6", "2", "9"
        )]
        with patch.object(listen, "INSENSITIVE_ITEMS", frozenset()):
            good = listen.score_repeat(("X", "Y"), iter(answers), False, voices(False, False))
            worse = listen.score_repeat(("Y", "X"), iter(answers), False, voices(False, False))
            no_data = listen.score_repeat(("X", "Y"), iter([answer("")] * 10), False, voices(False, False))
        self.assertEqual(good["items"]["fatigue"]["scores"], {"X": 2, "Y": 9})
        self.assertEqual(good["scores"]["fatigue"], {"X": 9, "Y": 2})
        self.assertEqual(good["preferred"], "X")
        aggregate = listen.aggregate([good] * 3 + [worse])
        self.assertEqual(aggregate["wins"], {"X": 3, "Y": 1})
        self.assertEqual(aggregate["preferred"], "X")
        self.assertEqual(aggregate["mean_scores"]["X"]["fatigue"], 7.25)
        self.assertEqual(aggregate["mean_scores"]["X"]["fold_pop"], 3)
        self.assertIsNone(listen.aggregate([good])["mean_scores"]["X"]["fold_pop"])
        aggregate = listen.aggregate([good] * 2 + [worse, no_data])
        self.assertEqual(aggregate["ties"], 1)
        self.assertEqual(aggregate["preferred"], "tie")

    def test_paired_scores(self):
        answers = [answer(text) for text in ("first", "first", "second", "first", "first", "second")]
        with patch.object(listen, "INSENSITIVE_ITEMS", frozenset()):
            scores = listen.score_repeat(("Y", "X"), iter(answers), True, voices(True, True))
        self.assertEqual(scores["scores"]["appeal"], {"Y": 1, "X": 0})
        self.assertEqual(scores["scores"]["vocals"], {"Y": 1, "X": 0})
        self.assertEqual(scores["scores"]["fatigue"], {"Y": 1, "X": 0})
        self.assertEqual(scores["preferred"], "Y")

    def test_voice_presence_gates_vocals(self):
        scores = [answer("7")] * 10
        for presence in (voices(False, False), voices(True, False), voices(None, True)):
            with self.subTest(presence=presence):
                report = listen.score_repeat(("Y", "X"), iter(scores), False, presence)
                self.assertEqual(report["voice_presence"], presence)
                self.assertEqual(report["scores"]["vocals"], {"Y": None, "X": None})
                self.assertEqual(report["items"]["vocals"]["answers"], [])
                self.assertEqual(report["scores"]["clarity"], {"Y": 7, "X": 7})

    def test_yes_no_parsing(self):
        for response, expected in [
            ("Yes.", True), ("  **YES**.\n", True), ("**No**", False), ("'no!'", False),
            ("No idea", None), ("Yes or no", None), ("No?", None), ("", None),
        ]:
            with self.subTest(response=response):
                self.assertIs(listen.parse_yes_no(response), expected)

    def test_defect_aggregation_uses_comparable_answers(self):
        def flags(x, y):
            return {"X": {"yes": x}, "Y": {"yes": y}}

        active = {"clipping", "steady_tone", "repetition"}
        worse_y = listen.score_defects({
            "clipping": flags(False, True),
            "steady_tone": flags(True, True),
            "repetition": flags(True, None),
            "loud_voice": flags(False, True),
        }, active)
        tie = listen.score_defects({"clipping": flags(None, True)}, active)
        self.assertEqual(worse_y["compared_questions"], 2)
        self.assertEqual(worse_y["yes_counts"], {"X": 1, "Y": 2})
        self.assertEqual(worse_y["preferred"], "X")
        self.assertEqual(tie["preferred"], "tie")
        with patch.object(listen, "ACTIVE_DEFECTS", active):
            result = listen.aggregate_defects([{"defects": row} for row in (worse_y, worse_y, tie)])
        self.assertEqual(result["wins"], {"X": 2, "Y": 0})
        self.assertEqual(result["ties"], 1)
        self.assertEqual(result["yes_counts"], {"X": 2, "Y": 4})
        self.assertEqual(result["questions"]["clipping"]["status"], "active")
        self.assertEqual(result["questions"]["loud_voice"]["status"], "insensitive")

    def test_defects_break_rating_ties_only(self):
        repeat = {
            "order": ("X", "Y"), "window": {}, "captions": {},
            "voice_presence": voices(False, False),
            "defects": listen.score_defects(
                {"steady_tone": {"X": {"yes": True}, "Y": {"yes": False}}}, {"steady_tone"}
            ),
        }
        tied_ratings = [answer("7")] * 10
        row = listen.score_window(repeat, iter(tied_ratings), False)
        self.assertEqual(row["rating_preferred"], "tie")
        self.assertEqual(row["preferred"], "Y")
        row = listen.score_window(repeat, iter([answer("9"), *tied_ratings[1:]]), False)
        self.assertEqual(row["rating_preferred"], "X")
        self.assertEqual(row["preferred"], "X")
        repeat["defects"] = listen.score_defects({}, set())
        row = listen.score_window(repeat, iter(tied_ratings), False)
        self.assertEqual(row["preferred"], "tie")

    def test_insensitive_item_kept_in_report_excluded_from_totals(self):
        answers = [answer(text) for text in ("7", "6", "8", "8", "8", "8", "1", "10", "5", "5")]
        with patch.object(listen, "INSENSITIVE_ITEMS", {"clarity"}):
            report = listen.score_repeat(("X", "Y"), iter(answers), False, voices(False, False))
        self.assertEqual(report["items"]["clarity"]["status"], "insensitive")
        self.assertEqual(report["scores"]["clarity"], {"X": 1, "Y": 10})
        self.assertEqual(report["preferred"], "X")

    def test_excerpts_use_distinct_time_aligned_windows(self):
        with TemporaryDirectory() as directory:
            temp = Path(directory)
            pair = {"a": str(temp / "a.wav"), "b": str(temp / "b.wav")}
            write_clip(pair["a"], 8, 30)
            write_clip(pair["b"], 16, 33)
            orders = listen.balanced_orders(4, random.Random(42))
            repeats = list(listen.stage_excerpts(pair, orders, {"X": "a", "Y": "b"}, temp))
            for index, repeat in enumerate(repeats):
                start = index * 7.5
                self.assertEqual(repeat["window"], {"start_seconds": start, "end_seconds": start + 7.5})
                for path in repeat["clips"]:
                    with wave.open(str(path), "rb") as excerpt:
                        self.assertEqual(unpack("<h", excerpt.readframes(1))[0], 16 * start)
                        self.assertEqual(excerpt.getnframes() / excerpt.getframerate(), 7.5)

    def test_job_file(self):
        with TemporaryDirectory() as directory:
            temp = Path(directory)
            clips = [temp / "test-1.wav", temp / "test-2.wav"]
            for clip in clips:
                clip.touch()
            for paired in (True, False):
                with self.subTest(paired=paired):
                    jobs = listen.rubric_jobs(clips, paired, has_vocals=True)
                    self.assertEqual(len(jobs), 6 if paired else 12)
                    self.assertEqual(jobs[0]["audio"], [str(p.resolve()) for p in (clips if paired else clips[:1])])
                    self.assertEqual(jobs[0]["prompt"].count("?"), 1 if paired else 0)
                    raw = "".join(json.dumps(answer("First")) + "\n" for _ in jobs)
                    with (
                        patch.object(listen, "model_paths", return_value=(temp, temp)),
                        patch.object(listen.subprocess, "run", return_value=SimpleNamespace(stdout=raw)),
                    ):
                        self.assertEqual(len(listen.run_jobs("audio", jobs, temp)), len(jobs))
                    self.assertEqual(json.loads((temp / "jobs.json").read_text()), jobs)
        prompt = moss_ask.prompt_with_audio("Which clip?", 2)
        self.assertEqual(prompt.count("<|audio_bos|><|AUDIO|><|audio_eos|>"), 2)
        self.assertTrue(prompt.endswith("Which clip?<|im_end|>\n<|im_start|>assistant\n"))

    def test_blind_reports_and_unreliable_two_audio_fallback(self):
        for passes_probe in (False, True):
            with self.subTest(passes_probe=passes_probe), TemporaryDirectory() as directory:
                temp = Path(directory)
                pairs = temp / "pairs.json"
                clips = [temp / "candidate-old.wav", temp / "candidate-new.wav"]
                for clip, offset in zip(clips, (0, 1000)):
                    write_clip(clip, 8, 30, offset)
                pairs.write_text(json.dumps([{"pair": "demo", "a": str(clips[0]), "b": str(clips[1])}]))
                out = temp / "output"

                def run_jobs(family, jobs, _):
                    self.assertEqual(family, "audio")
                    for job in jobs:
                        for path in map(Path, job["audio"]):
                            self.assertEqual(path.suffix, ".wav")
                            self.assertEqual(UUID(path.stem).hex, path.stem)
                    if jobs[2]["prompt"] == listen.VOICE_PRESENCE_PROMPT:
                        self.assertEqual(jobs[0]["audio"], jobs[1]["audio"][::-1])
                        probed = list(listen.DEFECT_PROMPTS) if passes_probe else ["steady_tone"]
                        prompts = [listen.VOICE_PRESENCE_PROMPT, listen.WINDOW_CAPTION_PROMPT]
                        prompts.extend(listen.DEFECT_PROMPTS[item] for item in probed)
                        self.assertEqual(
                            [job["prompt"] for job in jobs[2:]],
                            [prompt for prompt in prompts for _ in range(2)] * 4,
                        )
                        probe = [answer("First"), answer("Second" if passes_probe else "First")]
                        samples = ["Yes", "No", "chimes", "pops", *("Yes", "No") * len(probed)]
                        return probe + [answer(text) for text in samples * 4]
                    self.assertEqual(len(jobs), 20 if passes_probe else 40)
                    self.assertEqual({len(job["audio"]) for job in jobs}, {2 if passes_probe else 1})
                    self.assertEqual(len({path for job in jobs for path in job["audio"]}), 8)
                    self.assertTrue(all("character vocals" not in job["prompt"] for job in jobs))
                    return [answer("First" if passes_probe else "7")] * len(jobs)

                with (
                    patch.object(listen, "run_jobs", side_effect=run_jobs),
                    patch.object(listen, "ACTIVE_DEFECTS", {"steady_tone"}),
                ):
                    listen.ab(SimpleNamespace(
                        pairs=pairs, out=out, seed=42, repeats=4, probe_all_defects=passes_probe
                    ), temp)
                report_text = (out / "demo.json").read_text()
                for clip in clips:
                    self.assertNotIn(clip.name, report_text)
                report = json.loads(report_text)
                self.assertEqual(report["two_audio_test"]["passed"], passes_probe)
                self.assertIn(report["repeats"][0]["order"], [list(listen.SIDES), list(listen.SIDES[::-1])])
                for repeat in report["repeats"]:
                    first, second = repeat["order"]
                    self.assertTrue(repeat["voice_presence"][first]["present"])
                    self.assertFalse(repeat["voice_presence"][second]["present"])
                    self.assertEqual(repeat["captions"][first]["answer"], "chimes")
                    self.assertEqual(repeat["captions"][second]["answer"], "pops")
                    self.assertEqual(repeat["defects"]["yes_counts"], {first: 1, second: 0})
                    self.assertEqual(repeat["defects"]["preferred"], second)
                    self.assertEqual("clipping" in repeat["defects"]["questions"], passes_probe)
                    if not passes_probe:
                        self.assertEqual(repeat["rating_preferred"], "tie")
                        self.assertEqual(repeat["preferred"], second)
                self.assertEqual(report["defects"]["questions"]["clipping"]["status"], "insensitive")
                self.assertNotIn('"side"', report_text)
                self.assertNotIn('"file"', report_text)
                key = json.loads((out / "key.json").read_text())["demo"]
                self.assertEqual({value["side"] for value in key.values()}, {"a", "b"})
                self.assertEqual({value["file"] for value in key.values()}, set(map(str, clips)))


if __name__ == "__main__":
    unittest.main()
