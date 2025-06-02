import { InterceptingCall, Metadata } from '@grpc/grpc-js';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import Client, { CommitmentLevel, SubscribeRequest } from '@triton-one/yellowstone-grpc';

import * as dotenv from 'dotenv';
dotenv.config();

export const GEYSER_MESSAGE = 'GEYSER_MESSAGE';

const PING_INTERVAL_MS = 15_000;

export class GeyserSubscriber {
    private logger = new Logger(GeyserSubscriber.name);

    private grpcClient: Client;

    private eventEmitter: EventEmitter2;

    private stream;

    private heartbeatTimeoutTimer: any;

    private requestOptions: SubscribeRequest;

    private grpcToken: string;

    private metrics = { total: 0, lastReceived: new Date() };

    private noMsgTimeoutSeconds: number;

    private pingIntervalTimer: any;

    constructor(_eventEmitter: EventEmitter2, noMsgTimeoutSeconds = 10 * 60) {
        const grpcEndpoint = process.env.GEYSER_YELLOWSTONE_ENDPOINT;
        this.grpcToken = process.env.GEYSER_YELLOWSTONE_TOKEN;

        this.noMsgTimeoutSeconds = noMsgTimeoutSeconds;

        this.grpcClient = new Client(
            grpcEndpoint,
            undefined, // Don't pass token here since we're using interceptor
            {
                'grpc.max_receive_message_length': 64 * 64 * 1024 * 1024,
                interceptors: [this._authInterceptor.bind(this)],
            },
        );

        this.eventEmitter = _eventEmitter;
    }

    private _authInterceptor(options: any, nextCall: any) {
        return new InterceptingCall(nextCall(options), {
            start: (metadata: Metadata, listener: any, next: any) => {
                // Add token to metadata
                metadata.add('x-token', this.grpcToken);
                next(metadata, listener);
            },
        });
    }

    public async startListening(requestOptions: SubscribeRequest): Promise<void> {
        this.requestOptions = requestOptions;

        this.stream = await this.grpcClient.subscribe();
        await this._sendSubscribeRequest(this.stream, requestOptions);

        this.stream.on('data', (data) => {
            this._heartbeat();

            this.metrics.total = this.metrics.total + 1;
            this.metrics.lastReceived = new Date();

            const txn = data.transaction;
            const commitment = requestOptions.commitment;
            this._handleReceivedTxn(txn, GEYSER_MESSAGE, commitment);
        });

        this._handlePing();
        await this._handleCloseStream();
    }

    private async _sendSubscribeRequest(stream: any, requestOptions: SubscribeRequest): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            stream.write(requestOptions, (err) => {
                if (err === null || err === undefined) {
                    resolve();
                } else {
                    reject(err);
                }
            });
        }).catch((reason) => {
            throw reason;
        });
    }

    private _handlePing() {
        clearInterval(this.pingIntervalTimer);
        const pingRequest: SubscribeRequest = {
            ping: { id: 1 },
            // Required, but unused arguments
            accounts: {},
            accountsDataSlice: [],
            transactions: {},
            transactionsStatus: {},
            blocks: {},
            blocksMeta: {},
            entry: {},
            slots: {},
        };
        this.pingIntervalTimer = setInterval(async () => {
            await new Promise<void>((resolve, reject) => {
                this.stream.write(pingRequest, (err) => {
                    if (err === null || err === undefined) {
                        resolve();
                    } else {
                        reject(err);
                    }
                });
            }).catch((reason) => {
                console.error(reason);
                throw reason;
            });
        }, PING_INTERVAL_MS);
    }

    private async _handleCloseStream(): Promise<void> {
        await new Promise<void>((resolve) => {
            this.stream.on('error', (error) => {
                this._tryToReconnect();
                resolve();
            });
            this.stream.on('end', () => {
                resolve();
            });
            this.stream.on('close', () => {
                resolve();
            });
        });
    }

    private _handleReceivedTxn(txn, eventName: string, commitment: CommitmentLevel): void {
        const date = new Date();
        this._emitEvent({ eventName, message: txn, date, commitment });
    }

    private _emitEvent(event: any) {
        this.eventEmitter.emit(event.eventName, event);
    }

    private _heartbeat() {
        clearTimeout(this.heartbeatTimeoutTimer);

        this.heartbeatTimeoutTimer = setTimeout(() => {
            this.logger.debug('Terminating connection due to inactivity');

            return this._tryToReconnect();
        }, this.noMsgTimeoutSeconds * 1000);
    }

    private async _tryToReconnect() {
        await this.stream.end();

        setTimeout(() => {
            this.startListening(this.requestOptions);
        }, 5000);
    }
}
