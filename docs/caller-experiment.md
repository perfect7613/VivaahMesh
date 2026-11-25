# Caller-prompt experiment (Flagsmith `caller_prompt`)

> Demo comparison on 5 scripted scenarios, not a statistical claim. Reproduce: `cd web && npm run experiment`.

| Variant | Runs | Correct cutoff | Unsupported change | Unresolved | Redundant questions | Failed scenarios |
|---|---|---|---|---|---|---|
| `baseline` | 5 | 1 | 0 | 4 | 2 | clear, correction, vague |
| `clarify_scope` | 5 | 4 | 0 | 1 | 0 | none |

| Scenario | Variant | Confirmed | Correct | Redundant Qs | Downstream schedule |
|---|---|---|---|---|---|
| clear | baseline | — | open | 0 | blocked (1) |
| clear | clarify_scope | 10:00 pm | ✓ | 0 | cutoff 10:00 pm → 0 option(s), 3 conflict(s) |
| correction | baseline | — | open | 0 | blocked (1) |
| correction | clarify_scope | 10:30 pm | ✓ | 0 | cutoff 10:30 pm → 0 option(s), 2 conflict(s) |
| scope | baseline | 10:00 pm | ✓ | 1 | cutoff 10:00 pm → 0 option(s), 3 conflict(s) |
| scope | clarify_scope | 10:00 pm | ✓ | 0 | cutoff 10:00 pm → 0 option(s), 3 conflict(s) |
| unknown | baseline | — | open | 0 | blocked (1) |
| unknown | clarify_scope | — | open | 0 | blocked (1) |
| vague | baseline | — | open | 1 | blocked (1) |
| vague | clarify_scope | 10:30 pm | ✓ | 0 | cutoff 10:30 pm → 0 option(s), 2 conflict(s) |

The unknown scenario has no true cutoff, so leaving it open is the right outcome.
