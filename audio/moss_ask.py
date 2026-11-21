"""Run an offline JSON job list in the selected model repo's venv and cwd."""

import argparse
import json
from pathlib import Path
import sys
from time import perf_counter


def prompt_with_audio(prompt, count):
    if count == 1:
        return prompt
    # The processor's default chat prompt inserts only one audio placeholder.
    return (
        "<|im_start|>system\nYou are a helpful assistant.<|im_end|>\n"
        "<|im_start|>user\n"
        + "<|audio_bos|><|AUDIO|><|audio_eos|>\n" * count
        + f"{prompt}<|im_end|>\n<|im_start|>assistant\n"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--family", required=True, choices=("audio", "music"))
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--jobs", required=True, type=Path)
    args = parser.parse_args()

    import soundfile
    import torch
    from torchaudio.functional import resample

    if not torch.backends.mps.is_available():
        parser.exit(1, "MPS is unavailable in this session.\n")

    sys.path.insert(0, str(Path.cwd()))
    if args.family == "audio":
        from src.modeling_moss_audio import MossAudioModel as Model
        from src.processing_moss_audio import MossAudioProcessor as Processor
    else:
        from src.modeling_moss_music import MossMusicModel as Model
        from src.processing_moss_music import MossMusicProcessor as Processor

    def load_audio(path, sample_rate):
        # soundfile bypasses torchcodec's FFmpeg version restriction on this host.
        data, rate = soundfile.read(path, dtype="float32", always_2d=True)
        waveform = data.mean(axis=1)
        if rate != sample_rate:
            waveform = resample(torch.from_numpy(waveform), rate, sample_rate).numpy()
        return waveform

    jobs = json.loads(args.jobs.read_text(encoding="utf-8"))
    model = Model.from_pretrained(
        args.model, local_files_only=True, dtype="auto", device_map="mps"
    ).eval()
    processor = Processor.from_pretrained(
        args.model, local_files_only=True, enable_time_marker=True
    )

    for job in jobs:
        audios = [load_audio(path, processor.config.mel_sr) for path in job["audio"]]
        prompt = prompt_with_audio(job["prompt"], len(audios))
        inputs = processor(text=prompt, audios=audios, return_tensors="pt").to(model.device)
        inputs["audio_data"] = inputs["audio_data"].to(model.dtype)
        inputs["audio_input_mask"] = inputs["input_ids"] == processor.audio_token_id
        torch.mps.synchronize()
        start = perf_counter()
        with torch.no_grad():
            output = model.generate(
                **inputs, max_new_tokens=128, do_sample=False, num_beams=1, use_cache=True
            )
        torch.mps.synchronize()
        seconds = round(perf_counter() - start, 3)
        answer = processor.decode(
            output[0, inputs["input_ids"].shape[1]:], skip_special_tokens=True
        )
        print(json.dumps({"answer": answer, "seconds": seconds}), flush=True)


if __name__ == "__main__":
    main()
