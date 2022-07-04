module.exports = async ({getNamedAccounts, deployments}) => {
    const {deployer} = await getNamedAccounts();

    await deployments.deploy('BetterStaking', {
        from: deployer,
        log: true,
        args: []
    });
};
module.exports.tags = ['farm'];
