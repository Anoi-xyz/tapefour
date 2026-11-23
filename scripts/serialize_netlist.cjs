#!/usr/bin/env node
// scripts/serialize_netlist.cjs
// Generates the binary TAP-02 netlist from the TypeScript circuit builder
// and writes it to scripts/c4_netlist.bin  (committed to repo).
//
// This script bridges the ESM TypeScript codebase into CJS for Hardhat.
// Run:  node scripts/serialize_netlist.cjs

"use strict";

const fs   = require("fs");
const path = require("path");
const { createRequire } = require("module");

// We use Node's ESM loader via dynamic import (works in Node 24+)
async function main() {
  // Dynamic import of the ESM TypeScript circuit module
  const circuitUrl = new URL("../circuit/circuit.ts", import.meta.url ?? `file://${__filename}`);

  let buildConnectFourCircuit;
  try {
    // Node 22+ can strip TypeScript types directly
    const mod = await import(circuitUrl.href);
    buildConnectFourCircuit = mod.buildConnectFourCircuit;
  } catch (e) {
    // Fallback: try .js extension if someone transpiled
    const jsPath = circuitUrl.href.replace(/\.ts$/, ".js");
    const mod = await import(jsPath);
    buildConnectFourCircuit = mod.buildConnectFourCircuit;
  }

  const { builder, gateCount } = buildConnectFourCircuit();
  const netlist = builder.serialize();

  const outPath = path.join(__dirname, "c4_netlist.bin");
  fs.writeFileSync(outPath, netlist);

  console.log(`✓ Wrote ${netlist.length} bytes (${gateCount} gates) to ${outPath}`);
  console.log(`  Gate count: ${gateCount} NAND gates`);
  console.log(`  Input bits: 88`);
  console.log(`  Output bits: 87`);
}

main().catch(err => {
  console.error("Error generating netlist:", err);
  process.exit(1);
});
