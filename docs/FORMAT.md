# Session log format contract

This plugin reads DSH session logs from disk. The storage format is an internal
DSH interface; the shapes below have been verified with v0, v3 and v4 logs.
v1 and v2 have not been independently verified.

## Location and generation selection

```text
$DSH_HOME/sessions/<project-slug>/<session-id>/session[.vN].jsonl[.zstd]
```

`DSH_HOME` defaults to `~/.dsh`. A session directory can contain several log
generations. `listSessions()` selects the highest generation; an unnumbered
`session.jsonl` or `session.jsonl.zstd` is generation 0. Modification time breaks
ties within the same generation. A malformed latest generation does not cause a
fallback to an older file.

`findSessionFile()` accepts word characters and hyphens, prefers an exact session
directory name, then accepts a partial match. The HTTP handler additionally
requires the log header's id to equal the requested session id.

## Compression and JSONL

DSH appends complete Zstandard frames, so a compressed log can contain multiple
concatenated frames. All compressed input must pass through
`decompressZstdAll()` in `src/session.js`.

The decoder checks frame headers, block boundaries, skippable-frame payloads and
optional checksum lengths against the
[Zstandard layout](https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md).
It decompresses each complete frame with `zstdDecompressSync(input, { info: true })`
and verifies `engine.bytesWritten`. Structural validation is necessary because
Node 22 and early Node 24 can accept incomplete compressed input. Payload magic
bytes do not delimit frames. Corruption, truncation and trailing garbage fail the
whole export.

The minimum runtime is Node 22.15, which provides `node:zlib`'s Zstandard API.
A namespace import permits an explicit capability error on unsupported runtimes.

After decompression, the first `type: "session"` row is the header:

```json
{"type":"session","version":4,"id":"session-example","createdAt":1790000000000,"cwd":"/tmp/example"}
```

Subsequent JSONL rows are events with a `type` and `data`; `seq` and `time` are
not needed for rendering. Events are processed in file order.

## Conversation events

### Human messages

```json
{
  "type": "user/message",
  "data": {
    "role": "user",
    "content": [{"type":"text","text":"…"}],
    "source": {"kind":"user"}
  }
}
```

`data.source.kind === "user"` starts a human turn. Other kinds, including
`runtime-context`, `skill-catalog` and `tool-jobs`, are injected messages and are
excluded unless `injected` is enabled.

### Assistant messages

```json
{
  "type": "assistant/message",
  "data": {
    "message": {
      "role": "assistant",
      "content": [
        {"type":"reasoning","text":"…"},
        {"type":"text","text":"…"},
        {"type":"tool-call","id":"call_example","name":"bash","arguments":"{…}"}
      ]
    }
  }
}
```

Text is included by default; reasoning and tool records are opt-in. Tool names
are recorded regardless of the `tools` option because `web_search` and `web_fetch`
results also supply references.

### Tool results

The flattened shape, verified with v4, stores the id and error flag on the message:

```json
{
  "type": "tool/result",
  "data": {
    "message": {
      "role": "tool",
      "toolCallId": "call_example",
      "isError": false,
      "content": [{"type":"text","text":"…"}]
    }
  }
}
```

The wrapped shape, verified with v0 and v3, stores them in a `tool-result` block:

```json
{
  "type": "tool/result",
  "data": {
    "message": {
      "role": "user",
      "source": {"kind":"tool","callId":"call_example"},
      "content": [{
        "type": "tool-result",
        "toolCallId": "call_example",
        "isError": false,
        "content": [{"type":"text","text":"…"}]
      }]
    }
  }
}
```

Call-id precedence is `message.toolCallId`, the first wrapper's `toolCallId`,
`message.source.callId`, then `data.toolCallId`. The body comes from wrapper
content when present, otherwise message content. A message-level `isError` takes
precedence over wrapper flags. Call lookup persists across turns to match delayed
results. Unmatched results are retained when tool records are enabled.

### Optional events

| event | data used |
|---|---|
| `session/title` | latest non-empty `data.title` |
| `request/header` | first `data.header.config.model`, with optional `provider` |
| `system/message` | `data.message.content`, when `system` is enabled |
| `turn/end` | `data.reason.kind === "aborted"` |

Streaming rows (`text-chunks`, `reasoning-chunks`, `tool-call-chunks`,
`assistant/chunk`) are ignored to avoid duplicating finalized messages. Content
interrupted before its finalized message was written is not exported.

## Failure policy

| condition | behavior |
|---|---|
| unknown event type or unsupported content block | ignored |
| malformed JSON line | skipped |
| corrupt/truncated compressed frame or trailing garbage | hard error; retry if the log is being written |
| missing session header | HTTP/CLI error |
| header id differs from HTTP session id | HTTP 500 |
| unrecognized version number | no version gate; parse supported row shapes |

An unrecognized event shape may be omitted even when the overall export succeeds.
Version numbers alone do not establish compatibility.

## Extending the contract

1. Represent the new shape as synthetic events in `test/fixtures.mjs`; do not
   commit real session data.
2. Add rendering assertions for that shape and retain coverage of existing ones.
3. Update `buildTurns()` to accept the new shape alongside existing shapes.
4. For storage changes, extend session-decoding and HTTP tests, then update this
   contract and the verified compatibility range.
