import { ethers } from "ethers";
import { network } from "hardhat";

const ADDRESSES = {
    'local': {
        crecUniswap: '',
        crecTransfer: '0x78Aeff0658Fa67735fBF99Ce7CDB01Fe5D520259'
    },
    'kovan': {
        crecUniswap: '0xF24cd28e9b928d5D4a1C9bAb55de18a39f7c4f4b',
        crecTransfer: '0x3114c4611Cd06eCC640ca0642985BC2Be5Ebff33'
    }
}

export function getAddresses(network: ethers.providers.Network) {
    switch(network && network.chainId ? network.chainId : 0) {
        case 42:
            return ADDRESSES.kovan;
        default:
            return ADDRESSES.local;
    }
}

export function getBiconomyKey(network: ethers.providers.Network) {
    switch(network && network.chainId ? network.chainId : 0) {
        case 42:
            return 'FcbuNe5Et.dfc49ee7-b33c-4711-9236-98d023fa050e';
    }
}