import _ from 'lodash';

import { ethers } from 'hardhat';
import { BigNumber, ContractReceipt, Signer } from 'ethers';

import { TokenFactory } from '../../typechain/TokenFactory';

export async function tradeUniswap(signer: Signer, routerAddress: string, pairAddresses: string[], amount: BigNumber): Promise<ContractReceipt|null> {
    // get list of addresses still requiring transactions to send

    const abi = ['function swapETHForExactTokens(uint256, address[], address, uint256) payable'];

    const c = new ethers.Contract(routerAddress, abi, signer);

    const txn = await c.swapETHForExactTokens(amount, pairAddresses, await signer.getAddress(), 1000000000000, {value: ethers.utils.parseEther('1000')});

    const res = txn.wait();

    return res;
}

if(module == require.main) {

    // convert flags to data
    (async () => {

        const signer = (await ethers.getSigners())[0];

        const uniPath = process.env.UNI_PATH!.split(',');

        const tokenContract = TokenFactory.connect(uniPath[uniPath.length - 1], signer);

        const decimals = await tokenContract.decimals();

        const rcpt = await tradeUniswap(signer, process.env.ROUTER!, uniPath, ethers.utils.parseUnits(process.env.AMOUNT!, 'wei').mul(BigNumber.from(10).pow(decimals)));

        if(rcpt) {
            console.log('txn status:', rcpt.status);
            console.log('gas used: ', rcpt.gasUsed.toNumber());
        }
        else {
            console.log('nothing found to transact');
        }
    })();
}