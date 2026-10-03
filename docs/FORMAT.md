# Session log format contract

This plugin reads DSH session logs **directly from disk** rather than through
`ctx.sessionQuery`. That buys independence from the plugin compatibility gate,
but it means the storage format is our risk to own. This document is that risk,
written down.

Everything here was derived by inspecting real session logs. It is not official
documentation and DSH does not guarantee any of it.

## Where logs live

```
$DSH_HOME/sessions/<project-slug>/<session-id>/session[.vN].jsonl.zstd
```

One directory per session. The same directory may hold several **generations**
of the same session (`session.jsonl.zstd` for the original v0 log, then
`session.v3.jsonl.zstd`, `session.v4.jsonl.zstd` as migrations run). We always
read the **highest generation present** — see `listSessions()` in
`src/session.js`.

## Logs are concatenated zstd frames

A log is **not one zstd stream**. DSH appends one complete frame per flush, so a
long session holds hundreds of them. Measured on a real session:

| file size | frames | `zstdDecompressSync(buf)` | every frame |
|---|---|---|---|
| 1.6 MB | 1074 | 192 chars | 5,356,237 chars |

Decoding only the first frame yields the session header and **0.004%** of the
content, silently. Node's streaming API does not help — it throws
`Unknown frame descriptor` on the second frame.

`decompressZstdAll()` in `src/session.js` locates frame boundaries by scanning
for the zstd magic (`28 B5 2F FD`) and decompresses each frame separately,
extending the boundary when a candidate slice fails to decode.

**Any code that touches these files must go through that function.**

## The event shapes we depend on

After the header line (`{"type":"session","version":N,"id":…,"cwd":…}`), each
line is one event with `type`, `seq`, `time`, and a `data` payload.

These three shapes carry the conversation. They are the entire surface we rely
on:

### 1. Human messages

```json
{
  "type": "user/message",
  "seq": 8,
  "data": {
    "role": "user",
    "content": [{ "type": "text", "text": "…" }],
    "source": { "kind": "user" }
  }
}
```

**`data.source.kind === "user"` is the only indicator of a real human turn.**
Other kinds are machine-injected and are excluded by default:

| `source.kind` | meaning |
|---|---|
| `user` | the human typed it |
| `runtime-context` | per-turn environment snapshot injected by the host |
| `skill-catalog` | available-skills listing |
| `tool-jobs` | background-job notifications |

### 2. Assistant messages

```json
{
  "type": "assistant/message",
  "data": {
    "turn": 1,
    "step": 1,
    "message": {
      "role": "assistant",
      "content": [
        { "type": "reasoning", "text": "…" },
        { "type": "text", "text": "…" },
        { "type": "tool-call", "id": "call_…", "name": "bash", "arguments": "{…}" }
      ]
    }
  }
}
```

Content arrives as blocks. `text` is the answer, `reasoning` is thinking
(opt-in), `tool-call` is a request (opt-in, and the source of the call id used
to match results).

### 3. Tool results

```json
{
  "type": "tool/result",
  "data": {
    "message": {
      "role": "tool",
      "toolCallId": "call_…",
      "isError": false,
      "content": [{ "type": "text", "text": "…" }]
    }
  }
}
```

## Everything else is optional

These are used when present, and their absence is fine:
`session/title` (the conversation name), `request/header` (the model, at
`data.header.config.model`), `turn/end` (abort detection).

**Any event type not listed above is ignored.** That is deliberate: a future
format that *adds* events keeps working. A format that *changes* one of the
three shapes above will not.

## Failure policy

| condition | behaviour |
|---|---|
| unknown event type | ignored |
| unparsable JSON line | skipped |
| no `{type:"session"}` header in any frame | hard error, surfaced as HTTP 500 |
| header `version` < 3 (chunk-row layouts) | warning to stderr; export attempted and marked incomplete |

We do not refuse a log because of its version number. The v0–v2 layouts carried
message content in chunk rows (`text-chunks`, `reasoning-chunks`,
`tool-call-chunks`, `assistant/chunk`) which no longer exist, so a v0 log
exports as structure without content — but a *partially* readable transcript
beats an exception.

## Adding support for a new format

1. Capture a real log of the new format into `test/fixtures.mjs`-style synthetic
   events (do not commit real session data).
2. Add the events to `v4Events()` or add a sibling function.
3. Assert the new shape in `test/render.test.mjs` — including that the old
   shapes still work, since both must be supported at once.
4. If the new format changes one of the three shapes above, handle both in
   `buildTurns()` (`src/render.js`) and keep the old branch.

## Why `sessionQuery` is not used

`ctx.sessionQuery` is the sanctioned seam and DSH maintains it across format
versions. Using it would remove this entire document. The trade is explicit:
going through the seam means following DSH's release train and its plugin
compatibility gate, which is what makes sibling export plugins fail on a new
DSH minor. Reading files means owning the format. Both are defensible; this
project picked the second and wrote the risk down here.
