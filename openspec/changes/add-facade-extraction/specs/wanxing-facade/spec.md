# wanxing-facade Specification Delta

## ADDED Requirements

### Requirement: The facade runs as an independent Wanxing-plane deployment unit

The facade SHALL run as its own process/image (no Yizuo-gateway mounting), exposing its public routes at the Wanxing domain and a `/healthz` liveness endpoint. Its configuration SHALL be env-only with the same names as the gateway-mounted era (`SUB2API_BASE_URL`, `SUB2API_ADMIN_KEY`, `AGENT_SERVING_REGISTRY_URL`, `AGENT_SERVING_REGISTRY_TOKEN`, `AGENT_SERVING_BACKEND_TOKEN`, `PACKS_INTERNAL_BASE_URL`, `FLEET_OBSERVER_URL`, `FLEET_OBSERVER_TOKEN`), so deployment values move over mechanically. Sibling-plane access (Qianmian registry and packs internal API, sub2api) SHALL be HTTP-only via those envs. Login-scoped management routes (the caller-allowlist trio) SHALL be absent from this unit — the deployer product surface rebuilds them (slice ⑤); the allowlist store and admission checks remain.

#### Scenario: standalone boot serves the public face

- **WHEN** the facade image starts with its env set and receives an unauthenticated catalog request at its own origin
- **THEN** public agents are listed and `/healthz` answers ok, with no Yizuo gateway in the path

#### Scenario: ops usage view admits the service credential only

- **WHEN** the ops usage endpoint receives a request bearing the fleet service credential (no user session exists in this unit)
- **THEN** it answers; a request without the credential is refused
