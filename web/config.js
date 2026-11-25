// web/config.js
// TapeFour Web Application Configuration
// Single source of truth for contract addresses, chain configuration, and game parameters.

window.TAPEFOUR_CONFIG = {
  // Toggle to true once deployed on X Layer
  rankedEnabled: true,

  // Network configuration
  networkName: 'X Layer',
  chainId: 196,
  rpcUrl: 'https://rpc.xlayer.tech',
  explorerBase: 'https://www.oklink.com/xlayer/tx/',

  // TapeOut Circuit & Processor
  processorAddress: '0xc849714d70A5c1bE8A456C47c644fe90D5B1625C',
  circuitId: 1,
  gateCount: 1479,

  // TapeFour Ranked Game Contract (Deployed on X Layer Mainnet)
  contractAddress: '0x1c319c3bcb9ed1c35507f029c8e7152ab0590c04',

  // Game Economy & Timing Parameters
  rankedFee: '0.005', // 0.005 OKB
  rankedFeeWei: '5000000000000000',
  poolSharePct: 60,   // 60% to weekly prize pool
  treasurySharePct: 40, // 40% to project treasury
  moveTimeoutSec: 86400, // 24 hours
  botTimeoutSec: 600,    // 10 minutes (600 seconds)

  // Gas estimates
  startRankedGas: 300000,
  timeoutRefundGas: 200000,
  estimatedMoveGas: 3450000,
  estimatedGameGas: 52000000,
};
