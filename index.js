async function startContinuousProcess(wallet, useProxy, wallets) {
  console.log(chalk.blue(`\n📌 Processing wallet: ${wallet}`));
  console.log(chalk.yellow('Press Ctrl+C to stop the script\n'));

  let cycleCount = 1;

  // Initialize progress for the wallet
  walletProgress[wallet] = 0;

  while (isRunning) {
    console.log(chalk.magenta(`\n🔄 Cycle #${cycleCount}`));
    console.log(chalk.dim('----------------------------------------'));

    for (const [agentId, agentName] of Object.entries(agents)) {
      if (!isRunning) break;
      
      console.log(chalk.magenta(`\n🤖 Using Agent: ${agentName}`));
      await processAgentCycle(wallet, agentId, agentName, useProxy);
      
      if (isRunning) {
        console.log(chalk.yellow(`⏳ Waiting ${rateLimitConfig.intervalBetweenCycles/1000} seconds before next interaction...`));
        await sleep(rateLimitConfig.intervalBetweenCycles);
      }
    }

    // Increment the cycle count for the current wallet
    walletProgress[wallet] += 1;

    // Check if the wallet has completed 20 cycles
    if (walletProgress[wallet] >= 3) {
      console.log(chalk.green(`🎉 Wallet ${wallet} has completed 20 cycles!`));
      walletsCompleted += 1;
      console.log(chalk.yellow(`⏳ Pausing wallet ${wallet} for 24 hours...`));
      
      // Reset cycle count for 24-hour pause
      walletProgress[wallet] = 0;
      
      // Pause for 24 hours before processing this wallet again
      await sleep(24 * 60 * 60 * 1000); // 24 hours
    }

    // Check if all wallets have completed their cycles
    if (walletsCompleted === wallets.length) {
      console.log(chalk.green(`🎉 All wallets have completed their 20 cycles! Pausing for 24 hours...`));
      break; // Exit the loop since all wallets are done
    }

    cycleCount++;
    console.log(chalk.dim('----------------------------------------'));
  }
}

// Main function updated to pass `wallets` into `startContinuousProcess`
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

  const walletMode = await askWalletMode();
  let wallets = [];

  if (walletMode == '1') {
    const wallet = await askWallet();
    wallets = [wallet];
  } else {
    wallets = loadWalletsFromFile();
  }

  const mode = await askMode();

  loadProxiesFromFile();

  for (const wallet of wallets) {
    await startContinuousProcess(wallet, mode == '2', wallets);  // Pass `wallets` here
  }
}

main();
