import { Indexer, Batcher, KvClient } from '@0glabs/0g-ts-sdk';
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { ethers } from 'ethers';
import dotenv from "dotenv";

dotenv.config();

// Configuration
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = 'https://evmrpc-testnet.0g.ai';
const STORAGE_NODE_URL = 'https://indexer-storage-testnet-turbo.0g.ai';
const PROVIDER_ADDRESS = '0x3feE5a4dd5FDb8a32dDA97Bed899830605dBD9D3';

// Initialize Ethereum wallet
const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const signer = wallet.connect(provider);

async function decentralizedStorageAndInference() {
    try {
        // --- Step 1: Initialize Storage SDK ---
        const indexer = new Indexer(STORAGE_NODE_URL);
        console.log('Storage Indexer initialized');

        // --- Step 2: Upload Key-Value Pair to 0G Storage ---
        const [nodes, err] = await indexer.selectNodes(1);
        if (err !== null) {
            throw new Error(`Error selecting nodes: ${err}`);
        }

        // Placeholder for streamId and flowContract - replace with actual values
        const streamId = PROVIDER_ADDRESS; // TODO: Replace with actual streamId (e.g., from stream creation or contract)
        // const flowContract = /* TODO: Initialize flowContract (e.g., ethers.Contract instance) */ null; 
        // Example (uncomment and adjust if you have ABI and address):
        const flowContractAddress = '0xbD2C3F0E65eDF5582141C35969d66e34629cC768';
        const flowContractABI = [{ "inputs": [{ "internalType": "address", "name": "beacon", "type": "address" }, { "internalType": "bytes", "name": "data", "type": "bytes" }], "stateMutability": "payable", "type": "constructor" }, { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "address", "name": "previousAdmin", "type": "address" }, { "indexed": false, "internalType": "address", "name": "newAdmin", "type": "address" }], "name": "AdminChanged", "type": "event" }, { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "beacon", "type": "address" }], "name": "BeaconUpgraded", "type": "event" }, { "anonymous": false, "inputs": [{ "indexed": true, "internalType": "address", "name": "implementation", "type": "address" }], "name": "Upgraded", "type": "event" }, { "stateMutability": "payable", "type": "fallback" }, { "stateMutability": "payable", "type": "receive" }];
        const flowContract = new ethers.Contract(flowContractAddress, flowContractABI, signer);

        if (!flowContract) {
            console.warn('flowContract not initialized - this is a placeholder. Batcher will fail without a valid flowContract.');
        }

        const batcher = new Batcher(1, nodes, flowContract, RPC_URL);

        const key1 = Uint8Array.from(Buffer.from("TESTKEY0", 'utf-8'));
        const val1 = Uint8Array.from(Buffer.from("TESTVALUE0", 'utf-8'));
        batcher.streamDataBuilder.set(streamId, key1, val1);

        const [tx, batchErr] = await batcher.exec();
        if (batchErr !== null) {
            throw new Error(`Error executing batcher: ${batchErr}`);
        }
        console.log("Key-value pair uploaded successfully, tx:", tx);

        // --- Step 3: Download Key-Value Pair from 0G Storage ---
        // Using STORAGE_NODE_URL as a placeholder; replace with actual KvClient address if different
        const KvClientAddr = STORAGE_NODE_URL; // TODO: Replace with actual KV client address (e.g., "http://3.101.147.150:6789")
        const kvClient = new KvClient(KvClientAddr);
        const encodedKey = ethers.utils.base64.encode(key1); // Encode key as base64 per documentation
        const downloadedValue = await kvClient.getValue(streamId, encodedKey);
        console.log("Downloaded value:", downloadedValue);

        // --- Step 4: Initialize Inference Broker ---
        const broker = await createZGComputeNetworkBroker(wallet);
        console.log('Inference Broker initialized');

        // --- Step 5: Check for existing ledger or create new one ---
        const initialBalance = 0.05;
        try {
            const existingBalance = await broker.ledger.getLedger();
            console.log('Using existing ledger with balance:', existingBalance);
        } catch (error) {
            console.log("No existing ledger found. Creating new ledger...");
            await broker.ledger.addLedger(initialBalance);
            console.log('New account created and funded with initial balance:', initialBalance);
        }

        // --- Step 6: Inference Steps ---
        console.log("Listing services...");
        const services = await broker.inference.listService();
        console.log("Available inference providers:", services);

        console.log("Getting service metadata...");
        const { endpoint, model } = await broker.inference.getServiceMetadata(PROVIDER_ADDRESS);
        console.log("Endpoint:", endpoint, "Model:", model);

        const signalMessage = `🚀 Bullish Alert 🚀
      🏛️ Token: AUCTION (auction)
      📈 Signal: Buy
      🎯 Targets:
      TP1: $54
      TP2: $56.5
      🛑 Stop Loss: $48.4
      ⏳ Timeline: 1-2 days

      💡 Trade Tip:
      AUCTION shows strong bullish momentum with a 14.21% surge and rising volume. Targets align with overbought RSI divergence risks. Use tight stop-loss to manage volatility from whale-driven liquidity shifts and recent liquidation events.`;

        const content = `Analyze the below given message and determine whether that message contains a trading signal or not and 
    if it does then extract the data and give it in a json format like this : 
    {
      tokenSymbol : AUCTION,
      signal: buy,
      tp1: 1000,
      tp2: 2000,
      sl: 800
    }
    ${signalMessage}

    Note : Your response should strictly contain only json object and nothing else.
    `;
        console.log("Generating request headers...");

        async function makeInferenceRequest(broker, endpoint, headers, content, model) {
            const response = await fetch(`${endpoint}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify({ messages: [{ role: 'system', content }], model }),
            });
            return await response.json();
        }

        async function getNewHeaders() {
            return await broker.inference.getRequestHeaders(PROVIDER_ADDRESS, content);
        }

        let maxRetries = 5;
        let retryCount = 0;
        let result;

        while (retryCount < maxRetries) {
            try {
                const currentHeaders = await getNewHeaders();
                result = await makeInferenceRequest(broker, endpoint, currentHeaders, content, model);
                console.log(`Attempt ${retryCount + 1} result:`, result);

                if (result?.choices?.[0]?.message?.content) {
                    console.log("Success! Message:", result.choices[0].message.content);
                    break;
                }

                if (result.error && result.error.includes('settleFee')) {
                    const feeMatch = result.error.match(/expected ([\d.]+) A0GI/);
                    if (feeMatch) {
                        const expectedFee = Number(feeMatch[1]);
                        console.log('Settling fee:', expectedFee);
                        await broker.inference.settleFee(PROVIDER_ADDRESS, expectedFee);
                        console.log('Fee settled successfully');
                    }
                }

                console.log(`Attempt ${retryCount + 1} failed, retrying...`);
                retryCount++;
                await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (error) {
                console.error(`Error on attempt ${retryCount + 1}:`, error);
                retryCount++;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        if (!result?.choices?.[0]?.message?.content) {
            console.log(`Failed to get valid response after ${maxRetries} attempts`);
        }

        console.log("Remaining balance in ledger", (await broker.ledger.getLedger()).ledgerInfo);

    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
    }
}

decentralizedStorageAndInference();