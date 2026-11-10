# wanxing-web Specification (delta)

## ADDED Requirements

### Requirement: No traffic and should-have-run are distinct on every health surface

Wherever a deployment's health is shown, a `silent` deployment whose declared rhythm implies turns
SHALL read as "should have run and did not", naming the implied count, and SHALL NOT read as "no
traffic". A `silent` deployment with no rhythm declaration SHALL keep reading as "no traffic" with
the same wording as before this requirement. Stalled deployments SHALL sort above plain silent ones
within the view's ordering.

#### Scenario: A stalled deployment says it should have run

- **WHEN** a deployment reports silent with an implied turn count reaching the minimum
- **THEN** its marker names that it should have run, with the implied count, instead of "no traffic"

#### Scenario: A non-rhythmic deployment keeps its wording

- **WHEN** a deployment reports silent with no implied count
- **THEN** its marker reads "no traffic" exactly as it did before this requirement

#### Scenario: Stalled sorts above merely silent

- **WHEN** a view lists both a stalled deployment and a merely silent one
- **THEN** the stalled one appears first

#### Scenario: An older observer's entries still render

- **WHEN** the health section omits the implied count and staleness fields entirely
- **THEN** every deployment renders with the pre-existing wording and no crash
