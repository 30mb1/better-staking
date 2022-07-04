pragma solidity =0.8.6;


import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./Manageable.sol";


contract BetterStaking is Manageable {
    using SafeERC20 for IERC20;

    // Info of each user.
    struct UserInfo {
        uint256 amount;     // How many deposit tokens the user has provided.
        uint256 rewardDebt; // Reward debt. See explanation below.
        uint256 vested;
        uint256 released;
    }

    // Info of each pool.
    struct PoolInfo {
        IERC20 depositToken;           // Address of deposit token contract
        IERC20 rewardToken;            // Address of reward token contract
        uint256 depositedAmount;         // number of deposited tokens
        uint256 accRewardPerShare; // Accumulated reward per share, times 1e12. See below.
        uint256 rewardTokenPerSecond;
        uint256 rewardTokensToDistribute; // overall sum of reward tokens to distribute across users
        uint256 unclaimedRewardTokens; // reward tokens that could be claimed by admins, because no users pretend to claim it
        uint32 lastRewardTime;  // Last block timestamp that tokens distribution occurs.
        uint32 start; // timestamp when farming starts
        uint32 duration; // duration of farming after start
        uint32 lockTime;
        uint32 vestingStart;
        uint32 vestingDuration;
    }

    // amount of deposited tokens that cannot be withdrawn by admins
    // we need this because 1 token could be used as a reward and deposit at the same time
    mapping (address => uint256) public depositedTokens;
    // amount of reward tokens that cannot be withdrawn by admins
    mapping (address => uint256) public rewardTokens;
    // Info of each pool.
    PoolInfo[] public poolInfo;
    // Info of each user that stakes deposit tokens.
    mapping (uint256 => mapping (address => UserInfo)) public userInfo;
    uint256 constant PRECISION_MULTIPLIER = 1e12;

    event Reward(address indexed user, uint256 indexed pid, uint256 amount);
    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event WithdrawUnclaimed(uint256 amount);
    event NewPool(IERC20 depositToken, IERC20 rewardToken, uint256 rewardTokensToDistribute, uint32 start, uint32 duration, uint32 lockTime);

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    // Add a new lp to the pool. Can only be called by the staking manager.
    function add(
        uint256 _rewardTokensToDistribute,
        IERC20 _depositToken,
        IERC20 _rewardToken,
        uint32 _start,
        uint32 _duration,
        uint32 _lockTime,
        uint32 _vestingStart,
        uint32 _vestingDuration
    ) public onlyStakingManager {
        uint32 lastRewardTime = uint32(block.timestamp) > _start ? uint32(block.timestamp) : _start;
        uint256 rewardTokenPerSecond = _rewardTokensToDistribute / _duration;
        poolInfo.push(PoolInfo({
            depositToken: _depositToken,
            rewardToken: _rewardToken,
            rewardTokensToDistribute: _rewardTokensToDistribute,
            rewardTokenPerSecond: rewardTokenPerSecond,
            lastRewardTime: lastRewardTime,
            depositedAmount: 0,
            accRewardPerShare: 0,
            unclaimedRewardTokens: 0,
            start: _start,
            duration: _duration,
            lockTime: _lockTime,
            vestingStart: _vestingStart,
            vestingDuration: _vestingDuration
        }));

        _rewardToken.safeTransferFrom(_msgSender(), address(this), _rewardTokensToDistribute);
        rewardTokens[address(_rewardToken)] += _rewardTokensToDistribute;

        emit NewPool(_depositToken, _rewardToken, _rewardTokensToDistribute, _start, _duration, _lockTime);
    }

    // Return reward multiplier over the given _from to _to block.
    function getMultiplier(uint256 _from, uint256 _to) public pure returns (uint256) {
        return _to - _from;
    }

    // Update reward variables of the given pool to be up-to-date.
    function updatePool(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        // pool was updated on this block already or farming not started
        if (uint32(block.timestamp) <= pool.lastRewardTime) {
            return;
        }
        uint256 multiplier = getMultiplier(pool.lastRewardTime, uint32(block.timestamp));
        uint256 newReward = multiplier * pool.rewardTokenPerSecond;
        // no stakers, nothing to distribute
        if (pool.depositedAmount == 0) {
            pool.unclaimedRewardTokens += newReward;
            pool.lastRewardTime = uint32(block.timestamp);
            return;
        }
        pool.accRewardPerShare = pool.accRewardPerShare + ((newReward * PRECISION_MULTIPLIER) / pool.depositedAmount);
        pool.lastRewardTime = uint32(block.timestamp);
    }

    function _calcPendingReward(UserInfo storage user, uint256 accRewardPerShare) internal view returns (uint256 pending) {
        return ((user.amount * accRewardPerShare) / PRECISION_MULTIPLIER) - user.rewardDebt;
    }

    function _calcReleasable(PoolInfo storage pool, uint256 vested, uint256 released) internal view returns (uint256 releasable) {
        if (uint32(block.timestamp) <= pool.vestingStart) {
            return 0;
        } else if (uint32(block.timestamp) >= (pool.vestingStart + pool.vestingDuration)) {
            return vested - released;
        } else {
            return (vested * (uint32(block.timestamp) - pool.vestingStart)) / (pool.vestingDuration) - released;
        }
    }

    // View function to see pending tokens on frontend.
    function pendingReward(uint256 _pid, address _user) external view returns (uint256 locked, uint256 releasable) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];

        uint256 accRewardPerShare = pool.accRewardPerShare;
        if (uint32(block.timestamp) > pool.lastRewardTime && pool.depositedAmount != 0) {
            uint256 multiplier = getMultiplier(pool.lastRewardTime, uint32(block.timestamp));
            uint256 newReward = multiplier * pool.rewardTokenPerSecond;
            accRewardPerShare += (newReward * PRECISION_MULTIPLIER) / pool.depositedAmount;
        }

        uint256 new_vested = user.vested + _calcPendingReward(user, accRewardPerShare);
        releasable = _calcReleasable(pool, new_vested, user.released);
        locked = new_vested - user.released - releasable;
    }

    // Deposit tokens to BetterFarm for reward allocation.
    function deposit(uint256 _pid, uint256 _amount) external {
        require (_amount > 0, "BetterStaking::deposit: amount should be positive");
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_msgSender()];
        updatePool(_pid);

        // user deposited something already, transfer reward
        if (user.amount > 0) {
            uint256 pending = _calcPendingReward(user, pool.accRewardPerShare);
            user.vested += pending;
        }

        pool.depositToken.safeTransferFrom(_msgSender(), address(this), _amount);

        // update user deposit amount and stats
        user.amount += _amount;
        pool.depositedAmount += _amount;
        user.rewardDebt = (user.amount * pool.accRewardPerShare) / PRECISION_MULTIPLIER;
        depositedTokens[address(pool.depositToken)] += _amount;

        emit Deposit(_msgSender(), _pid, _amount);
    }

    // Withdraw LP tokens from BetterFarm.
    function withdraw(uint256 _pid, uint256 _amount) external {
        require (_amount > 0, "BetterStaking::withdraw: amount should be positive");

        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_msgSender()];

        require (user.amount >= _amount, "BetterStaking::withdraw: withdraw amount exceeds balance");
        require (pool.start + pool.lockTime <= uint32(block.timestamp), "BetterStaking::withdraw: lock is active");

        updatePool(_pid);
        uint256 pending = _calcPendingReward(user, pool.accRewardPerShare);
        user.vested += pending;

        user.amount -= _amount;
        pool.depositedAmount -= _amount;
        user.rewardDebt = (user.amount * pool.accRewardPerShare) / PRECISION_MULTIPLIER;
        depositedTokens[address(pool.depositToken)] -= _amount;

        pool.depositToken.safeTransfer(_msgSender(), _amount);

        emit Withdraw(_msgSender(), _pid, _amount);
    }

    function claim(uint256 _pid) external {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_msgSender()];

        updatePool(_pid);
        uint256 pending = _calcPendingReward(user, pool.accRewardPerShare);
        user.vested += pending;

        if (user.vested > 0) {
            uint256 releasable = _calcReleasable(pool, user.vested, user.released);
            user.released += releasable;

            if (releasable > 0) {
                pool.rewardToken.safeTransfer(_msgSender(), releasable);
                rewardTokens[address(pool.rewardToken)] -= releasable;
                emit Reward(_msgSender(), _pid, releasable);
            }
        }

        user.rewardDebt = (user.amount * pool.accRewardPerShare) / PRECISION_MULTIPLIER;
    }

    function pullUnclaimedTokens(uint256 _pid) external onlyAdmin {
        PoolInfo storage pool = poolInfo[_pid];

        uint256 _unclaimed = pool.unclaimedRewardTokens;
        require (_unclaimed > 0, "BetterStaking::pullUnclaimedTokens: zero unclaimed amount");

        pool.unclaimedRewardTokens = 0;
        pool.rewardToken.safeTransfer(_msgSender(), _unclaimed);
        rewardTokens[address(pool.rewardToken)] -= _unclaimed;

        emit WithdrawUnclaimed(_unclaimed);
    }

    function sweep(address token, uint256 amount) external onlyAdmin {
        uint256 token_balance = IERC20(token).balanceOf(address(this));

        require (amount <= token_balance, "BetterStaking::sweep: amount exceeds balance");
        require (
            token_balance - amount >= depositedTokens[token] + rewardTokens[token],
            "BetterStaking::sweep: cant withdraw reserved tokens"
        );

        IERC20(token).safeTransfer(_msgSender(), amount);
    }
}