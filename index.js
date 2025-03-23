import { Indexer, ZgFile } from '@0glabs/0g-ts-sdk';
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { ethers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
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

    // --- Step 2: Upload a File to 0G Storage ---
    const filePath = path.join("D:/0g-sdk-integration", 'example.txt');
    const fileContent = 'Hello, 0G Decentralized World!';
    fs.writeFileSync(filePath, fileContent);
    if (!fs.existsSync(filePath)) {
      throw new Error('File creation failed at: ' + filePath);
    }
    console.log('File created successfully at:', filePath);

    const zgFile = await ZgFile.fromFilePath(filePath);
    const [tree, treeErr] = await zgFile.merkleTree();
    if (treeErr) throw new Error(`Merkle tree generation failed: ${treeErr}`);

    const rootHash = tree.rootHash();
    console.log('File Merkle Root Hash:', rootHash);

    const [tx, uploadErr] = await indexer.upload(zgFile, RPC_URL, signer);
    if (uploadErr !== null) {
      if (uploadErr.message.includes('Data already exists')) {
        console.log('File already exists in storage, proceeding...');
      } else {
        console.error('Full upload error:', uploadErr);
        throw new Error(`Upload error: ${uploadErr}`);
      }
    } else {
      console.log("Upload successful!");
      console.log("Transaction Hash:", tx);
    }
    zgFile.close();

    // --- Step 3: Initialize Inference Broker ---
    const broker = await createZGComputeNetworkBroker(wallet);
    console.log('Inference Broker initialized');

    // --- Step 4: Check for existing ledger or create new one ---
    const initialBalance = 0.05;
    try {
      const existingBalance = await broker.ledger.getLedger();
      console.log('Using existing ledger with balance:', existingBalance);
    } catch (error) {
      console.log("No existing ledger found. Creating new ledger...");
      await broker.ledger.addLedger(initialBalance);
      console.log('New account created and funded with initial balance:', initialBalance);
    }

    // --- Step 5: Inference Steps ---
    console.log("Listing services...");
    const services = await broker.inference.listService();
    console.log("Available inference providers:", services);

    console.log("Getting service metadata...");
    const { endpoint, model } = await broker.inference.getServiceMetadata(PROVIDER_ADDRESS);
    console.log("Endpoint:", endpoint, "Model:", model);

    const signalMessage = `Coin : #TRUMP /USDT

🟢 LONG 

👉 Entry:  10.8800  - 10.5000

🌐 Leverage: 20x

🎯 Target 1: 10.9800
🎯 Target 2: 11.0900
🎯 Target 3: 11.2000
🎯 Target 4: 11.3100
🎯 Target 5: 11.4300
🎯 Target 6: 11.5500

❌ StopLoss: 10.1800`

    const content = `Analyze the below given message and determine whether that message contains a trading signal or not and 
    if it does then extract the data and give it in a json format like this : 
    {
      tokenSymbol : BTC,
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
        // Get fresh headers for each attempt
        const currentHeaders = await getNewHeaders();
        result = await makeInferenceRequest(broker, endpoint, currentHeaders, content, model);
        console.log(`Attempt ${retryCount + 1} result:`, result);

        // If we have a valid response, break the loop
        if (result?.choices?.[0]?.message?.content) {
          console.log("Success! Message:", result.choices[0].message.content);
          break;
        }

        // Handle fee settlement error
        if (result.error && result.error.includes('settleFee')) {
          const feeMatch = result.error.match(/expected ([\d.]+) A0GI/);
          if (feeMatch) {
            const expectedFee = Number(feeMatch[1]);
            console.log('Settling fee:', expectedFee);
            await broker.inference.settleFee(PROVIDER_ADDRESS, expectedFee);
            console.log('Fee settled successfully');
          }
        }

        // If we get here, either there was an error or no valid response
        console.log(`Attempt ${retryCount + 1} failed, retrying...`);
        retryCount++;

        // Add a small delay between retries
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

    console.log("Remaining balance in ledger", (await broker.ledger.getLedger()).ledgerInfo)

    // Process the response if needed
    // const valid = await broker.inference.processResponse(PROVIDER_ADDRESS, result, content);
    // console.log('Response validity:', valid ? 'Valid' : 'Invalid');

  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
  }
}

decentralizedStorageAndInference();