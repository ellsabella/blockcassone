// Event ABI items the indexer decodes. Kept in one place so extending the decode
// layer (e.g. after a cube/biome rework changes the schema) is a localized edit.
//
// v1 covers the mutable per-cube record; all four live on the CubeNFT address:
//   CubeMinted     — creates the record (slot, source, seed, agentic, owner)
//   Transfer       — current owner (and burn = transfer to 0x0, e.g. merge)
//   CubeMoved      — slot mutation
//   CubeCustomized — re-base (new source + payload version)
//
// Deferred to later milestones (kept here as a to-do, not yet folded):
//   AgentStatusRegistry.AgentBindingUpdated — live agentic status
//   CubeMintController.CubeCustomizedWithPayload / NonNormie... — payloadHash → art
import { parseAbiItem } from 'viem';

export const CUBE_MINTED = parseAbiItem(
  'event CubeMinted(uint256 indexed cubeId, address indexed minter, uint32 indexed slot, uint8 sourceKind, address sourceContract, uint256 sourceTokenId, bool agentic, uint256 agentId, bytes32 seed)'
);
export const CUBE_MOVED = parseAbiItem(
  'event CubeMoved(uint256 indexed cubeId, uint32 indexed fromSlot, uint32 indexed toSlot, address owner)'
);
export const CUBE_CUSTOMIZED = parseAbiItem(
  'event CubeCustomized(uint256 indexed cubeId, address indexed sourceContract, uint256 sourceTokenId, uint8 payloadVersion)'
);
export const TRANSFER = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
);

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
