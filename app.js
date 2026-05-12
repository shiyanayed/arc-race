/* ========================================
   ARC RACE – App Controller
   Web3 wallet, USDC payments, leaderboard
   ======================================== */

(() => {
  'use strict';

  // ─── Arc Testnet Config ───
  const ARC_CHAIN_ID = 5042002;
  const ARC_CHAIN_HEX = '0x' + ARC_CHAIN_ID.toString(16);
  const ARC_RPC = 'https://rpc.testnet.arc.network';
  const ARC_EXPLORER = 'https://testnet.arcscan.app';
  const ARC_NAME = 'Arc Testnet';
  const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
  const USDC_DECIMALS = 6;
  const ENTRY_FEE = '100000'; // 0.1 USDC = 100000 (6 decimals)
  // Recipient for fees – using a burn-style address for testnet demo
  const FEE_RECIPIENT = '0x000000000000000000000000000000000000dEaD';
  const CREATOR_CONTRACT_ADDRESS = '0x11233E683324F98e51357726102817B72d5Bba5d';
  const CREATOR_CONTRACT_ABI = [
    'function registerCreator() public',
    'function registerCreator(address creator) public',
    'function isCreator(address account) view returns (bool)',
    'function creator(address account) view returns (bool)',
  ];

  // ERC-20 ABI fragments
  const ERC20_ABI = [
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address account) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)'
  ];

  // ─── State ───
  let provider = null;
  let signer = null;
  let userAddress = null;
  let isCorrectNetwork = false;
  let networkCheckInterval = null;
  let lastGameResult = null;

  // Leaderboard storage key
  const LB_KEY = 'arcrace_leaderboard_v2';
  const CHECKIN_KEY = 'arcrace_checkin_';
  const STATS_KEY = 'arcrace_stats';

  // ─── DOM Refs ───
  const $ = id => document.getElementById(id);

  const els = {
    toast: $('toast'),
    networkBanner: $('network-banner'),
    btnSwitchNetwork: $('btn-switch-network'),
    btnConnect: $('btn-connect'),
    walletInfo: $('wallet-info'),
    networkDot: $('network-dot'),
    walletAddr: $('wallet-address-display'),
    usdcBal: $('usdc-balance-display'),
    btnPlay: $('btn-play'),
    btnCheckin: $('btn-checkin'),
    checkinStatus: $('checkin-status'),
    gameOverlay: $('game-overlay'),
    gameCanvas: $('gameCanvas'),
    hudPosition: $('hud-position'),
    hudProgress: $('hud-progress'),
    hudDist: $('hud-dist'),
    hudSpeed: $('hud-speed'),
    energyBar: $('energy-bar'),
    btnExitGame: $('btn-exit-game'),
    networkPause: $('network-pause-overlay'),
    btnPauseSwitch: $('btn-pause-switch'),
    endModal: $('end-modal'),
    endIcon: $('end-modal-icon'),
    endTitle: $('end-modal-title'),
    resultPos: $('result-position'),
    resultScore: $('result-score'),
    resultTime: $('result-time'),
    resultEnergy: $('result-energy'),
    podium: $('race-podium'),
    btnSubmitScore: $('btn-submit-score'),
    btnRegisterCreator: $('btn-register-creator'),
    btnPlayAgain: $('btn-play-again'),
    btnCloseModal: $('btn-close-modal'),
    paymentModal: $('payment-modal'),
    paymentTitle: $('payment-modal-title'),
    paymentStatusText: $('payment-status-text'),
    paymentTxLink: $('payment-tx-link'),
    leaderboardBody: $('leaderboard-body'),
    btnRefreshLb: $('btn-refresh-lb'),
    statPlayers: $('stat-players'),
    statUsdc: $('stat-usdc'),
    statCheckins: $('stat-checkins'),
  };

  // ─── Toast ───
  function showToast(msg, type = '') {
    els.toast.textContent = msg;
    els.toast.className = 'toast show ' + type;
    setTimeout(() => { els.toast.className = 'toast'; }, 3500);
  }

  // ─── Network Validation ───
  async function checkNetwork() {
    if (!provider) return;
    try {
      const network = await provider.getNetwork();
      const correct = network.chainId === ARC_CHAIN_ID;
      setNetworkState(correct);
    } catch {
      setNetworkState(false);
    }
  }

  function setNetworkState(correct) {
    isCorrectNetwork = correct;
    if (correct) {
      els.networkBanner.classList.add('hidden');
      els.networkDot.classList.remove('wrong');
      if (userAddress) {
        enableGameButtons();
        updateCreatorButtonState();
      }
      // Resume game if paused
      if (ArcGame.getState() === 'paused') {
        els.networkPause.classList.add('hidden');
        ArcGame.resume();
      }
    } else {
      els.networkBanner.classList.remove('hidden');
      els.networkDot.classList.add('wrong');
      disableGameButtons();
      if (els.btnRegisterCreator) els.btnRegisterCreator.disabled = true;
      // Pause game if running
      if (ArcGame.getState() === 'running') {
        ArcGame.pause();
        els.networkPause.classList.remove('hidden');
      }
    }
  }

  function enableGameButtons() {
    els.btnPlay.classList.remove('disabled');
    els.btnPlay.disabled = false;
    els.btnCheckin.classList.remove('disabled');
    els.btnCheckin.disabled = false;
    updateCheckinUI();
  }

  function disableGameButtons() {
    els.btnPlay.classList.add('disabled');
    els.btnPlay.disabled = true;
    els.btnCheckin.classList.add('disabled');
    els.btnCheckin.disabled = true;
  }

  // ─── Switch Network ───
  async function switchToArc() {
    if (!window.ethereum) return showToast('No wallet detected', 'error');
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: ARC_CHAIN_HEX }],
      });
    } catch (err) {
      if (err.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: ARC_CHAIN_HEX,
              chainName: ARC_NAME,
              nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
              rpcUrls: [ARC_RPC],
              blockExplorerUrls: [ARC_EXPLORER],
            }],
          });
        } catch {
          showToast('Failed to add Arc Testnet', 'error');
        }
      } else {
        showToast('Failed to switch network', 'error');
      }
    }
  }

  // ─── Connect Wallet ───
  async function connectWallet() {
    if (!window.ethereum) {
      showToast('Please install MetaMask or an EVM wallet', 'error');
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (!accounts.length) return;

      provider = new ethers.providers.Web3Provider(window.ethereum);
      signer = provider.getSigner();
      userAddress = accounts[0];

      // Show wallet info
      els.walletAddr.textContent = userAddress.slice(0, 6) + '...' + userAddress.slice(-4);
      els.walletInfo.classList.remove('hidden');
      els.btnConnect.innerHTML = '<span class="btn-connect-icon">✓</span> Connected';
      els.btnConnect.classList.add('connected');

      // Check network
      await checkNetwork();

      // Fetch USDC balance
      await updateBalance();
      updateCreatorButtonState();

      // Start continuous network check
      if (networkCheckInterval) clearInterval(networkCheckInterval);
      networkCheckInterval = setInterval(checkNetwork, 3000);

      // Listen for chain/account changes
      window.ethereum.on('chainChanged', () => {
        provider = new ethers.providers.Web3Provider(window.ethereum);
        signer = provider.getSigner();
        checkNetwork();
        updateBalance();
      });
      window.ethereum.on('accountsChanged', (accs) => {
        if (!accs.length) {
          disconnectWallet();
          return;
        }
        userAddress = accs[0];
        els.walletAddr.textContent = userAddress.slice(0, 6) + '...' + userAddress.slice(-4);
        provider = new ethers.providers.Web3Provider(window.ethereum);
        signer = provider.getSigner();
        updateBalance();
      });

      showToast('Wallet connected!', 'success');
    } catch (err) {
      showToast('Connection failed: ' + (err.message || err), 'error');
    }
  }

  function disconnectWallet() {
    userAddress = null;
    provider = null;
    signer = null;
    isCorrectNetwork = false;
    els.walletInfo.classList.add('hidden');
    els.btnConnect.innerHTML = '<span class="btn-connect-icon">🔗</span> Connect Wallet';
    els.btnConnect.classList.remove('connected');
    if (els.btnRegisterCreator) {
      els.btnRegisterCreator.classList.add('hidden');
      els.btnRegisterCreator.disabled = true;
    }
    disableGameButtons();
    if (networkCheckInterval) clearInterval(networkCheckInterval);
    els.networkBanner.classList.add('hidden');
  }

  // ─── USDC Balance ───
  async function updateBalance() {
    if (!provider || !userAddress || !isCorrectNetwork) {
      els.usdcBal.textContent = '';
      return;
    }
    try {
      const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
      const bal = await usdc.balanceOf(userAddress);
      const formatted = ethers.utils.formatUnits(bal, USDC_DECIMALS);
      els.usdcBal.textContent = parseFloat(formatted).toFixed(2) + ' USDC';
    } catch {
      els.usdcBal.textContent = '— USDC';
    }
  }

  async function updateCreatorButtonState() {
    if (!els.btnRegisterCreator) return;
    if (!userAddress) {
      els.btnRegisterCreator.classList.add('hidden');
      els.btnRegisterCreator.disabled = true;
      return;
    }
    els.btnRegisterCreator.classList.remove('hidden');
    els.btnRegisterCreator.disabled = !isCorrectNetwork;
  }

  async function registerCreator() {
    if (!signer || !userAddress || !isCorrectNetwork) {
      showToast('Connect wallet to Arc Testnet first', 'error');
      return;
    }

    const contract = new ethers.Contract(CREATOR_CONTRACT_ADDRESS, CREATOR_CONTRACT_ABI, signer);
    let tx;

    try {
      if (typeof contract['registerCreator()'] === 'function') {
        tx = await contract['registerCreator()']();
      } else if (typeof contract['registerCreator(address)'] === 'function') {
        tx = await contract['registerCreator(address)'](userAddress);
      } else {
        tx = await contract.registerCreator(userAddress);
      }

      showToast('Submitting creator registration...', 'success');
      await tx.wait();
      showToast('Creator registration confirmed!', 'success');
    } catch (err) {
      const msg = err?.reason || err?.message || 'Registration failed';
      showToast(msg.length > 100 ? msg.slice(0, 100) + '...' : msg, 'error');
    }
  }

  // ─── USDC Payment ───
  async function payUSDC(purpose) {
    if (!signer || !isCorrectNetwork) {
      showToast('Connect wallet to Arc Testnet first', 'error');
      return false;
    }

    // Show payment modal
    els.paymentTitle.textContent = purpose;
    els.paymentStatusText.textContent = 'Waiting for wallet confirmation...';
    els.paymentTxLink.classList.add('hidden');
    els.paymentModal.classList.remove('hidden');

    try {
      const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
      els.paymentStatusText.textContent = 'Confirm transaction in wallet...';

      const tx = await usdc.transfer(FEE_RECIPIENT, ENTRY_FEE);
      els.paymentStatusText.textContent = 'Transaction submitted, confirming...';
      els.paymentTxLink.innerHTML = `<a href="${ARC_EXPLORER}/tx/${tx.hash}" target="_blank">View on Explorer ↗</a>`;
      els.paymentTxLink.classList.remove('hidden');

      await tx.wait();
      els.paymentStatusText.textContent = '✅ Payment confirmed!';

      // Update stats
      incrementStat('usdc', 0.1);

      setTimeout(() => { els.paymentModal.classList.add('hidden'); }, 1200);
      await updateBalance();
      return true;
    } catch (err) {
      els.paymentModal.classList.add('hidden');
      const msg = err?.reason || err?.message || 'Transaction failed';
      showToast(msg.length > 80 ? msg.slice(0, 80) + '...' : msg, 'error');
      return false;
    }
  }

  // ─── Play Game Flow ───
  async function handlePlay() {
    if (!userAddress || !isCorrectNetwork) {
      showToast('Connect wallet to Arc Testnet first', 'error');
      return;
    }

    const paid = await payUSDC('Game Entry Fee');
    if (!paid) return;

    showToast('Payment confirmed! Starting race...', 'success');

    // Show game overlay
    els.gameOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Initialize and start game
    ArcGame.init(els.gameCanvas, onHudUpdate, onGameEnd);
    ArcGame.startRace();

    incrementStat('players', 1);
  }

  function onHudUpdate(data) {
    const posLabels = ['1st', '2nd', '3rd', '4th'];
    els.hudPosition.textContent = posLabels[data.position - 1] || data.position;
    els.hudProgress.style.width = data.progress + '%';
    els.hudDist.textContent = Math.round(data.progress) + '%';
    els.hudSpeed.textContent = data.speed + 'x';
    els.energyBar.style.width = (data.energy / data.maxEnergy * 100) + '%';

    // Color the position
    if (data.position === 1) els.hudPosition.style.color = '#fbbf24';
    else if (data.position === 2) els.hudPosition.style.color = '#cbd5e1';
    else els.hudPosition.style.color = '#00ffff';
  }

  function onGameEnd(results) {
    lastGameResult = results;

    // Close game overlay
    els.gameOverlay.classList.add('hidden');
    document.body.style.overflow = '';

    // Show end modal
    const posLabels = ['🥇 1st Place!', '🥈 2nd Place', '🥉 3rd Place', '4th Place'];
    const icons = ['🏆', '🥈', '🥉', '🏁'];

    els.endIcon.textContent = icons[results.position - 1] || '🏁';
    els.endTitle.textContent = posLabels[results.position - 1] || 'RACE OVER';
    els.resultPos.textContent = results.position + getSuffix(results.position);
    els.resultScore.textContent = results.score + ' pts';
    els.resultTime.textContent = results.time + 's';
    els.resultEnergy.textContent = results.energyCollected;

    // Podium
    els.podium.innerHTML = '';
    const rankClasses = ['gold', 'silver', 'bronze', 'fourth'];
    for (const p of results.podium) {
      const div = document.createElement('div');
      div.className = 'podium-item ' + rankClasses[p.rank - 1] + (p.isPlayer ? ' you' : '');
      div.innerHTML = `<div class="podium-rank">${p.rank}${getSuffix(p.rank)}</div><div class="podium-name">${p.name}</div>`;
      els.podium.appendChild(div);
    }

    els.endModal.classList.remove('hidden');
  }

  function getSuffix(n) {
    if (n === 1) return 'st';
    if (n === 2) return 'nd';
    if (n === 3) return 'rd';
    return 'th';
  }

  // ─── Submit Score ───
  async function handleSubmitScore() {
    if (!lastGameResult) return;
    if (!userAddress || !isCorrectNetwork) {
      showToast('Connect wallet to Arc Testnet first', 'error');
      return;
    }

    els.btnSubmitScore.disabled = true;
    const paid = await payUSDC('Score Submission');
    if (!paid) {
      els.btnSubmitScore.disabled = false;
      return;
    }

    // Save to leaderboard
    addToLeaderboard(userAddress, lastGameResult.score, lastGameResult.position);
    renderLeaderboard();
    showToast('Score submitted to leaderboard!', 'success');
    els.endModal.classList.add('hidden');
    els.btnSubmitScore.disabled = false;
    lastGameResult = null;
  }

  // ─── Daily Check-In ───
  async function handleCheckin() {
    if (!userAddress || !isCorrectNetwork) {
      showToast('Connect wallet to Arc Testnet first', 'error');
      return;
    }

    const key = CHECKIN_KEY + userAddress.toLowerCase();
    const lastCheckin = localStorage.getItem(key);
    if (lastCheckin) {
      const diff = Date.now() - parseInt(lastCheckin);
      const hours24 = 24 * 60 * 60 * 1000;
      if (diff < hours24) {
        const remaining = hours24 - diff;
        const h = Math.floor(remaining / 3600000);
        const m = Math.floor((remaining % 3600000) / 60000);
        showToast(`Next check-in available in ${h}h ${m}m`, 'error');
        return;
      }
    }

    els.btnCheckin.disabled = true;
    const paid = await payUSDC('Daily Check-In');
    if (!paid) {
      els.btnCheckin.disabled = false;
      return;
    }

    // Record check-in
    localStorage.setItem(key, Date.now().toString());
    addToLeaderboard(userAddress, 20, null); // 20 bonus points
    incrementStat('checkins', 1);
    renderLeaderboard();
    updateCheckinUI();
    showToast('Daily check-in complete! +20 points', 'success');
    els.btnCheckin.disabled = false;
  }

  function updateCheckinUI() {
    if (!userAddress) {
      els.checkinStatus.classList.add('hidden');
      return;
    }
    const key = CHECKIN_KEY + userAddress.toLowerCase();
    const lastCheckin = localStorage.getItem(key);
    if (lastCheckin) {
      const diff = Date.now() - parseInt(lastCheckin);
      const hours24 = 24 * 60 * 60 * 1000;
      if (diff < hours24) {
        const remaining = hours24 - diff;
        const h = Math.floor(remaining / 3600000);
        const m = Math.floor((remaining % 3600000) / 60000);
        els.checkinStatus.textContent = `⏳ Next check-in in ${h}h ${m}m`;
        els.checkinStatus.classList.remove('hidden');
        return;
      }
    }
    els.checkinStatus.textContent = '✅ Check-in available now!';
    els.checkinStatus.classList.remove('hidden');
  }

  // ─── Leaderboard (localStorage) ───
  function getLeaderboard() {
    try {
      return JSON.parse(localStorage.getItem(LB_KEY)) || [];
    } catch { return []; }
  }

  function addToLeaderboard(wallet, score, position) {
    const lb = getLeaderboard();
    const existing = lb.find(e => e.wallet.toLowerCase() === wallet.toLowerCase());
    if (existing) {
      existing.score += score;
      existing.races = (existing.races || 0) + (position !== null ? 1 : 0);
      if (position !== null && (existing.bestPos === null || position < existing.bestPos)) {
        existing.bestPos = position;
      }
    } else {
      lb.push({
        wallet,
        score,
        races: position !== null ? 1 : 0,
        bestPos: position,
      });
    }
    lb.sort((a, b) => b.score - a.score);
    localStorage.setItem(LB_KEY, JSON.stringify(lb.slice(0, 50)));
  }

  function renderLeaderboard() {
    const lb = getLeaderboard();
    if (!lb.length) {
      els.leaderboardBody.innerHTML = '<tr><td colspan="5" class="lb-empty">No entries yet. Be the first to race!</td></tr>';
      return;
    }

    const rankClasses = { 1: 'rank-1', 2: 'rank-2', 3: 'rank-3' };
    const posLabels = { 1: '🥇', 2: '🥈', 3: '🥉' };

    els.leaderboardBody.innerHTML = lb.slice(0, 20).map((e, i) => {
      const rank = i + 1;
      const cls = rankClasses[rank] || '';
      const addr = e.wallet.slice(0, 6) + '...' + e.wallet.slice(-4);
      const isMe = userAddress && e.wallet.toLowerCase() === userAddress.toLowerCase();
      const highlight = isMe ? 'style="background:rgba(0,255,255,0.04)"' : '';
      const posText = posLabels[rank] || rank;
      const bestPos = e.bestPos ? e.bestPos + getSuffix(e.bestPos) : '—';

      return `<tr ${highlight}>
        <td class="${cls}">${posText}</td>
        <td>${addr}${isMe ? ' <span style="color:#00ffff;font-size:10px">(you)</span>' : ''}</td>
        <td class="${cls}" style="font-weight:700">${e.score}</td>
        <td>${e.races || 0}</td>
        <td>${bestPos}</td>
      </tr>`;
    }).join('');
  }

  // ─── Stats ───
  function getStats() {
    try { return JSON.parse(localStorage.getItem(STATS_KEY)) || { players: 0, usdc: 0, checkins: 0 }; }
    catch { return { players: 0, usdc: 0, checkins: 0 }; }
  }

  function incrementStat(key, value) {
    const stats = getStats();
    stats[key] = (stats[key] || 0) + value;
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    renderStats();
  }

  function renderStats() {
    const stats = getStats();
    els.statPlayers.textContent = stats.players || 0;
    els.statUsdc.textContent = (stats.usdc || 0).toFixed(1);
    els.statCheckins.textContent = stats.checkins || 0;
  }

  // ─── Exit Game ───
  function exitGame() {
    ArcGame.stop();
    els.gameOverlay.classList.add('hidden');
    els.networkPause.classList.add('hidden');
    document.body.style.overflow = '';
  }

  // ─── Event Bindings ───
  function bindEvents() {
    els.btnConnect.addEventListener('click', () => {
      if (userAddress) {
        disconnectWallet();
        showToast('Wallet disconnected');
      } else {
        connectWallet();
      }
    });

    els.btnSwitchNetwork.addEventListener('click', switchToArc);
    els.btnPauseSwitch.addEventListener('click', switchToArc);
    els.btnPlay.addEventListener('click', handlePlay);
    els.btnCheckin.addEventListener('click', handleCheckin);
    els.btnExitGame.addEventListener('click', exitGame);
    els.btnRegisterCreator.addEventListener('click', registerCreator);
    els.btnSubmitScore.addEventListener('click', handleSubmitScore);

    els.btnPlayAgain.addEventListener('click', () => {
      els.endModal.classList.add('hidden');
      lastGameResult = null;
      handlePlay();
    });

    els.btnCloseModal.addEventListener('click', () => {
      els.endModal.classList.add('hidden');
      lastGameResult = null;
    });

    els.btnRefreshLb.addEventListener('click', renderLeaderboard);

    // Canvas resize on window resize
    window.addEventListener('resize', () => {
      if (ArcGame.getState() !== 'idle') ArcGame.resize();
    });
  }

  // ─── Init ───
  function init() {
    bindEvents();
    renderLeaderboard();
    renderStats();

    // Start preview animation
    const previewCanvas = document.getElementById('previewCanvas');
    if (previewCanvas) ArcGame.startPreview(previewCanvas);

    // Update checkin timer every minute
    setInterval(() => {
      if (userAddress) updateCheckinUI();
    }, 60000);
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
