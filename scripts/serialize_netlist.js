#!/usr/bin/env node
// scripts/serialize_netlist.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildConnectFourCircuit } from '../circuit/circuit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { builder, gateCount } = buildConnectFourCircuit();
const netlist = builder.serialize();

const outPath = path.join(__dirname, 'c4_netlist.bin');
fs.writeFileSync(outPath, netlist);

console.log(`✓ Wrote ${netlist.length} bytes (${gateCount} NAND gates) to ${outPath}`);
console.log(`  Gate count: ${gateCount}`);
console.log(`  Input bits: 88`);
console.log(`  Output bits: 87`);
