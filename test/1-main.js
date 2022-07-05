const chai = require("chai");
const { ethers } = require("hardhat");
const { solidity } = require("ethereum-waffle");
chai.use(solidity);
const { expect } = chai;

describe("Better staking test", function () {
    let token, token1, token2, farm;
    let owner, alice, bob;

    it('Deploy tokens and farm', async () => {
        [owner, alice, bob] = await ethers.getSigners();

        const Token = await ethers.getContractFactory("MockERC20");
        token = await Token.deploy('TEST', 'TEST', 1000000000);
        await token.deployed();

        token1 = await Token.deploy('TEST', 'TEST', 1000000000);
        await token1.deployed();

        token2 = await Token.deploy('TEST', 'TEST', 1000000000);
        await token2.deployed();

        const BetterStaking = await ethers.getContractFactory('BetterStaking');
        farm = await BetterStaking.deploy();
        await farm.deployed();

        const block = await ethers.provider.getBlock();

        await token.connect(owner).approve(farm.address, 1000000);
        await token1.connect(owner).approve(farm.address, 1000000);

        await farm.connect(owner).add(
            token.address,
            token1.address,
            1000000,
            block.timestamp + 20, // farming start
            30, // duration
            20, // lock time
            block.timestamp + 30, // vesting start
            30 // vesting duration
        );

        await farm.connect(owner).add(
            token1.address,
            token.address,
            500000,
            block.timestamp + 20, // farming start
            30, // duration
            20, // lock time
            block.timestamp + 30, // vesting start
            30 // vesting duration
        );

        const reward = await farm.rewardTokens(token1.address);
        const reward1 = await farm.rewardTokens(token.address);

        expect(reward.toString()).to.be.eq('1000000');
        expect(reward1.toString()).to.be.eq('500000');

        await token.connect(owner).transfer(alice.address, 1000000);
        await token.connect(owner).transfer(bob.address, 1000000);

        await token1.connect(owner).transfer(alice.address, 1000000);
        await token1.connect(owner).transfer(bob.address, 1000000);

        await token2.connect(owner).transfer(alice.address, 1000000);
        await token2.connect(owner).transfer(bob.address, 1000000);

        await token.connect(alice).approve(farm.address, 1000000);
        await token.connect(bob).approve(farm.address, 1000000);

        await token1.connect(alice).approve(farm.address, 1000000);
        await token1.connect(bob).approve(farm.address, 1000000);
    });

    it("User make deposit", async function () {
        await farm.connect(alice).deposit(0, 1000);
        const deposited = await farm.depositedTokens(token.address);

        expect(deposited.toString()).to.be.eq('1000');

        // reward tokens not affected
        const reward = await farm.rewardTokens(token1.address);
        const reward1 = await farm.rewardTokens(token.address);

        expect(reward.toString()).to.be.eq('1000000');
        expect(reward1.toString()).to.be.eq('500000');

        const pool = await farm.poolInfo(0);
        const pool1 = await farm.poolInfo(1);

        expect(pool.depositedAmount.toString()).to.be.eq('1000');
        expect(pool1.depositedAmount.toString()).to.be.eq('0');
    });

    it('Cant withdraw before lock expires', async function() {
        await expect(farm.connect(alice).withdraw(0, 1000)).to.be.revertedWith("BetterStaking::withdraw: lock is active");
    });

    it('Check no reward distributed before vesting start', async function() {
       await farm.connect(alice).claim(0);
       const user = await farm.userInfo(0, alice.address);
       expect(user.vested.toString()).to.be.eq('0');
    });

    it('Farming start, vesting not started', async function() {
        const pool = await farm.poolInfo(0);
        const expected_reward = pool.rewardTokenPerSecond * 10;

        // move to farming start
        await ethers.provider.send("evm_setNextBlockTimestamp", [pool.start.add(10).toNumber()]);
        await farm.connect(alice).claim(0);

        const user = await farm.userInfo(0, alice.address);
        expect(user.vested.toString()).to.be.eq(expected_reward.toString());

        // all reward is locked because vesting not started
        const pending = await farm.pendingReward(0, alice.address);
        expect(pending.locked.toString()).to.be.eq(expected_reward.toString());
        expect(pending.releasable.toString()).to.be.eq('0');
    });

    it('Vesting started', async function() {
        const pool = await farm.poolInfo(0);
        const expected_reward = pool.rewardTokenPerSecond * 20;

        await ethers.provider.send("evm_setNextBlockTimestamp", [pool.vestingStart.add(10).toNumber()]);
        // mine block because we want pendingReward to work
        await ethers.provider.send("evm_mine");

        // half of reward could be released
        const pending = await farm.pendingReward(0, alice.address);
        expect(pending.locked.toString()).to.be.eq((expected_reward * (2/3)).toString());
        expect(pending.releasable.toString()).to.be.eq((expected_reward / 3).toString());
    });

    it('Farming ends', async function() {
        const pool = await farm.poolInfo(0);
        const expected_reward = pool.rewardTokenPerSecond * 30;

        // 30 sec duration + 5 more
        await ethers.provider.send("evm_setNextBlockTimestamp", [pool.start.add(35).toNumber()]);
        // mine block because we want pendingReward to work
        await ethers.provider.send("evm_mine");

        // everything is released
        const pending = await farm.pendingReward(0, alice.address);
        const total = Number(pending.locked) + Number(pending.releasable);
        expect(total.toString()).to.be.eq(expected_reward.toString());
    });

    it('Vesting ended', async function() {
        const pool = await farm.poolInfo(0);
        const expected_reward = pool.rewardTokenPerSecond * 30;

        await ethers.provider.send("evm_setNextBlockTimestamp", [pool.vestingStart.add(30).toNumber()]);
        // mine block because we want pendingReward to work
        await ethers.provider.send("evm_mine");

        // everything is released
        const pending = await farm.pendingReward(0, alice.address);
        expect(pending.locked.toString()).to.be.eq('0');
        expect(pending.releasable.toString()).to.be.eq(expected_reward.toString());

        await farm.connect(alice).claim(0);

        // clear
        const pending2 = await farm.pendingReward(0, alice.address);
        expect(pending2.locked.toString()).to.be.eq('0');
        expect(pending2.releasable.toString()).to.be.eq('0');

        const user = await farm.userInfo(0, alice.address);
        expect(user.vested.toString()).to.be.eq(expected_reward.toString());

        // all released tokens are subtracted from reserved tokens
        const reward = await farm.rewardTokens(token1.address);
        expect((1000000 - expected_reward).toString()).to.be.eq(reward.toString());
    });

    it('Admin pull unclaimed tokens', async function() {
        const pool = await farm.poolInfo(1);
        await farm.connect(owner).pullUnclaimedTokens(1);

        const expected_reward = pool.rewardTokenPerSecond * 30;

        const reward = await farm.rewardTokens(pool.rewardToken);
        expect(reward.toString()).to.be.eq((500000 - expected_reward).toString());
    });

    it('Sweep', async function() {
        // some external token
        await token2.connect(alice).transfer(farm.address, 1000);
        await farm.connect(owner).sweep(token2.address, 1000);

        // withdraw reserved tokens
        await token.connect(alice).transfer(farm.address, 100);
        await expect(farm.connect(owner).sweep(token.address, 200)).to.be.revertedWith("BetterStaking::sweep: cant withdraw reserved tokens");
        await farm.connect(owner).sweep(token.address, 100);
    });

    it('User withdraw tokens after lock expire', async function() {
       await farm.connect(alice).withdraw(0, 1000);

        const pool = await farm.poolInfo(0);
        expect(pool.depositedAmount.toString()).to.be.eq('0');

        const deposited = await farm.depositedTokens(token.address);
        expect(deposited.toString()).to.be.eq('0');

        const user = await farm.userInfo(0, alice.address);
        expect(user.amount.toString()).to.be.eq('0');
    });
});
