---
name: aiu-research-workbench
description: Operate the user's local AIU research workbench to run studies, recover interruptions, inspect evidence and revise research materials. Use for this project's research workflow, not unrelated paper-writing requests.
---

Use the existing research API at `http://127.0.0.1:8000`; the corresponding MCP server is `aiu-research`. Start the app with `scripts/start.ps1` if it is stopped. Read `docs/checklist.md` and `docs/research-workbench.md` in the project before continuing an existing study.

The current registered experiment is digits classification with Gaussian augmentation. General domains and arbitrary generated-code execution remain unimplemented. Preserve the user's research goal and explain any gap between that goal and the implemented scope.

- Inspect `research_capabilities` and `research_list_runs` first. Reuse a matching active run.
- Start authorized work with `research_start` and a stable request ID. Leave resource limits unset by default; apply a time, call or fit limit only when the user asks for one. Limits are optional, and actual usage remains recorded. The registered full study performs 18 fits; a reduced single-candidate study performs 15. Retrying after a lost response must keep both ID and payload.
- Use `research_get_run` compact output and cursor-based `research_events`; fetch full outputs only when needed. Completed steps are reused by the graph and journal.
- `research_resume` records an agent recovery and retains actual usage, including any explicitly configured limits. Do not repeatedly resume a task after the same exhausted-budget or evidence-integrity failure.
- Request user action only when it is necessary: missing author/venue credentials, hardware or unavailable account access. Record the exact blocker and attempted automatic recovery.
- Verify final files with `research_artifact`. Cite actual source reading scope. Extracted PDF text does not prove formulas and tables were understood correctly.
- Paper roles may use configured DeepSeek/OpenAI, existing Codex CLI login or a recorded local fallback. Never copy, request in chat or expose API secrets. For a missing DeepSeek key, direct the user to the local page's paper model settings: test the connection and save to enable it immediately. A blank key can reuse the saved key. Connection testing reads the model list; it is not evidence of a successful paper generation. Credentials belong in the ignored `configs/.env` or environment variables; manual file changes require restart, while the settings API updates the writer immediately after verified persistence.
- Numeric manuscript claims come from raw CSV and artifact hashes. Keep clean-accuracy degradation and failed experiments. Baseline and no-augmentation ablation are one control alias; seed SD is not a confidence interval.
- Review-driven prose revision uses the same frozen measurements. Adaptive experiments after test exposure need a fresh independent evaluation protocol; repeating the same holdout does not create independent confirmation.
- Workflow completion, candidate-report quality, novelty, external review, submission and acceptance are distinct states. Submission bundles do not prove a paper was submitted or published. External publication requires a concrete target and user authorization.

If MCP is not connected, the same endpoints are documented in `docs/research-workbench.md`; use the API directly rather than asking the user to transfer results manually.
