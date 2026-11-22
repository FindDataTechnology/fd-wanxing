# Spec Delta

## MODIFIED Requirements

### Requirement: A loader script mounts a line's copilot in one tag

wanxing-web SHALL serve a self-hosted loader script that a product-line page mounts with a single tag naming the line (`data-line`), with no protocol code written by the host. The loader SHALL resolve that line's binding before mounting, create the widget iframe itself, run the entire host protocol on the host's behalf (handshake, page-context pushes, per-turn identity relay, intent dispatch), and expose optional declarative hooks: an identity provider, a context provider, and an intent handler map. A host that supplies none SHALL still get a working widget on whatever visitor tier the binding permits.

The loader SHALL NOT mount the widget when the resolution answers unbound, unknown, paused, or closed, and SHALL report the reason once in the console instead of injecting a dead surface. The iframe source and behavior SHALL remain obtainable directly (the existing embed view URL), so the loader is a host-side convenience, never a new admission path.

The widget's first-paint state SHALL be collapsed unless the host explicitly asks for expanded: the loader SHALL expand the widget on mount only when the tag carries `data-open="1"`, and SHALL mount it collapsed (launcher only) for every other value and for an absent attribute. Expanding on first paint is therefore an opt-in the host states, never a default it has to remember to suppress.

#### Scenario: One tag mounts a working copilot

- **WHEN** a page includes the loader tag for a line bound to a ready agent and supplies no hooks
- **THEN** the widget mounts and a visitor message runs a turn on the tier the binding's effective policy permits

#### Scenario: No binding means no widget

- **WHEN** the loader tag names an unbound, unknown, paused, or closed line
- **THEN** nothing is injected into the page and one console message names the reason

#### Scenario: Host hooks replace host-written protocol

- **WHEN** the page supplies an identity provider before the first turn
- **THEN** the loader relays the token per turn without the host writing any postMessage code, and the widget prefers it over the anonymous tier

#### Scenario: Declared intents are the only executable ones

- **WHEN** the page supplies an intent handler for a verb the loader declares at handshake
- **THEN** only that verb executes against the handler and every other verb is answered as unsupported

#### Scenario: The direct embed URL keeps working

- **WHEN** a page embeds the existing embed view URL directly, without the loader
- **THEN** the widget behaves exactly as before the loader existed

#### Scenario: An omitted open flag mounts collapsed

- **WHEN** a host page mounts the loader tag with `data-line` and no `data-open` attribute
- **THEN** the widget mounts collapsed — the iframe is launcher-sized and its source carries no expand parameter — and the visitor expands it by clicking the launcher

#### Scenario: Expansion stays an explicit host choice

- **WHEN** a host page mounts the loader tag with `data-open="1"`
- **THEN** the widget mounts expanded, so a surface that is itself the conversation (a signed-in console) keeps its existing first-paint behavior
