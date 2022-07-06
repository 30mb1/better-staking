const chai = require("chai");
const { ethers } = require("hardhat");
const { solidity } = require("ethereum-waffle");
chai.use(solidity);
const { expect } = chai;

describe("Better staking admin roles test", function () {
    let token, token1, token2, farm;
    let owner, admin, manager, user;

    it('Deploy tokens and farm', async () => {
        [owner, admin, manager, user] = await ethers.getSigners();

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

        await token.connect(owner).transfer(admin.address, 1000000);
        await token.connect(owner).transfer(manager.address, 1000000);

        await token1.connect(owner).transfer(admin.address, 1000000);
        await token1.connect(owner).transfer(manager.address, 1000000);

        await token2.connect(owner).transfer(admin.address, 1000000);
        await token2.connect(owner).transfer(manager.address, 1000000);

        await token.connect(admin).approve(farm.address, 1000000);
        await token.connect(manager).approve(farm.address, 1000000);

        await token1.connect(admin).approve(farm.address, 1000000);
        await token1.connect(manager).approve(farm.address, 1000000);
    });

    it('Remove excess roles from owner', async function() {
        await farm.connect(owner).removeStakingManager(owner.address);
        await farm.connect(owner).removeAdmin(owner.address);
    });

    it("Manage admins", async function () {
        await farm.connect(owner).setAdmin(admin.address);
        const is_admin = await farm.isAdmin(admin.address);
        expect(is_admin).to.be.true;

        // only owner
        await expect(farm.connect(user).setAdmin(user.address)).to.be.revertedWith("Ownable: caller is not the owner");
        // admin cant add admins too
        await expect(farm.connect(admin).setAdmin(user.address)).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it('Manage managers', async function() {
        await farm.connect(admin).setStakingManager(manager.address);
        const is_manager = await farm.isStakingManager(manager.address);
        expect(is_manager).to.be.true;

        // users cant add managers
        await expect(farm.connect(user).setStakingManager(user.address)).to.be.revertedWith("Manageable::onlyAdmin: caller is not admin");
        // manager cant add managers
        await expect(farm.connect(manager).setStakingManager(user.address)).to.be.revertedWith("Manageable::onlyAdmin: caller is not admin");
        // owner cant add managers
        await expect(farm.connect(owner).setStakingManager(user.address)).to.be.revertedWith("Manageable::onlyAdmin: caller is not admin");
    });


    it('Manager create pool', async function() {
        // owner cant create pool
        await expect(
            farm.connect(owner).add(token1.address, token.address, 500000, 100, 30, 20, 100, 30)
        ).to.be.revertedWith("Manageable::onlyStakingManager: caller is not staking manager");

        // admin cant create pool
        await expect(
            farm.connect(admin).add(token1.address, token.address, 500000, 100, 30, 20, 100, 30)
        ).to.be.revertedWith("Manageable::onlyStakingManager: caller is not staking manager");

        // user cant create pool
        await expect(
            farm.connect(user).add(token1.address, token.address, 500000, 100, 30, 20, 100, 30)
        ).to.be.revertedWith("Manageable::onlyStakingManager: caller is not staking manager");

        // manager create pool
        await farm.connect(manager).add(token1.address, token.address, 500000, 100, 30, 20, 100, 30);
    });

    it('Remove all roles', async function() {
        // manager cant remove managers
        await expect(
            farm.connect(manager).removeStakingManager(manager.address)
        ).to.be.revertedWith("Manageable::onlyAdmin: caller is not admin");

        // owner cant remove managers
        await expect(
            farm.connect(owner).removeStakingManager(manager.address)
        ).to.be.revertedWith("Manageable::onlyAdmin: caller is not admin");

        // user cant remove managers
        await expect(
            farm.connect(user).removeStakingManager(manager.address)
        ).to.be.revertedWith("Manageable::onlyAdmin: caller is not admin");

        // admin remove manager
        await farm.connect(admin).removeStakingManager(manager.address);

        // admin cant remove admins
        await expect(
            farm.connect(admin).removeAdmin(admin.address)
        ).to.be.revertedWith("Ownable: caller is not the owner");

        // user cant remove admins
        await expect(
            farm.connect(user).removeAdmin(admin.address)
        ).to.be.revertedWith("Ownable: caller is not the owner");

        await farm.connect(owner).removeAdmin(admin.address);
    });
});
