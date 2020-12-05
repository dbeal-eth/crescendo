import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
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

    event NewAuthorizedOp(uint16 id, address token0, address token1, address token2);

    function updateFee(uint16 pair) internal {
        uint currentTreasuryBalance = SafeMath.sub(ITreasury(treasury).getTreasuryBalance(), totalOwedMoney);
        uint newFee = SafeMath.mul(opInfo[pair].fee, uint256(targetTreasuryBalance)) / currentTreasuryBalance;

        opInfo[pair] = OpInfo(uint128(newFee), uint128(block.timestamp));
    }

    function exec(uint16 pair, address[] calldata addrs) public {
        uint256 startGas = gasleft();

        uint256 reward;
        if(addrs.length > 0) {
            uint256 batchSize = execInternal(pair, addrs);
            reward = getReward(pair, batchSize);
        } else {
            reward = getReward(pair, 0);
        }

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

    // supply additional funds to the treasury in case it runs out of money
    // this is an escape hatch and should not normally ever need to be called
    function fill(uint256 amt) public {
        address tok = ITreasury(treasury).getTreasuryToken();

        IERC20(tok).transferFrom(msg.sender, address(this), amt);
        IERC20(tok).approve(treasury, type(uint256).max);
        ITreasury(treasury).deposit(tok, address(this), amt);
    }

    // used to implement logic of the batched transactions
    function execInternal(uint16 pair, address[] calldata addrs) internal virtual returns (uint256);

    // used to get the op ID for an operation approved in execInternal. Should return >1 for any valid operation ID
    function calculateOpId(uint256 amt) public pure virtual returns (uint16);

    // used to check the value of the operation which has ben approved in execInternal. Should return >0 for any valid approval which should be processed, 0 otherwise
    function calculateApproveValue(address addr, uint16 pair, address payer) public view virtual returns (uint256);

    // used by bot and this abstract contract to determine payout value at current block
    function getReward(uint16 pair, uint count) public view virtual returns (uint256);
}