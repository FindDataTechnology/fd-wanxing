## ADDED Requirements

### Requirement: Deployment memory proxies the fleet visibility lane under the owner gate

The console SHALL expose per-deployment memory faces that proxy fd-memory's platform-seam visibility lane: `GET /api/wanxing/v1/console/deployments/:slug/memory` (query: `layer` L0|L1|L2, `scope` project name, `since`/`until`, `limit`/`offset`) forwards to the fleet memory `GET /memory` with `rootKey=d-<packId>` resolved from the deployment's bookkeeping row; `POST /api/wanxing/v1/console/deployments/:slug/memory/forget` accepts `{ path, confirm }` and forwards to `POST /forget` with the same rootKey. Both faces SHALL sit behind the same owner gate as pause/resume (deployer-of-record or ops credential), and the forwarded rootKey MUST derive from that verified row — a caller MUST NOT be able to name an arbitrary root. The lane SHALL exist only when the fleet-memory platform seam is configured (`FD_MEMORY_URL` + `FD_MEMORY_PLATFORM_TOKEN`); unconfigured deployments respond 503 with a stable code, and fleet-memory unreachability degrades visibly (503 naming the lane), never as an empty list.

#### Scenario: deployer reads own deployment memory

- **WHEN** the deployer of record requests their deployment's memory with `layer=L2`
- **THEN** the facade forwards with `rootKey=d-<packId>` of that deployment and returns the fleet memory items verbatim

#### Scenario: non-deployer is refused before any forward

- **WHEN** a verified identity that did not deploy the slug requests its memory
- **THEN** the owner gate refuses 403 and no fleet-memory call is made

#### Scenario: unconfigured or unreachable lane degrades visibly

- **WHEN** the fleet-memory seam is unconfigured, or fleet-memory is unreachable
- **THEN** the proxy responds 503 with a stable error code (never an empty list), and the console renders an explicit degraded state
