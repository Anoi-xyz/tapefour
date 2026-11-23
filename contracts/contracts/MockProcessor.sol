// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockProcessor
 * @notice Test double for the TapeOut processor.  Returns a preset byte
 *         response for every eval() call, so tests can control circuit output
 *         without deploying the real TapeOut infrastructure.
 */
contract MockProcessor {
    bytes private _response;

    /// Set the bytes that eval() will return on the next call.
    function setResponse(bytes calldata resp) external {
        _response = resp;
    }

    /// Mimics IProcessor.eval(uint256,bytes) → returns the preset response.
    function eval(uint256 /*circuitId*/, bytes calldata /*inputs*/)
        external view returns (bytes memory)
    {
        return _response;
    }
}
