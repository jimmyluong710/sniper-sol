import { struct } from '@solana/buffer-layout';
import { u64 } from '@solana/buffer-layout-utils';
import BigNumber from 'bignumber.js';
import * as bs58 from 'bs58';

const DiscriminatorPumpAmmLayout = struct([u64('discriminator') as any]);

export enum EPoolTransactionType {
  Swap = 'swap',
  AddLiquidity = 'add',
  RemoveLiquidity = 'remove',
  InitializePool = 'initializePool',
}

function convertToUiAmount(amount: string, decimals: number): number {
  return new BigNumber(amount).dividedBy(10 ** decimals).toNumber();
}

enum EPumpFunAMMParseInx {
  CREATE_POOL = 'createPool',
  BUY = 'buy',
  SELL = 'sell',
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
}

export const PUMP_FUN_AMM_PROGRAM_ID =
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const PUMP_FUN_PROGRAM_ID =
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const pumpfunMigrationAddr =
  '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg';

export interface IDecodedTxn {
  txHash: string;
  signer: string;
  inMint: string;
  inAmount?: string;
  inUiAmount: number;
  outMint: string;
  outAmount?: string;
  outUiAmount?: number;
  type: EPoolTransactionType;
  pair: string;
  isMigratedFromPump?: boolean;
  tokenVaultIn?: {
    pubkey: string;
    postAmount: string;
    postUiAmount: number;
    decimals: number;
  };
  tokenVaultOut?: {
    pubkey: string;
    postAmount: string;
    postUiAmount: number;
    decimals: number;
  };
}

export class PumpFunAMMExchange {
  public programId = PUMP_FUN_AMM_PROGRAM_ID;

  public DEX_NAME = 'pumpswap';

  parseTransaction(transaction: any): IDecodedTxn[] {
    const parsedIxn = this.parseInstructions(transaction);
    const parsedIixns = this._parseInnerInstructions(transaction);

    return [...parsedIxn, ...parsedIixns];
  }

  parseInstructions(transaction: any): any[] {
    try {
      const txnInstructions =
        transaction.transaction?.message?.instructions || [];

      const pumpIxns = [];
      for (let i = 0; i < txnInstructions.length; i++) {
        if (txnInstructions[i].programId?.toString() === this.programId) {
          pumpIxns.push({
            ...txnInstructions[i],
            index: i,
          });
        }
      }

      const result = [];
      const postTokenBalances = transaction.meta.postTokenBalances;
      const accountRelatedTxn = transaction.transaction.message.accountKeys;
      pumpIxns.forEach((pumpIxn) => {
        const pumpInnerInstructions = transaction.meta.innerInstructions.find(
          (innerInstruction: any) => innerInstruction.index == pumpIxn.index,
        )?.instructions;
        const ixnType = this.getIxnType(pumpIxn.data);
        if (!ixnType) {
          return;
        }

        const transferIixns = this._findTransferInstructions(
          pumpInnerInstructions,
          0,
          2,
          '11111111111111111111111111111111',
        );
        const mappedIxnType =
          ixnType == EPumpFunAMMParseInx.CREATE_POOL ||
          ixnType == EPumpFunAMMParseInx.DEPOSIT
            ? EPoolTransactionType.AddLiquidity
            : ixnType == EPumpFunAMMParseInx.BUY ||
                ixnType == EPumpFunAMMParseInx.SELL
              ? EPoolTransactionType.Swap
              : EPoolTransactionType.RemoveLiquidity;
        const ixnResult = this._handleInx(
          transferIixns,
          accountRelatedTxn,
          pumpIxn,
          postTokenBalances,
          mappedIxnType,
        );

        if (ixnResult) {
          const isMigratedFromPump = this._checkMigratedFromPump(
            ixnType,
            accountRelatedTxn.map((item) => item.pubkey.toString()),
          );

          const txHash = transaction.transaction.signatures[0];
          result.push({
            txHash,
            ...ixnResult,
            ...(ixnType == EPumpFunAMMParseInx.CREATE_POOL && {
              isCreatePool: true,
            }),
            ...(isMigratedFromPump && { isMigratedFromPump }),
          });
        }
      });

      return result;
    } catch (e) {
      console.debug(
        `Parse pump.fun AMM instruction with tx: ${transaction?.transaction?.signatures[0]}`,
        e,
      );

      return [];
    }
  }

