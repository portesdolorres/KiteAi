import chalk from 'chalk';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createInterface } from 'readline';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent } from 'http-proxy-agent';
import axios from 'axios';
import fs from 'fs';
import { banner } from './banner.js';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const readline = createInterface({
  input: process.stdin,
  output: process.stdout
});

// Rate Limiting Configuration
const rateLimitConfig = {
  maxRetries: 5,
  baseDelay: 2000,
  maxDelay: 10000,
  requestsPerMinute: 15,
  intervalBetweenCycles: 15000,
  walletVerificationRetries: 3
};

let lastRequestTime = Date.now();
let isRunning = true;
let globalCycleCount = 1; // Global cycle count

const agents = {
  "deployment_p5J9lz1Zxe7CYEoo0TZpRVay": "Professor 🧠",
};

const proxyConfig = {
  enabled: false,
  current: 'direct',
  proxies: []
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const calculateDelay = (attempt) => {
  return Math.min(
    rateLimitConfig.maxDelay,
    rateLimitConfig.baseDelay * Math.pow(2, attempt)
  );
};

const walletProgress = []; // Array to track progress for each wallet

// Function to update the table and display wallet progress
function updateWalletTable() {
  console.clear();
  console.table(walletProgress);
}

// Function to display table header with current wallet progress
function displayWalletProgress(wallet) {
  const progress = wallet.cyclesCompleted / 20 * 100; // Calculate the percentage of progress

  // Build a table row for this wallet
  const progressRow = {
    "Wallet Address": wallet.address,
    "Cycles Completed": `${wallet.cyclesCompleted} / 20`,
    "Current Agent": wallet.currentAgent || 'None',
    "Status": wallet.status,
    "Progress": `${Math.round(progress)}% [${'█'.repeat(Math.floor(progress / 10))}${'-'.repeat(10 - Math.floor(progress / 10))}]`
  };

  walletProgress.push(progressRow);
  updateWalletTable(); // Update the table display
}

async function sendRandomQuestion(agent, axiosInstance) {
  try {
    await checkRateLimit();

    const randomQuestions = JSON.parse(fs.readFileSync('questions.json', 'utf-8'));
    const randomQuestion = randomQuestions[Math.floor(Math.random() * randomQuestions.length)];

    const payload = { message: randomQuestion, stream: false };
    const response = await axiosInstance.post(
      `https://${agent.toLowerCase().replace('_','-')}.stag-vxzy.zettablock.com/main`,
      payload
    );

    return { question: randomQuestion, response: response.data.choices[0].message };
  } catch (error) {
    console.error(chalk.red('⚠️ Error:'), error.response ? error.response.data : error.message);
    return null;
  }
}

async function reportUsage(wallet, options, retryCount = 0) {
  try {
    await checkRateLimit();

    const payload = {
      wallet_address: wallet,
      agent_id: options.agent_id,
      request_text: options.question,
      response_text: options.response,
      request_metadata: {}
    };

    await axios.post(`https://quests-usage-dev.prod.zettablock.com/api/report_usage`, payload, {
      headers: { 'Content-Type': 'application/json' }
    });

    console.log(chalk.green('✅ Usage data reported successfully!\n'));
  } catch (error) {
    console.log(chalk.yellow('⚠️ Usage report issue, continuing execution...'));
  }
}

async function processAgentCycle(wallet, agentId, agentName, useProxy) {
  try {
    const proxy = useProxy ? getNextProxy() : null;
    const axiosInstance = createAxiosInstance(proxy);

    if (proxy) {
      console.log(chalk.blue(`🌐 Using proxy: ${proxy}`));
    }

    const nanya = await sendRandomQuestion(agentId, axiosInstance);

    if (nanya) {
      console.log(chalk.cyan('❓ Question:'), chalk.bold(nanya.question));
      console.log(chalk.green('💡 Answer:'), chalk.italic(nanya?.response?.content ?? 'No answer'));

      await reportUsage(wallet, {
        agent_id: agentId,
        question: nanya.question,
        response: nanya?.response?.content ?? 'No answer'
      });
    }
  } catch (error) {
    console.error(chalk.red('⚠️ Error in agent cycle:'), error.message);
  }
}

async function startContinuousProcess(wallet, useProxy) {
  console.log(chalk.blue(`\n📌 Processing wallet: ${wallet}`));
  console.log(chalk.yellow('Press Ctrl+C to stop the script\n'));

  // Initialize wallet progress
  const walletInfo = {
    address: wallet,
    cyclesCompleted: 0,
    status: 'Running',
    currentAgent: null
  };
  walletProgress.push(walletInfo); // Add new wallet to the progress tracking

  let cycleCount = 0; // Track individual wallet cycle count

  while (isRunning) {
    // Check if 20 cycles have been completed for the current wallet
    if (cycleCount >= 20) {
      console.log(chalk.yellow(`\n🔒 Wallet ${wallet} has completed 20 cycles! Pausing for 24 hours...`));
      await sleep(86400000); // Sleep for 24 hours (86400000 ms)
      cycleCount = 0; // Reset cycle count after 24 hours
      walletInfo.status = 'Paused (24 hours)';
      updateWalletTable(); // Update the table
      console.log(chalk.green(`✅ Wallet ${wallet} is resuming after 24 hours.`));
    }

    // Start processing the current cycle
    console.log(chalk.magenta(`\n🔄 Wallet Cycle #${cycleCount + 1}`));
    console.log(chalk.dim('----------------------------------------'));

    // Process agents for the current wallet concurrently
    const agentPromises = Object.entries(agents).map(async ([agentId, agentName]) => {
      if (!isRunning) return;

      walletInfo.currentAgent = agentName; // Set current agent
      displayWalletProgress(walletInfo); // Update wallet progress in the table

      await processAgentCycle(wallet, agentId, agentName, useProxy);
    });

    // Wait for all agents to finish for the current wallet
    await Promise.all(agentPromises);

    cycleCount++; // Increment the cycle count for the wallet
    walletInfo.cyclesCompleted++; // Increment the cycle count for the wallet

    // Update progress for the wallet in the table
    displayWalletProgress(walletInfo);
  }
}

async function main() {
  displayAppTitle();

  const askMode = () => {
    return new Promise((resolve) => {
      readline.question(chalk.yellow('🔄 Choose connection mode (1: Direct, 2: Proxy): '), resolve);
    });
  };

  const askWalletMode = () => {
    return new Promise((resolve) => {
      console.log(chalk.yellow('\n📋 Choose wallet mode:'));
      console.log(chalk.yellow('1. Manual input'));
      console.log(chalk.yellow('2. Load from wallets.txt'));
      readline.question(chalk.yellow('\nYour choice: '), resolve);
    });
  };

  const askWallet = () => {
    return new Promise((resolve) => {
      readline.question(chalk.yellow('🔑 Enter wallet address: '), resolve);
    });
  };

  try {
    const mode = await askMode();
    proxyConfig.enabled = mode === '2';
    
    if (proxyConfig.enabled) {
      loadProxiesFromFile();
    }
    
    const walletMode = await askWalletMode();
    let wallets = [];
    
    if (walletMode === '2') {
      wallets = loadWalletsFromFile();
      if (wallets.length === 0) {
        console.log(chalk.red('❌ No wallets loaded. Stopping program.'));
        readline.close();
        return;
      }
    } else {
      const wallet = await askWallet();
      wallets = [wallet.toLowerCase()];
    }

    // Process each wallet concurrently
    const walletPromises = wallets.map(wallet => startContinuousProcess(wallet, proxyConfig.enabled));
    
    await Promise.all(walletPromises); // Wait for all wallet processing to finish
    
  } catch (error) {
    console.error(chalk.red('⚠️ An error occurred:'), error);
    readline.close();
  }
}

main();
