// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MultiEval {
    function evalBatch(address cpu, uint256 circuitId, bytes[] calldata inputs) external view returns (bytes[] memory results) {
        results = new bytes[](inputs.length);
        for (uint i = 0; i < inputs.length; i++) {
            (bool ok, bytes memory ret) = cpu.staticcall{gas: 50_000_000}(
                abi.encodeWithSignature("eval(uint256,bytes)", circuitId, inputs[i])
            );
            require(ok, "eval failed");
            results[i] = abi.decode(ret, (bytes));
        }
    }
}