  private _parseInnerInstructions(transaction: any): any[] {
    const result = [];

    try {
      const postTokenBalances = transaction.meta.postTokenBalances;
      const accountRelatedTxn = transaction.transaction.message.accountKeys;

      transaction.meta.innerInstructions.map((item) => {
        item.instructions.forEach((ixn: any, index) => {
          if (ixn.programId.toString() == this.programId.toString()) {
            const ixnType = this.getIxnType(ixn.data);
            if (!ixnType) {
              return;
            }
            const transferIixns = this._findTransferInstructions(
              item.instructions,
              index + 1,
              2,
            );

            const mappedIxnType =
              ixnType == EPumpFunAMMParseInx.CREATE_POOL ||
              ixnType == EPumpFunAMMParseInx.DEPOSIT
                ? EPoolTransactionType.AddLiquidity
                : ixnType == EPumpFunAMMParseInx.BUY ||
                    ixnType == EPumpFunAMMParseInx.SELL
                  ? EPoolTransactionType.Swap
                  : EPoolTransactionType.RemoveLiquidity;
            const ixnResult = this._handleInx(
              transferIixns,
              accountRelatedTxn,
              ixn,
              postTokenBalances,
              mappedIxnType,
            );

            if (ixnResult) {
              const isMigratedFromPump = this._checkMigratedFromPump(
                ixnType,
                accountRelatedTxn.map((item) => item.pubkey.toString()),
              );

              const txHash = transaction.transaction.signatures[0];
              result.push({
                txHash,
                ...ixnResult,
                ...(ixnType == EPumpFunAMMParseInx.CREATE_POOL && {
                  isCreatePool: true,
                }),
                ...(isMigratedFromPump && { isMigratedFromPump }),
              });
            }
          }
        });
      });

      return result;
    } catch (e) {
      console.debug(
        `Parse pump.fun AMM inner instruction with tx: ${transaction?.transaction?.signatures[0]}`,
        e,
      );

      return [];
    }
  }

  private _handleInx(
    transfersInnerInstruction,
    accountRelatedTxn,
    ixn,
    postTokenBalances: any[],
    type: EPoolTransactionType,
  ): any {
    if (!transfersInnerInstruction || transfersInnerInstruction.length < 1) {
      return null;
    }

    const pair = ixn.accounts[0].toString();
    let inTransfer =
      transfersInnerInstruction[0].parsed.info.authority == pair
        ? transfersInnerInstruction[1]
        : transfersInnerInstruction[0];
    let outTransfer =
      transfersInnerInstruction[1]?.parsed?.info?.authority == pair
        ? transfersInnerInstruction[1]
        : transfersInnerInstruction[0];
    if (type != EPoolTransactionType.Swap) {
      inTransfer = transfersInnerInstruction[0];
      outTransfer = transfersInnerInstruction[1];
    }

    outTransfer = transfersInnerInstruction[1] ? outTransfer : null;

    const inAmount = inTransfer.parsed.info.amount;
    const outAmount = outTransfer?.parsed?.info?.amount;
    let tokenAccountInPub: string;
    let tokenAccountOutPub: string;
    switch (type) {
      case EPoolTransactionType.AddLiquidity:
        tokenAccountInPub = inTransfer.parsed.info.destination;
        tokenAccountOutPub = outTransfer?.parsed?.info?.destination;

        break;
      case EPoolTransactionType.RemoveLiquidity:
        tokenAccountInPub = inTransfer.parsed.info.source;
        tokenAccountOutPub = outTransfer?.parsed?.info?.source;

        break;
      case EPoolTransactionType.Swap:
        tokenAccountInPub = inTransfer.parsed.info.destination;
        tokenAccountOutPub = outTransfer?.parsed?.info?.source;

        break;
    }

    let tokenAccountInIndex;
    let tokenAccountOutIndex;
    accountRelatedTxn.forEach((item, index) => {
      if (item.pubkey.toString() === tokenAccountInPub.toString()) {
        tokenAccountInIndex = index;
      }
      if (item.pubkey.toString() === tokenAccountOutPub?.toString()) {
        tokenAccountOutIndex = index;
      }
    });

    const tokenAccountIn = postTokenBalances.find(
      (item) => item.accountIndex == tokenAccountInIndex,
    );
    const tokenAccountOut = tokenAccountOutPub
      ? postTokenBalances.find(
          (item) => item.accountIndex == tokenAccountOutIndex,
        )
      : null;

    return {
      signer: accountRelatedTxn[0].pubkey.toString(),
      inAmount,
      inUiAmount: convertToUiAmount(
        inAmount,
        tokenAccountIn.uiTokenAmount.decimals,
      ),
      inMint: tokenAccountIn.mint,
      outAmount: outAmount ? outAmount : '0',
      outUiAmount: tokenAccountOutPub
        ? convertToUiAmount(outAmount, tokenAccountOut.uiTokenAmount.decimals)
        : 0,
      outMint: tokenAccountOutPub ? tokenAccountOut.mint : '',
      type,
      pair,
      tokenVaultIn: {
        pubkey: tokenAccountInPub.toString(),
        postAmount: tokenAccountIn.uiTokenAmount.amount,
        postUiAmount: tokenAccountIn.uiTokenAmount.uiAmount,
        decimals: tokenAccountIn.uiTokenAmount.decimals,
      },
      tokenVaultOut: tokenAccountOutPub
        ? {
            pubkey: tokenAccountOutPub.toString(),
            postAmount: tokenAccountOut.uiTokenAmount.amount,
            postUiAmount: tokenAccountOut.uiTokenAmount.uiAmount,
            decimals: tokenAccountOut.uiTokenAmount.decimals,
          }
        : null,
    };
  }

