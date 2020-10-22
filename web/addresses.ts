import { ethers } from "ethers";

const ADDRESSES = {
    'local': {
        crecUniswap: '',
        crecTransfer: '0x78Aeff0658Fa67735fBF99Ce7CDB01Fe5D520259'
    },
    'kovan': {
        crecUniswap: '',
        crecTransfer: '0xBd18f1B295c499279F26A21d75F51399D5787fdc'
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