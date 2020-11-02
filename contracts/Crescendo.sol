import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "./interfaces/ITreasury.sol";

import "hardhat/console.sol";

struct OpInfo {
    uint128 fee;
    uint128 lastTime;
}

abstract contract Crescendo is Ownable {

    uint256 constant TREASURY_TARGET_PERIOD = 7 * 24 * 60 * 60; // 1 week

    uint256 constant EXEC_GAS_OVERHEAD = 21000 + // txn cost
        6000; // update for owed money amount

    address public treasury;

    // amount of money that should be in the treasury
    uint128 public targetTreasuryBalance;

    // number of seconds between trade execution events
    uint32 public targetInterval;

    mapping(uint16 => OpInfo) public opInfo;

    mapping(address => uint256) public owedMoney;
    uint256 totalOwedMoney;

    function updateFee(uint16 pair) internal {
        console.log("owed money", totalOwedMoney);
        uint currentTreasuryBalance = SafeMath.sub(ITreasury(treasury).getTreasuryBalance(), totalOwedMoney);
        uint newFee = SafeMath.mul(opInfo[pair].fee, uint256(targetTreasuryBalance)) / currentTreasuryBalance;

        opInfo[pair] = OpInfo(uint128(newFee), uint128(block.timestamp));
    }

    function exec(uint16 pair, address[] calldata addrs) public {
        uint256 startGas = gasleft();

        uint256 batchSize = execInternal(pair, addrs);

        uint256 reward = getReward(pair, batchSize);

        // update fee
        updateFee(pair);

        // last but not least, set owed money
        uint256 spd = SafeMath.mul(reward, SafeMath.add(EXEC_GAS_OVERHEAD, startGas - gasleft()));
        owedMoney[msg.sender] = SafeMath.add(owedMoney[msg.sender], spd);
        totalOwedMoney = SafeMath.add(totalOwedMoney, spd);
    }

    function claim(address addr) public {
        uint256 amt = owedMoney[addr];
        require(amt > 0);

        owedMoney[addr] = 0;
        totalOwedMoney = SafeMath.sub(totalOwedMoney, amt);

        ITreasury(treasury).withdraw(ITreasury(treasury).getTreasuryToken(), addr, amt);
    }

    function execInternal(uint16 pair, address[] calldata addrs) internal virtual returns (uint256);
    function getReward(uint16 pair, uint count) public view virtual returns (uint256);
}