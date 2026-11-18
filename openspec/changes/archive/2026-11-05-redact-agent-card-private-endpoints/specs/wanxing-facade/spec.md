# Spec delta: wanxing-facade (fd-wanxing)

## ADDED Requirements

### Requirement: Public agent cards redact non-public provider endpoints

The facade SHALL serialize `provider` in public agent cards through a
redactor: when `provider.url` denotes a non-publicly-routable address
(RFC1918 private ranges, CGNAT 10.0.0.0/10, loopback, link-local,
`0.0.0.0`, single-label hostnames, or cluster-internal suffixes `.svc`,
`.cluster.local`, `.local`, `.internal`) or cannot be parsed as a URL, the
card MUST omit the `url` key from `provider`. Publicly-routable provider
URLs and all other provider fields (e.g. `organization`) MUST be preserved
unchanged. Absent-provider fallback MUST keep its current shape. The
redaction applies at the serialization boundary only; the underlying
deploy entry / registry snapshot MUST NOT be rewritten by this path.

#### Scenario: internal runner address is stripped from the public card

WHEN a deployed agent's entry carries `provider.url` pointing at a tailnet or other private address (e.g. `http://10.0.0.10`)
THEN `GET /.well-known/agent-card.json` returns a provider object without a `url` key, `organization` and other fields intact

#### Scenario: public provider URL passes through verbatim

WHEN `provider.url` is a publicly-routable address (e.g. `https://mcp.finddatatech.cloud`)
THEN the agent card includes that `url` unchanged

#### Scenario: unparseable URL fails closed

WHEN `provider.url` is present but not parseable as a URL
THEN the agent card omits the `url` key
