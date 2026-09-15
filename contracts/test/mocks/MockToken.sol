// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev ERC-20 test token with an opt-in post-transfer callback for reentrancy tests.
contract MockToken is ERC20 {
    address public callbackTarget;
    bytes public callbackData;
    bool public callbackEnabled;
    bool private _inCallback;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        _burn(from, amount);
    }

    function setCallback(address target, bytes calldata data, bool enabled) external {
        callbackTarget = target;
        callbackData = data;
        callbackEnabled = enabled;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (callbackEnabled && !_inCallback && callbackTarget != address(0)) {
            _inCallback = true;
            (bool ok, bytes memory reason) = callbackTarget.call(callbackData);
            _inCallback = false;
            if (!ok) {
                assembly ("memory-safe") { revert(add(reason, 32), mload(reason)) }
            }
        }
    }
}
