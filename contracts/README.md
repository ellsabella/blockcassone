# Blockcassone Contracts

This folder contains the Foundry Solidity project. It is intentionally separate from the existing JavaScript renderer and viewer pipeline.

Planned layout:

```text
contracts/
  src/      Solidity contracts
  test/     Foundry tests
  script/   Deployment and maintenance scripts
  lib/      Foundry dependencies
  out/      Build output, ignored
  cache/    Foundry cache, ignored
```

The current dev pipeline remains the source for visual experimentation. Production contracts will be added one by one under `contracts/src`.
