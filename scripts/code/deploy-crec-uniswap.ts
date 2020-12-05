import _ from 'lodash';

import { BigNumber, ethers as Ethers } from "ethers";

import { ethers } from 'hardhat';

import { Treasury } from '../../typechain/Treasury';
import { CrecUniswapAir } from '../../typechain/CrecUniswapAir';
import { CrecUniswapAir__factory } from '../../typechain/factories/CrecUniswapAir__factory';
import { Treasury__factory } from '../../typechain/factories/Treasury__factory';

const STARTING_WEIGHT = ethers.utils.parseEther('10');

export async function deployCrecUniswap(signer: Ethers.Signer, treasury: Treasury, options: any = {}): Promise<CrecUniswapAir> {

    // get balance of treasury for weth
    let targetTreasuryBalance = options.targetTreasuryBalance;

    if(!targetTreasuryBalance) {
        // assume the target is whatever is in the inherited treasury
        targetTreasuryBalance = await treasury.getTreasuryBalance();
    }

    console.log('target traesury balance', targetTreasuryBalance);

    const crecUniswap = await new CrecUniswapAir__factory(signer).deploy(treasury.address, options.targetInterval || ethers.BigNumber.from(600), targetTreasuryBalance);

    await crecUniswap.deployed();

    const txn = await treasury.setController(crecUniswap.address);
    await txn.wait(1);

    return crecUniswap;
}

export async function addAuthorizedPair(crec: CrecUniswapAir, pair: string, startFee: BigNumber|null) {
    return crec.addAuthorizedPair(pair, startFee || ethers.utils.parseEther('0.01'));
}


if(module == require.main) {

    // convert flags to data
    (async () => {

        const signer = (await ethers.getSigners())[0];

        const treasuryAddress = process.env.TREASURY!;

        if(!treasuryAddress) {
            console.error('Treasury address not specified');
            return;
        }

        let crecUniswap: CrecUniswapAir;
        if(process.env.CREC_UNISWAP) {
            crecUniswap = CrecUniswapAir__factory.connect(process.env.CREC_UNISWAP!, signer);
        }
        else {
            crecUniswap = await deployCrecUniswap(signer, Treasury__factory.connect(treasuryAddress, signer));
        }


        console.log('deployed crescendo uniswap', crecUniswap.address);

        for(const pair of (process.env.PAIRS || '').split(',')) {
            const t = await addAuthorizedPair(crecUniswap, pair, null);
            const r = await t.wait();

            console.log('authorized pair', pair, r.transactionHash);
        }
    })();
}