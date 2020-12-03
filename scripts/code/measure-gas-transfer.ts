import _ from 'lodash';

import { BigNumber, ethers as Ethers } from "ethers";

import { ethers } from 'hardhat';

import { Treasury } from '../../typechain/Treasury';
import { TreasuryFactory } from '../../typechain/TreasuryFactory';

import { deployEnv } from './deploy-env';
import { deployTreasuryWithPoolNoFactory } from './deploy-treasury';
import { deployCrecTransfer } from './deploy-crec-transfer';
import { TokenFactory } from '../../typechain/TokenFactory';

function createCrecendoApproval(amt: string, id: number, toId: number, deadline: number) {
  return ethers.utils.parseEther(amt)
    .add(BigNumber.from(id).shl(176))
    .add(BigNumber.from(deadline).shl(192))
    .add(BigNumber.from(toId).shl(224));
}

if(module == require.main) {

    // convert flags to data
    (async () => {

        const signers = await ethers.getSigners();
        const signer = signers[0];

        const [contracts, libs] = await deployEnv(signer);

        const treasury = await deployTreasuryWithPoolNoFactory(signer, libs, contracts.bfactory.address, [
            [contracts.tokA.address, ethers.utils.parseEther('10')],
            [contracts.tokB.address, ethers.utils.parseEther('10')]
        ]);

        const crec = await deployCrecTransfer(signer, TreasuryFactory.connect(treasury.address, signer));

        await crec.addAuthorizedToken(contracts.tokA.address, ethers.utils.parseEther('0.001'));
        await crec.addAuthorizedToken(contracts.tokB.address, ethers.utils.parseEther('0.001'));

        await crec.register(await signer.getAddress());

        console.error('contracts deployed');

        // write sort of CSV
        console.log('Count,Regular Gas Used,Batched Gas Used,Gas Used Per Transfer,Approve Gas Used,Total Gas Used,Total Gas Used Per Transfer');

        const addrs: string[] = [];

        let transferGas = BigNumber.from(0);
        let approveGas = BigNumber.from(0);

        for(let i = 1;i <= (process.env.MAX_ADDRS || 100);i++) {
            
            const signerAddr = await signers[i + 1].getAddress();
            const amt = Math.pow(20 - i, 2).toString();

            const transferTxn = await contracts.tokA.transfer(signerAddr, ethers.utils.parseEther(amt).mul(2));

            transferGas = transferGas.add((await transferTxn.wait()).gasUsed);

            const apr = await new TokenFactory(signers[i + 1]).attach(contracts.tokA.address).approve(crec.address, createCrecendoApproval(amt, 1, 1, 1000000000));
            approveGas = approveGas.add((await apr.wait()).gasUsed);
            addrs.push(signerAddr);

            console.log(addrs);
            const execTxnGas = await crec.estimateGas.exec(1, addrs);
            if(i == 10) {
                await crec.exec(1, addrs);
            }

            console.log(`${i},${transferGas.toNumber()},${execTxnGas.toNumber()},${execTxnGas.div(i).toNumber()},${approveGas.toNumber()},${execTxnGas.toNumber() + approveGas.toNumber()},${execTxnGas.div(i).toNumber() + approveGas.div(i).toNumber()}`);
        }
    })();
}