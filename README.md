# n8n-nodes-sether

An n8n community node that redacts PII with [Sether](https://www.npmjs.com/package/@raeven-co/sether) before text reaches an AI step, and checks the model's proposed tool call before any original value is put back.

One node, three operations:

| Operation | What it does |
| --- | --- |
| **Redact** | Replaces PII in the text fields you list with tokens such as `<EMAIL_4a2d72e8-...>`. Writes the redacted text to `redacted` and the token mapping to `_setherVault`. |
| **Restore** | Replaces tokens in one text field with the original values from the mapping. |
| **Validate Tool Call** | Checks tool-call arguments for unknown, altered, or missing tokens, and for fields that must hold a token. Restores only the fields you allow, and only if every check passes. |

Status: version 0.1.0, not published to npm. Built against `@raeven-co/sether` 0.7.0 (the current published version). See [Testing](#testing) for exactly what has and has not been verified.

## Why Validate Tool Call exists

1. Sether's restore replaces the tokens it issued and silently leaves every other token-shaped string in place.
2. A model that invents, alters, or drops a token therefore still produces arguments that "restore" without any error.
3. A prompt injection in the input can also make the model write a literal address where a token belongs; restore passes it straight through.
4. Validate Tool Call checks all of that first: every token-shaped string, the tokens that must be present, and the fields that may only hold an issued token.
5. Successful restoration alone is not permission to act.

## Wiring

The mapping contains the original PII. It must never be passed to an AI node. Reference it from the Redact node by name, after the AI step.

```
Trigger
  |
  v
Sether: Redact ("Redact PII")
  |   output: { redacted, _setherVault }
  v
AI step
  |   prompt uses only {{ $json.redacted }}
  |   output: a proposed tool call, e.g. { toolCall: { arguments: "{...}" } }
  v
Sether: Validate Tool Call   (On Violation = Route to Rejected Output)
  |   Tool Call Arguments = {{ $json.toolCall.arguments }}
  |   Mapping             = {{ $('Redact PII').item.json._setherVault }}
  |   Token-Only Fields   = to
  |   Restore Fields      = to, body
  |
  +-- Approved --> tool node (Send Email, HTTP Request, ...) using {{ $json.toolArgs }}
  |
  +-- Rejected --> human review
```

`examples/support-email-guardrail.json` is this workflow with a fictional support email and a Code node that stands in for the model, so it runs without model credentials. Set `SIMULATE_INJECTION = true` in that Code node to watch the call get routed to review.

This node sits in the main workflow path. It does **not** intercept tools that an n8n AI Agent node calls internally through tool sub-nodes. Use it where the model proposes an action as structured output and a regular node performs it afterwards.

## Install (local build)

The package is not on npm yet. Build it and install the tarball the way n8n documents [manual installation of community nodes](https://docs.n8n.io/integrations/community-nodes/installation/manual-install/):

```sh
cd n8n-nodes-sether
npm ci --ignore-scripts
npm run build
npm pack                      # writes n8n-nodes-sether-0.1.0.tgz; does not publish

mkdir -p ~/.n8n/nodes && cd ~/.n8n/nodes
npm install --ignore-scripts /absolute/path/to/n8n-nodes-sether-0.1.0.tgz
# restart n8n, then search the node panel for "Sether"
```

Self-hosted n8n only. The node depends on `@raeven-co/sether` at runtime, and n8n does not allow runtime dependencies in verified community nodes, so this package cannot be verified for n8n Cloud. For the same reason `package.json` sets `"n8n": { "strict": false }`.

## Operations

### Redact

| Parameter | Default | Notes |
| --- | --- | --- |
| Text Fields | `text` | Comma-separated paths, e.g. `text, email.body`. Only these fields are scanned. |
| Detector Packs | Basic | Basic: email, phone (international format), credit card (Luhn), SSN, IBAN (mod-97), IPv4, IPv6. Opt-in: Identity (label-anchored names, dates of birth, passports, addresses) and Secrets (vendor API keys, JWTs, labelled passwords, high-entropy strings). |
| Output Field | `redacted` | A string for one field; an object keyed by path for several. |
| Mapping Field | `_setherVault` | `{ "<TOKEN>": "original value" }`. Holds raw PII. |
| Options > Keep Source Fields | off | Off removes the original text fields, so the mapping is the only copy of the PII in the item. |
| Options > Phone Regions | empty | e.g. `US, GB, NG`. Adds national-format phone detection for those regions. Unsupported codes (for example `UK`, which should be `GB`) are rejected instead of silently matching nothing. |

Each item gets its own mapping. Binary data is not passed through.

### Restore

Restores tokens in **Text Field** (default `output`) into **Output Field** (default `restored`) using **Mapping** (default `{{ $json._setherVault }}`). **Unresolved Tokens** defaults to **Fail**: a token that is not in the mapping stops the node. Choose **Leave in Text** for Sether's own behaviour. Restore is for text shown to people. It is not a guardrail; put Validate Tool Call in front of anything that acts.

### Validate Tool Call

| Parameter | Default | Notes |
| --- | --- | --- |
| Tool Call Arguments | `{{ $json.toolCall.arguments }}` | A JSON string (as most model APIs return it) or an object. Must be a JSON object or array. |
| Mapping | (none) | `{{ $('Your Redact Node').item.json._setherVault }}` |
| Required Tokens | empty | Tokens that must appear, e.g. the customer's email token. An expression may return an array. |
| Token-Only Fields | empty | Paths whose whole value must be exactly one token issued in this run, e.g. `to`, `cc.*`. Blocks a model from writing its own recipient. |
| Restore Scope | Listed Fields Only | Or All String Fields. |
| Restore Fields | empty | Paths to restore. `*` matches any key or array index. Unlisted fields keep their tokens. |
| On Violation | Stop Workflow | Or Route to Rejected Output, which adds a second output. |
| Output Field | `toolArgs` | The restored arguments. |
| Output Format | Object | Or JSON String. |

Checks, all run before anything is restored:

| Violation | Meaning |
| --- | --- |
| `unknown_token` | A well-formed token that this run did not issue: invented, a changed character, a swapped type, or from another run. |
| `malformed_token` | Token-shaped text that is not a valid token: brackets stripped, type lowercased, closing `>` missing, truncated, or HTML-escaped. Altered copies of issued tokens are matched by their first eight hex digits. |
| `required_token_missing` | A required token is absent: the model dropped it. |
| `required_token_not_issued` | A required token is not in this run's mapping. |
| `token_only_field_invalid` | A token-only field holds anything other than exactly one issued token. |
| `token_only_field_missing` | A token-only field is absent. |

Object keys are scanned too, but never restored. Restoration works on parsed string values, not on the serialised JSON, so a restored value containing quotes or backslashes cannot break the JSON or inject keys (there is a test that shows the string-level approach doing both).

Approved item:

```json
{
  "toolArgs": { "to": "alice@example.com", "subject": "Your refund for order 1042" },
  "_setherValidation": { "approved": true, "restoredPaths": ["to"], "tokensSeen": ["<EMAIL_4a2d72e8-...>"] }
}
```

Rejected item (route mode): the input item plus `_setherValidation: { approved: false, violations: [...] }`. Violation messages name tokens and paths, never original values.

In Stop Workflow mode, avoid setting the node's **On Error** to "Continue (using regular output)": n8n would then pass an error item down the approved path. That item carries no arguments, but Route mode is the clearer choice. In Route mode with On Error set to continue, an item that fails for any reason goes to the Rejected output, never to Approved.

The node is deliberately not marked `usableAsTool`. An AI agent that could call Restore could read the original PII back.

## Limitations

- **Detection coverage is Sether's.** Anything Sether 0.7.0 does not detect reaches the model unchanged. That includes names, companies, and places in free text: there is no general named-entity recognition. The Identity pack only finds names next to a label (`Customer: Alice Example`); in Sether 0.7.0 it does not catch `my name is Alice Example`. National-format phone numbers are only found when Phone Regions is set.
- **Only listed fields are redacted.** Other fields in the item pass through as they are.
- **The mapping holds raw PII.** It travels in the n8n item and is stored in execution data wherever n8n saves it (the executions database, visible in the Executions view). Configure execution data saving and pruning accordingly, and keep the mapping out of any prompt.
- **Tokens are not secret.** They are random placeholders that let the model refer to values it cannot see. They do not authenticate anything.
- **Validation cannot judge intent.** An approved call uses only issued tokens in allowed places; whether the action itself is wise is still your workflow's decision.
- **Paths are dot-separated.** Keys that contain a dot cannot be addressed.
- **Not a compliance certification.** This reduces what reaches a model provider. It does not by itself make a workflow GDPR, HIPAA, or PCI DSS compliant.

## Testing

```sh
npm run typecheck   # tsc --noEmit, strict
npm run lint        # eslint with n8n's community-node rules + typescript-eslint strict
npm test            # vitest
npm run build
```

Run on Node 24.16.0. What the tests cover: the redact and restore round trip against the published Sether 0.7.0; unknown, altered, malformed, and dropped tokens; token-only fields; nested JSON with wildcard paths; JSON validity with quotes, backslashes, and newlines; the node's `execute()` for all three operations through a stand-in for n8n's execution context; parameter defaults and the dynamic Approved/Rejected outputs resolved with n8n-workflow's own `NodeHelpers`; and the example workflow's structure and both of its paths.

What has **not** been done: running the node inside a live n8n instance. Installing n8n pulls a large dependency tree, and its default SQLite driver downloads a native binary from GitHub during install, which is outside the npm-only, scripts-disabled install policy this project follows. Treat the [Install](#install-local-build) steps as following n8n's documentation rather than as verified.

## Development notes

- Dependencies are pinned to exact versions and the lockfile is committed. `.npmrc` sets `ignore-scripts=true`.
- `libphonenumber-js` is a direct dependency (the same version Sether resolves) only to validate phone regions with `isSupportedCountry`.
- The token grammar in `nodes/Sether/core/tokens.ts` mirrors Sether's internal `TOKEN_RE`, which 0.7.0 does not export. If Sether changes its token format, update it there.

## License

MIT. Copyright (c) 2026 Godfrey Lebo.
