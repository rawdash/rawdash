---
'@rawdash/connector-openai': minor
---

Declare the secondary token breakdowns OpenAI carries in metric `attributes` as `measures` so they conform to the metric-shape contract: `input_cached_tokens` and `input_audio_tokens` on `openai_completions_input_tokens`, and `output_audio_tokens` on `openai_completions_output_tokens`. The canonical token count remains in `value`; no attribute is dropped.
