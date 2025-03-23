import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";
import { ethers } from "ethers";
import express from "express";
import dotenv from "dotenv";
import cors from 'cors';

// Load environment variables from .env file
dotenv.config();

// Configuration
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = "https://evmrpc-testnet.0g.ai";
const PROVIDER_ADDRESS = "0x3feE5a4dd5FDb8a32dDA97Bed899830605dBD9D3";

// Function to make the inference request
async function makeInferenceRequest(endpoint, headers, content, model) {
    const response = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ messages: [{ role: "system", content }], model }),
    });
    return await response.json();
}

// Function to perform inference with the provided message
async function performInference(broker, message) {
    const content = `Extract trading signal data from the given message.  
    Return only a valid JSON object with no additional text, markdown, or explanations. Do not include \`\`\`json or any other formatting.  
    
    {
      "tokenSymbol": "BTC",
      "signal": "buy",
      "tp1": 1000,
      "tp2": 2000,
      "sl": 800
    }
    
    ${message}`;

    // Get service metadata
    const { endpoint, model } = await broker.inference.getServiceMetadata(PROVIDER_ADDRESS);
    console.log("Endpoint:", endpoint, "Model:", model);

    let maxRetries = 5;
    let retryCount = 0;
    let result;

    // Retry logic for inference request
    while (retryCount < maxRetries) {
        try {
            const headers = await broker.inference.getRequestHeaders(PROVIDER_ADDRESS, content);
            result = await makeInferenceRequest(endpoint, headers, content, model);
            console.log(`Attempt ${retryCount + 1} result:`, result);

            // Check for a valid response
            if (result?.choices?.[0]?.message?.content) {
                console.log("Success! Message:", result.choices[0].message.content);
                return result.choices[0].message.content;
            }

            // Handle fee settlement if required
            if (result.error && result.error.includes("settleFee")) {
                const feeMatch = result.error.match(/expected ([\d.]+) A0GI/);
                if (feeMatch) {
                    const expectedFee = Number(feeMatch[1]);
                    console.log("Settling fee:", expectedFee);
                    await broker.inference.settleFee(PROVIDER_ADDRESS, expectedFee);
                    console.log("Fee settled successfully");
                }
            }

            console.log(`Attempt ${retryCount + 1} failed, retrying...`);
            retryCount++;
            await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
            console.error(`Error on attempt ${retryCount + 1}:`, error);
            retryCount++;
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }

    throw new Error(`Failed to get valid response after ${maxRetries} attempts`);
}

// Function to initialize the wallet, provider, and broker
async function initialize() {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const broker = await createZGComputeNetworkBroker(wallet);
    console.log("Inference Broker initialized");

    const initialBalance = 0.05;
    try {
        const existingBalance = await broker.ledger.getLedger();
        console.log("Using existing ledger with balance:", existingBalance);
    } catch (error) {
        console.log("No existing ledger found. Creating new ledger...");
        await broker.ledger.addLedger(initialBalance);
        console.log("New account created and funded with initial balance:", initialBalance);
    }

    return broker;
}

// Start the server
initialize()
    .then((broker) => {
        const app = express();

        app.use(cors());

        app.use(express.json());

        // API endpoint to process the message
        app.post("/infer", async (req, res) => {
            const { message } = req.body;
            if (!message) {
                return res.status(400).json({ error: "Message is required" });
            }
            try {
                const result = await performInference(broker, message);
                res.json({ result });
            } catch (error) {
                console.error("Inference error:", error);
                res.status(500).json({ error: "Inference failed" });
            }
        });

        // New API endpoint for summarizing signals
        app.post("/api/summarize", async (req, res) => {
            const { averagePnl, signals } = req.body;

            // Validate input
            if (!averagePnl || !Array.isArray(signals)) {
                return res.status(400).json({ error: "averagePnl and signals (as an array) are required" });
            }

            // Refined prompt for the inference service
            const content = `Generate a JSON object with the following structure based on the provided trading signals data:

{
  "averagePnl": ${averagePnl},
  "insights": "Provide a concise summary of the performance of the tokens, highlighting key trends and notable performers."
}

Data:
- Average P&L: ${averagePnl}%
- Signals: ${signals.map(signal => `${signal.token}: ${signal.pnl}`).join(', ')}

Your response must be only the JSON object with the insights filled in appropriately. Do not include any additional text, explanations, or markdown.`;

            try {
                const result = await performInference(broker, content);

                // Parse the result to extract only the JSON object
                const jsonMatch = result.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const jsonString = jsonMatch[0];
                    try {
                        const parsedJson = JSON.parse(jsonString);
                        res.json(parsedJson);
                    } catch (error) {
                        console.error("Failed to parse JSON:", error);
                        res.status(500).json({ error: "Failed to parse summary" });
                    }
                } else {
                    res.status(500).json({ error: "No JSON found in response" });
                }
            } catch (error) {
                console.error("Summarization error:", error);
                res.status(500).json({ error: "Summarization failed" });
            }
        });

        const PORT = process.env.PORT || 3001;
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
        });
    })
    .catch((error) => {
        console.error("Initialization failed:", error);
    });