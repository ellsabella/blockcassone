# Contracts Tests

Foundry tests will be added here as contracts are implemented.

Initial test coverage should focus on:

- Normie uniqueness.
- Source uniqueness.
- Slot uniqueness.
- Agentic / Agent ID metadata.
- Payload packing and hashing.
- Attestation verification.
- Fully self-contained `tokenURI` output.

Future world-state test coverage should include:

- street, neighbourhood, and region derivation.
- environment assignment.
- population counter updates on mint and movement.
- agentic population caps.
- movement to vacant plots.
- rejection of movement to occupied or disallowed plots.
- consolidation eligibility for full-neighbourhood ownership.
- burn/merge accounting for consolidated neighbourhoods.