  private _checkMigratedFromPump(
    ixnType: EPumpFunAMMParseInx,
    accKeys: string[],
  ): boolean {
    return (
      ixnType == EPumpFunAMMParseInx.CREATE_POOL &&
      accKeys.includes(PUMP_FUN_PROGRAM_ID) &&
      accKeys.includes(pumpfunMigrationAddr)
    );
  }

  // data in base58 format
  public getIxnType(data: string): EPumpFunAMMParseInx {
    const buffer = Buffer.from(bs58.decode(data));

    const discriminator = (
      DiscriminatorPumpAmmLayout.decode(buffer) as any
    )?.discriminator?.toString();
    switch (discriminator) {
      case '13564957318303552233':
        return EPumpFunAMMParseInx.CREATE_POOL;
      case '16927863322537952870':
        return EPumpFunAMMParseInx.BUY;
      case '12502976635542562355':
        return EPumpFunAMMParseInx.SELL;
      case '13182846803881894898':
        return EPumpFunAMMParseInx.DEPOSIT;
      case '2495396153584390839':
        return EPumpFunAMMParseInx.WITHDRAW;
      default:
        return null;
    }
  }

  _findTransferInstructions(
    instructions,
    fromIndex: number,
    limit: number,
    excludedProgramId?: string,
  ): any[] {
    // argument programId for determining which program being interacted to
    if (!instructions || instructions.length == 0) {
      return [];
    }

    const transferInstructions = [];
    let i = fromIndex;
    while (transferInstructions.length < limit && i < instructions.length) {
      const _inx: any = instructions[i];
      if (_inx?.parsed?.type == 'transfer') {
        if (
          excludedProgramId &&
          _inx?.programId.toString() == excludedProgramId
        ) {
          i++;
          continue;
        }

        transferInstructions.push({ ..._inx });
        i++;
        continue;
      } else if (_inx?.parsed?.type == 'transferChecked') {
        _inx.parsed.info.amount = _inx.parsed.info.tokenAmount.amount;

        if (
          excludedProgramId &&
          _inx?.programId.toString() == excludedProgramId
        ) {
          i++;
          continue;
        }

        transferInstructions.push({ ..._inx });
        i++;
        continue;
      }

      i++;
    }

    return transferInstructions;
  }
}
