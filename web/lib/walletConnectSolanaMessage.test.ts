import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';
import { parseSolanaOffchainMessageV1 } from './solanaOffchainMessage';
import { prepareWalletConnectSolanaMessage } from './walletConnectSolanaMessage';

describe('WalletConnect Solana message preparation', () => {
  const signer = new Uint8Array(32).fill(23);
  const address = bs58.encode(signer);
  const account = { address, path: "m/44'/501'/7'/0'" };

  it('binds the request to the connected hardware account', () => {
    const prepared = prepareWalletConnectSolanaMessage(
      {
        pubkey: address,
        message: bs58.encode(new TextEncoder().encode('Log in'))
      },
      address,
      [account]
    );

    expect(prepared.signerAddress).toBe(address);
    expect(prepared.derivationPath).toBe(account.path);
    expect(parseSolanaOffchainMessageV1(prepared.expectedSignedData)).toMatchObject({
      message: 'Log in'
    });
  });

  it('rejects session, signer, and hardware-account mismatches', () => {
    const otherAddress = bs58.encode(new Uint8Array(32).fill(24));
    const params = {
      pubkey: address,
      message: bs58.encode(new TextEncoder().encode('Log in'))
    };

    expect(() =>
      prepareWalletConnectSolanaMessage(params, otherAddress, [account])
    ).toThrow('does not match');
    expect(() =>
      prepareWalletConnectSolanaMessage(params, address, [])
    ).toThrow('not an account loaded from this Trezor');
    expect(() =>
      prepareWalletConnectSolanaMessage({}, address, [account])
    ).toThrow('missing the Solana signer');
  });
});
