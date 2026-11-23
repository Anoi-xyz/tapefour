// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract EvalMeasurer {
    function measureEval(address cpu, uint256 circuitId, bytes calldata inputs) external view returns (bool success, bytes memory result, uint256 gasUsed) {
        bytes memory data = abi.encodeWithSignature("eval(uint256,bytes)", circuitId, inputs);
        uint256 g0 = gasleft();
        (success, result) = cpu.staticcall{gas: 50000000}(data);
        uint256 g1 = gasleft();
        gasUsed = g0 - g1;
    }
}
