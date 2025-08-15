const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game state
const rooms = new Map();

// Card deck
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const VALUES = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SPECIAL_CARDS = {
  'A': 'skip',     // Eso - stojí se
  '7': 'draw2',    // Sedmička - bere se
  'Q': 'change_suit', // Svršek - mění barvu
  'J': 'change_value', // Spodek - mění hodnotu
  '10': 'reverse', // Desítka - otáčí směr hry (při 3+ hráčích)
  'K_spades': 'draw5' // Zelený král (listy) - bere se 5 karet
};

// Card point values for scoring
const CARD_POINTS = {
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  'J': 1,     // Spodek
  'K': 2,     // Král
  'Q': 20,    // Svršek
  'A': 11     // Eso
};

function getCardPoints(card) {
  // Zelený král (spades K) má 50 bodů
  if (card.value === 'K' && card.suit === 'spades') {
    return 50;
  }
  // Červený svršek (hearts Q) má 40 bodů
  if (card.value === 'Q' && card.suit === 'hearts') {
    return 40;
  }
  // Ostatní karty podle tabulky
  return CARD_POINTS[card.value] || 0;
}

function calculatePlayerScore(hand) {
  return hand.reduce((total, card) => total + getCardPoints(card), 0);
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const value of VALUES) {
      deck.push({ suit, value, id: uuidv4() });
    }
  }
  return shuffleDeck(deck);
}

function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

class GameRoom {
  constructor(roomId) {
    this.id = roomId;
    this.players = new Map();
    this.gameHistory = new Map(); // Sleduje celkové body hráčů napříč hrami
    this.gameStarter = null; // Kdo začal první hru (v místnosti)
    this.previousLosers = []; // ID hráčů, kteří prohráli minulou hru
    this.gameState = {
      started: false,
      deck: [],
      playedCards: [],
      currentPlayer: 0,
      direction: 1,
      drawStack: 0,
      currentSuit: null,
      currentValue: null, // Hodnota nastavená spodkem
      skipNext: false,
      lastPlayedWasSpecial: false, // Sleduje jestli předchozí karta byla eso/sedma/zelený král
      maxDrawStack: 10 // Max 10 karet při přebíjení (5 zelený král + 2+2+1 sedmy)
    };
    this.maxPlayers = 4;
  }

  addPlayer(playerId, playerName) {
    if (this.players.size >= this.maxPlayers) {
      return false;
    }

    this.players.set(playerId, {
      id: playerId,
      name: playerName,
      hand: [],
      connected: true
    });

    // Inicializuj historii hráče pokud neexistuje
    if (!this.gameHistory.has(playerId)) {
      this.gameHistory.set(playerId, {
        totalPoints: 0,
        gamesPlayed: 0,
        lastGamePoints: 0,
        name: playerName
      });
    }

    console.log(`➕ Hráč ${playerName} přidán do místnosti ${this.id}`);
    return true;
  }

  // Podrobné logování celého stavu hry
  logGameState(action = '') {
    console.log(`
🎮 ======== STAV HRY${action ? ` (${action})` : ''} ========`);
    
    // Základní info
    console.log(`🏠 Místnost: ${this.id}`);
    console.log(`▶️ Hra spuštěna: ${this.gameState.started ? 'ANO' : 'NE'}`);
    console.log(`🎯 Hráč na tahu: ${this.gameState.started ? this.players.get(Array.from(this.players.keys())[this.gameState.currentPlayer])?.name || 'NEZNÁMÝ' : 'nikdo'}`);
    console.log(`🔄 Směr: ${this.gameState.direction === 1 ? 'doprava →' : 'doleva ←'}`);
    
    // Balíček
    console.log(`
📦 Balíček (${this.gameState.deck.length} karet):`);
    if (this.gameState.deck.length > 0) {
      const deckCards = this.gameState.deck.map(c => `${c.value}${c.suit}`).join(', ');
      console.log(`   ${deckCards.length > 100 ? deckCards.substring(0, 100) + '...' : deckCards}`);
    } else {
      console.log(`   PRÁZDNÝ!`);
    }
    
    // Vrchní karta
    const topCard = this.gameState.playedCards[this.gameState.playedCards.length - 1];
    if (topCard) {
      console.log(`
🏆 Vrchní karta: ${topCard.value}${topCard.suit}`);
      console.log(`🎨 Aktuální barva: ${this.gameState.currentSuit || 'žádná'}`);
      console.log(`🔢 Aktuální hodnota: ${this.gameState.currentValue || 'žádná'}`);
      console.log(`📚 Draw stack: ${this.gameState.drawStack}`);
      console.log(`⭐ Posledním tahem byla speciální karta: ${this.gameState.lastPlayedWasSpecial ? 'ANO' : 'NE'}`);
    } else {
      console.log(`
🏆 Vrchní karta: ŽÁDNÁ`);
    }
    
    // Karty všech hráčů
    console.log(`
👥 KARTY VŠECH HRÁČŮ:`);
    for (const [playerId, player] of this.players) {
      const isCurrentPlayer = this.gameState.started && Array.from(this.players.keys())[this.gameState.currentPlayer] === playerId;
      const history = this.gameHistory.get(playerId);
      console.log(`   ${isCurrentPlayer ? '👉' : '  '} ${player.name} (${player.hand.length} karet): ${player.hand.map(c => `${c.value}${c.suit}`).join(', ')}`);
      if (history) {
        console.log(`      📊 Celkem: ${history.totalPoints}b, Minulá hra: ${history.lastGamePoints || 0}b, Her: ${history.gamesPlayed}`);
      }
    }
    
    // Co se musí/může hrát
    if (this.gameState.started && topCard) {
      console.log(`
🎯 PRAVIDLA PRO AKTUÁLNÍ TAH:`);
      if (this.gameState.drawStack > 0) {
        console.log(`   ⚠️ DRAW STACK ${this.gameState.drawStack} - musí se přebít nebo vzít karty!`);
        if (topCard.value === 'K' && topCard.suit === 'spades') {
          console.log(`   🤴 Zelený král lze přebít jen zelenou sedmičkou (7♠)`);
        } else if (topCard.value === '7' && topCard.suit === 'spades') {
          console.log(`   🃏 Zelenou sedmičku lze přebít jen zeleným králem (K♠)`);
        } else {
          console.log(`   🚫 Jiné sedmičky se nepřebíjí - musí si vzít karty`);
        }
      } else {
        console.log(`   ✅ Normální tah:`);
        console.log(`   - Barva: ${this.gameState.currentSuit || 'jakákoliv'}`);
        console.log(`   - Hodnota: ${this.gameState.currentValue || 'jakákoliv'}`);
        console.log(`   - Svršek (Q): ${this.gameState.lastPlayedWasSpecial && (topCard.value === 'A' || topCard.value === '7' || (topCard.value === 'K' && topCard.suit === 'spades')) ? 'NELZE na čerstvé speciální karty' : 'lze hrát'}`);
      }
    }
    
    console.log(`========================================
`);
  }  removePlayer(playerId) {
    this.players.delete(playerId);
    if (this.players.size === 0) {
      return true; // Room should be deleted
    }
    return false;
  }

  startGame(initiatorId) {
    if (this.players.size < 2) return false;
    
    this.gameState.deck = createDeck();
    this.gameState.playedCards = [];
    this.gameState.direction = 1;
    this.gameState.drawStack = 0;
    this.gameState.currentValue = null;
    this.gameState.skipNext = false;
    this.gameState.lastPlayedWasSpecial = false;
    
    // Vymaž výsledky z předchozí hry
    this.gameState.winner = null;
    this.gameState.gameResults = null;
    this.gameState.started = false; // Resetuj started flag
    
    console.log('🔄 Resetuji game state - winner a gameResults vynulovány');
    
    // Určení prvního hráče
    const playerIds = Array.from(this.players.keys());
    let firstPlayerId;
    
    if (!this.gameStarter) {
      // První hra v místnosti - začíná ten, kdo klikl na "new game"
      this.gameStarter = initiatorId;
      firstPlayerId = initiatorId;
      console.log(`🎮 První hra - začíná iniciátor: ${this.players.get(initiatorId)?.name}`);
    } else if (this.previousLosers.length > 0) {
      // Následující hry - začíná jeden z poražených z minulé hry
      const validLosers = this.previousLosers.filter(loserId => this.players.has(loserId));
      if (validLosers.length > 0) {
        // Pokud je více poražených, vyber náhodně
        firstPlayerId = validLosers[Math.floor(Math.random() * validLosers.length)];
        console.log(`🎮 Další hra - začíná poražený: ${this.players.get(firstPlayerId)?.name}`);
      } else {
        // Fallback - pokud žádný poražený není dostupný, začíná náhodný
        firstPlayerId = playerIds[0];
        console.log(`🎮 Fallback - začíná první hráč: ${this.players.get(firstPlayerId)?.name}`);
      }
    } else {
      // Fallback - pokud nejsou žádní poražení, začíná náhodný
      firstPlayerId = playerIds[0];
      console.log(`🎮 Fallback - žádní poražení, začíná první hráč: ${this.players.get(firstPlayerId)?.name}`);
    }
    
    // Nastav currentPlayer podle určeného prvního hráče
    this.gameState.currentPlayer = playerIds.indexOf(firstPlayerId);
    if (this.gameState.currentPlayer === -1) {
      // Pokud hráč není nalezen, nastav na 0
      this.gameState.currentPlayer = 0;
      console.log(`⚠️ Hráč ${firstPlayerId} nenalezen, začíná první v pořadí`);
    }
    
    // Deal cards to players - s ohledem na předchozí výsledky
    let gameOverDueToNoCards = false;
    let eliminatedPlayer = null;
    
    for (const playerId of playerIds) {
      this.players.get(playerId).hand = [];
      
      // Spočítej kolik karet má hráč dostat
      const history = this.gameHistory.get(playerId);
      let cardsToGet = 4; // Základní počet karet
      
      // Penalty se aplikuje pouze na hráče, kteří prohráli minulou hru (nejvíce bodů)
      if (history && history.lastGamePoints > 0 && this.previousLosers.includes(playerId)) {
        // Odečti kartu za každou započatou padesátku z bodů minulé hry
        const penaltyCards = Math.floor(history.lastGamePoints / 50);
        cardsToGet = Math.max(0, 5 - penaltyCards);
        
        console.log(`🃏 ${this.players.get(playerId).name}: ${history.lastGamePoints} bodů v minulé hře -> ${penaltyCards} penalty -> ${cardsToGet} karet`);
        
        // Pokud hráč nemůže dostat žádnou kartu, prohrává celou hru
        if (cardsToGet === 0) {
          console.log(`🚫 ELIMINACE: ${this.players.get(playerId).name} nemůže dostat žádnou kartu!`);
          gameOverDueToNoCards = true;
          eliminatedPlayer = playerId;
          break; // Ukončí for smyčku
        }
      }
      
      // Rozdej karty
      for (let i = 0; i < cardsToGet && this.gameState.deck.length > 0; i++) {
        this.players.get(playerId).hand.push(this.gameState.deck.pop());
      }
      
      console.log(`✅ ${this.players.get(playerId).name}: dostal ${this.players.get(playerId).hand.length} karet`);
    }
    
    console.log(`📋 Po rozdání karet - gameOverDueToNoCards: ${gameOverDueToNoCards}, eliminatedPlayer: ${eliminatedPlayer}`);
    
    // Pokud některý hráč nemůže dostat karty, hra končí
    if (gameOverDueToNoCards) {
      console.log(`📋 ELIMINACE SETUP:`);
      console.log(`- Eliminovaný hráč ID: ${eliminatedPlayer}`);
      console.log(`- Eliminovaný hráč název: ${eliminatedPlayer ? this.players.get(eliminatedPlayer)?.name : 'UNDEFINED'}`);
      
      this.gameState.winner = eliminatedPlayer;
      this.gameState.started = false;
      this.gameState.gameResults = this.calculateEliminationResults(eliminatedPlayer);
      console.log(`🏁 Hra končí - ${this.players.get(eliminatedPlayer)?.name || 'UNDEFINED'} nemůže dostat žádnou kartu!`);
      return true;
    }
    
    // Place first card (nesmí být eso, sedmička, svršek, spodek nebo zelený král)
    let firstCard;
    do {
      firstCard = this.gameState.deck.pop();
    } while (firstCard.value === 'A' || firstCard.value === '7' || firstCard.value === 'Q' || 
             firstCard.value === 'J' || (firstCard.value === 'K' && firstCard.suit === 'spades'));
    
    this.gameState.playedCards.push(firstCard);
    this.gameState.currentSuit = firstCard.suit;
    this.gameState.started = true;
    
    return true;
  }

  canPlayCard(playerId, card) {
    if (!this.gameState.started) return false;
    
    const playerIds = Array.from(this.players.keys());
    const currentPlayerId = playerIds[this.gameState.currentPlayer];
    
    if (playerId !== currentPlayerId) return false;
    
    const topCard = this.gameState.playedCards[this.gameState.playedCards.length - 1];
    const player = this.players.get(playerId);
    
    console.log('\n🎴 SERVER KONTROLA HRATELNOSTI:');
    console.log(`- Hráč: ${player.name}`);
    console.log(`- Hraje kartu: ${card.value} ${card.suit}`);
    console.log(`- Vrchní karta: ${topCard.value} ${topCard.suit}`);
    console.log(`- Aktuální barva: ${this.gameState.currentSuit}`);
    console.log(`- Aktuální hodnota: ${this.gameState.currentValue}`);
    console.log(`- Draw stack: ${this.gameState.drawStack}`);
    console.log(`- Last played was special: ${this.gameState.lastPlayedWasSpecial}`);
    console.log(`- Hráč má karty:`, player.hand.map(c => `${c.value}${c.suit}`).join(', '));
    
    // Pokud je draw stack > 0, musí se hrát speciální přebíjející karta nebo brát
    if (this.gameState.drawStack > 0) {
      // Zkontrolujeme, zda vrchní karta je zelený král
      if (topCard.value === 'K' && topCard.suit === 'spades') {
        // Zelený král lze přebít pouze zelenou sedmičkou
        const canPlay = card.value === '7' && card.suit === 'spades';
        console.log(`🤴 Zelený král na vrcholu, lze přebít jen zelenou sedmičkou: ${canPlay}`);
        return canPlay;
      } else if (topCard.value === '7' && topCard.suit === 'spades') {
        // Zelenou sedmičku lze přebít pouze zeleným králem
        const canPlay = card.value === 'K' && card.suit === 'spades';
        console.log(`🃏 Zelená sedmička na vrcholu, lze přebít jen zeleným králem: ${canPlay}`);
        return canPlay;
      } else {
        // Jiné sedmičky se nepřebíjí - musí si vzít karty
        console.log(`🔢 Draw stack > 0, nelze přebít - musí si vzít karty`);
        return false;
      }
    }
    
    // Svršek nelze dát na Eso, Sedmu nebo Zeleného krále (hned po jejich vyhození)
    if (card.value === 'Q') {
      // Pokud spodek nastavil hodnotu na něco JINÉHO než Svršek, nelze hrát
      if (this.gameState.currentValue && this.gameState.currentValue !== 'Q') {
        console.log('❌ Svršek nelze hrát když spodek nastavil jinou hodnotu - musí se respektovat nastavená hodnota');
        return false;
      }
      
      // Pokud spodek nastavil hodnotu na Svršek (Q), svršek lze hrát
      if (this.gameState.currentValue === 'Q') {
        console.log('✅ Svršek lze hrát - spodek nastavil hodnotu na Svršek');
        return true;
      }
      
      if (this.gameState.lastPlayedWasSpecial && 
          (topCard.value === 'A' || topCard.value === '7' || 
           (topCard.value === 'K' && topCard.suit === 'spades'))) {
        console.log('❌ Svršek nelze dát na čerstvé Eso/Sedmu/Zeleného krále');
        return false;
      }
      console.log('✅ Svršek lze hrát');
      return true;
    }

    // Spodek lze dát na cokoliv (jako svršek, ale mění hodnotu místo barvy)
    if (card.value === 'J') {
      // Pokud spodek nastavil hodnotu na něco JINÉHO než Spodek, nelze hrát jiný spodek
      if (this.gameState.currentValue && this.gameState.currentValue !== 'J') {
        console.log('❌ Spodek nelze hrát když jiný spodek nastavil jinou hodnotu - musí se respektovat nastavená hodnota');
        return false;
      }
      
      // Pokud spodek nastavil hodnotu na Spodek (J), další spodek lze hrát
      if (this.gameState.currentValue === 'J') {
        console.log('✅ Spodek lze hrát - předchozí spodek nastavil hodnotu na Spodek');
        return true;
      }
      
      console.log('✅ Spodek lze hrát na cokoliv');
      return true;
    }
    
    // Eso lze přebít dalším esem
    if (card.value === 'A' && topCard.value === 'A') {
      console.log('✅ Eso přebíjí eso');
      return true;
    }
    
    // Normální pravidla - barva nebo hodnota musí sedět
    const suitMatch = card.suit === this.gameState.currentSuit;
    const valueMatch = card.value === topCard.value;
    
    // Pokud byl zahrán spodek a nastavil hodnotu, POUZE hodnota se musí respektovat (ne barva!)
    if (this.gameState.currentValue) {
      const spodekValueMatch = card.value === this.gameState.currentValue;
      console.log('🃏 Spodek nastavil hodnotu - musí se respektovat!');
      console.log(`- Spodek hodnota sedí: ${spodekValueMatch} (${card.value} === ${this.gameState.currentValue})`);
      console.log(`- VÝSLEDEK: ${spodekValueMatch ? '✅ HRATELNÉ' : '❌ NEHRATELNÉ'}`);
      return spodekValueMatch;
    }
    
    // Normální pravidla (pouze když spodek nenastavil hodnotu)
    const canPlay = suitMatch || valueMatch;
    
    console.log('🎯 Normální pravidla:');
    console.log(`- Barva sedí: ${suitMatch} (${card.suit} === ${this.gameState.currentSuit})`);
    console.log(`- Hodnota sedí (svršek na svršek, apod.): ${valueMatch} (${card.value} === ${topCard.value})`);
    console.log(`- VÝSLEDEK: ${canPlay ? '✅ HRATELNÉ' : '❌ NEHRATELNÉ'}`);
    
    return canPlay;
  }

  playCard(playerId, cardId, newSuit = null, newValue = null) {
    const player = this.players.get(playerId);
    if (!player) return false;
    
    const cardIndex = player.hand.findIndex(card => card.id === cardId);
    if (cardIndex === -1) return false;
    
    const card = player.hand[cardIndex];
    
    console.log('\n🎯 === POKUS O ZAHRÁNÍ KARTY ===');
    console.log(`👤 Hráč: ${player.name} (${playerId})`);
    console.log(`🎴 Hraje kartu: ${card.value} ${card.suit}`);
    console.log(`📚 Hráč má karty:`, player.hand.map(c => `${c.value}${c.suit}`).join(', '));
    console.log(`🏆 Vrchní karta: ${this.gameState.playedCards[this.gameState.playedCards.length - 1].value} ${this.gameState.playedCards[this.gameState.playedCards.length - 1].suit}`);
    console.log(`🎨 Aktuální barva: ${this.gameState.currentSuit}`);
    console.log(`🔢 Aktuální hodnota: ${this.gameState.currentValue || 'žádná'}`);
    console.log(`📦 Draw stack: ${this.gameState.drawStack}`);
    console.log(`⭐ Last played was special: ${this.gameState.lastPlayedWasSpecial}`);
    
    // Vypiš všechny hráče a jejich karty
    console.log('\n👥 === STAV VŠECH HRÁČŮ ===');
    for (const [id, p] of this.players) {
      console.log(`${p.name} (${id === playerId ? 'HRAJE' : 'čeká'}): ${p.hand.map(c => `${c.value}${c.suit}`).join(', ')} [${p.hand.length} karet]`);
    }
    
    if (!this.canPlayCard(playerId, card)) {
      console.log('❌ KARTA NENÍ HRATELNÁ!');
      return false;
    }
    
    console.log('✅ KARTA JE HRATELNÁ - provádím tah...');
    
    // Remove card from player's hand
    player.hand.splice(cardIndex, 1);
    
    // Add card to played pile
    this.gameState.playedCards.push(card);
    
    // Reset lastPlayedWasSpecial flag and currentValue when not spodek
    this.gameState.lastPlayedWasSpecial = false;
    if (card.value !== 'J') {
      this.gameState.currentValue = null; // Reset hodnoty pokud nehraje spodek
    }
    
    // Handle special cards
    if (card.value === 'A') {
      // Eso - další hráč stojí
      this.gameState.skipNext = true;
      this.gameState.currentSuit = card.suit;
      this.gameState.lastPlayedWasSpecial = true;
    } else if (card.value === '7') {
      // Sedmička - přidá do draw stacku (max 8 karet)
      this.gameState.drawStack = Math.min(this.gameState.drawStack + 2, this.gameState.maxDrawStack);
      this.gameState.currentSuit = card.suit;
      this.gameState.lastPlayedWasSpecial = true;
      
      // Červená sedma vrací hráče do hry
      if (card.suit === 'hearts' || card.suit === 'diamonds') {
        this.checkForReturnToGame();
      }
    } else if (card.value === 'K' && card.suit === 'spades') {
      // Zelený král (listy) - přidá 5 karet do draw stacku
      this.gameState.drawStack = Math.min(this.gameState.drawStack + 5, this.gameState.maxDrawStack);
      this.gameState.currentSuit = card.suit;
      this.gameState.lastPlayedWasSpecial = true;
      console.log(`🤴 Zelený král zahrán! Draw stack: ${this.gameState.drawStack}`);
    } else if (card.value === '10' && this.players.size >= 3) {
      // Desítka - otáčí směr hry (pouze při 3+ hráčích)
      this.gameState.direction *= -1; // Otočí směr (1 -> -1 nebo -1 -> 1)
      this.gameState.currentSuit = card.suit;
      console.log(`🔄 Desítka zahrána! Směr hry otočen na: ${this.gameState.direction === 1 ? 'doprava' : 'doleva'}`);
    } else if (card.value === 'Q' && newSuit) {
      // Svršek - mění barvu (není speciální v tom smyslu že by blokoval další svršky)
      this.gameState.currentSuit = newSuit;
      this.gameState.lastPlayedWasSpecial = false;
    } else if (card.value === 'J' && newValue) {
      // Spodek - mění hodnotu, barva zůstává z předchozí karty
      // Validace že newValue je platná karta
      const validValues = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
      if (validValues.includes(newValue)) {
        this.gameState.currentValue = newValue;
        this.gameState.lastPlayedWasSpecial = false; // Spodek neresetuje speciální flag
        console.log(`🃏 Spodek zahrán! Nová hodnota: ${newValue}`);
      } else {
        console.log(`❌ Neplatná hodnota pro spodek: ${newValue}`);
        return false;
      }
    } else {
      // Normální karta
      this.gameState.currentSuit = card.suit;
    }
    
    // Check for win - hra končí pouze pokud je poslední karta svršek
    if (player.hand.length === 0) {
      if (card.value === 'Q') {
        // Výhra - poslední karta byla svršek
        this.gameState.winner = playerId;
        this.gameState.started = false;
        
        // Připrav data pro konec hry s body všech hráčů
        this.gameState.gameResults = this.calculateGameResults(playerId);
        
        console.log(`🎉 ${this.players.get(playerId).name} vyhrál se svrškem jako poslední kartou!`);
        return true;
      } else {
        // Poslední karta nebyla svršek - hráč si bude muset vzít kartu až když bude na řadě
        console.log(`⚠️ ${this.players.get(playerId).name} zahrál ${card.value}${card.suit} jako poslední kartu (ne svršek) - musí si vzít kartu až když bude na řadě!`);
        
        // NEDĚLÁME NIC - hráč si vezme kartu až když bude na řadě a nebude mít hratelné karty
        // nebo si ji musí vzít kliknutím na "Vzít kartu"
      }
    }
    
    // Move to next player
    this.nextPlayer();
    
    return true;
  }

  checkForReturnToGame() {
    // Implementace pro červenou sedmu - vrácení hráče do hry
    // Pro jednoduchost zatím vynecháno, lze implementovat později
  }

  reshuffleDiscardPile() {
    // Lze otočit balíček vždy, pokud je co otočit
    if (this.gameState.playedCards.length > 1) {
      console.log('🔄 Otáčím odkládací hromádku...');
      const topCard = this.gameState.playedCards.pop(); // Odeber vrchní kartu
      // Otočíme pořadí karet (bez míchání) a použijeme jako nový balíček
      const newCards = this.gameState.playedCards.reverse();
      this.gameState.deck = this.gameState.deck.concat(newCards); // Přidej k existujícím kartám
      this.gameState.playedCards = [topCard]; // Vrchní karta zůstává na hromádce
      console.log(`🃏 Balíček má nyní ${this.gameState.deck.length} karet`);
      return true;
    }
    console.log('❌ Nelze otočit balíček - není co otočit');
    return false;
  }

  drawCard(playerId) {
    const player = this.players.get(playerId);
    if (!player) return false;
    
    const playerIds = Array.from(this.players.keys());
    const currentPlayerId = playerIds[this.gameState.currentPlayer];
    
    if (playerId !== currentPlayerId) return false;
    
    const cardsNeeded = this.gameState.drawStack > 0 ? this.gameState.drawStack : 1;
    
    // Pokud není dost karet v balíčku, hráč musí nejdříve otočit balíček
    if (this.gameState.deck.length < cardsNeeded) {
      console.log(`❌ Nedostačuje karet v balíčku (${this.gameState.deck.length}) pro potřebný počet (${cardsNeeded}). Nejprve otoč balíček!`);
      return false;
    }
    
    if (this.gameState.drawStack > 0) {
      // Draw from stack (když někdo zahrál sedmičku)
      console.log(`🃏 Beru ${this.gameState.drawStack} karet z draw stacku`);
      for (let i = 0; i < this.gameState.drawStack && this.gameState.deck.length > 0; i++) {
        player.hand.push(this.gameState.deck.pop());
      }
      this.gameState.drawStack = 0;
    } else {
      // Draw one card (normální brání)
      console.log(`🃏 Beru 1 kartu z balíčku`);
      player.hand.push(this.gameState.deck.pop());
    }
    
    this.nextPlayer();
    return true;
  }

  nextPlayer() {
    const playerCount = this.players.size;
    const playerIds = Array.from(this.players.keys());
    const currentPlayerName = this.players.get(playerIds[this.gameState.currentPlayer])?.name;
    
    console.log('\n🔄 === PŘECHOD NA DALŠÍHO HRÁČE ===');
    console.log(`👤 Aktuální hráč: ${currentPlayerName} (index ${this.gameState.currentPlayer})`);
    console.log(`🎯 Směr hry: ${this.gameState.direction === 1 ? 'doprava' : 'doleva'}`);
    console.log(`⏭️ Skip next: ${this.gameState.skipNext}`);
    
    if (this.gameState.skipNext) {
      console.log('⏭️ Přeskakuji jednoho hráče kvůli asu...');
      this.gameState.currentPlayer = (this.gameState.currentPlayer + this.gameState.direction + playerCount) % playerCount;
      this.gameState.skipNext = false;
      // Když hráč stojí kvůli esu, resetuj lastPlayedWasSpecial - eso už není "čerstvé"
      this.gameState.lastPlayedWasSpecial = false;
      console.log('🔄 LastPlayedWasSpecial resetováno na false - eso už není čerstvé');
    }
    
    this.gameState.currentPlayer = (this.gameState.currentPlayer + this.gameState.direction + playerCount) % playerCount;
    
    const newPlayerName = this.players.get(playerIds[this.gameState.currentPlayer])?.name;
    console.log(`➡️ Nový hráč na řadě: ${newPlayerName} (index ${this.gameState.currentPlayer})`);
  }

  getGameState() {
    const playerIds = Array.from(this.players.keys());
    const players = playerIds.map(id => {
      const player = this.players.get(id);
      return {
        id,
        name: player.name,
        handSize: player.hand.length,
        connected: player.connected
        // Body se neukazují během hry - pouze na konci
      };
    });

    return {
      roomId: this.id,
      players,
      started: this.gameState.started,
      currentPlayer: this.gameState.currentPlayer,
      topCard: this.gameState.playedCards[this.gameState.playedCards.length - 1],
      currentSuit: this.gameState.currentSuit,
      currentValue: this.gameState.currentValue,
      direction: this.gameState.direction,
      deckSize: this.gameState.deck.length,
      playedCardsCount: this.gameState.playedCards.length,
      drawStack: this.gameState.drawStack,
      lastPlayedWasSpecial: this.gameState.lastPlayedWasSpecial,
      winner: this.gameState.winner
    };
  }

  calculateGameResults(winnerId) {
    const playerResults = [];
    let maxPoints = 0;
    let losers = [];
    
    // Zjisti jestli výhra byla červeným svrškem
    const winner = this.players.get(winnerId);
    const lastPlayedCard = this.gameState.playedCards[this.gameState.playedCards.length - 1];
    const redQueenWin = lastPlayedCard && lastPlayedCard.value === 'Q' && lastPlayedCard.suit === 'hearts';
    
    for (const [playerId, player] of this.players) {
      let points = calculatePlayerScore(player.hand);
      
      // Pokud výhra byla červeným svrškem, všem ostatním hráčům se násobí body 2x
      if (redQueenWin && playerId !== winnerId) {
        points *= 2;
      }
      
      playerResults.push({
        id: playerId,
        name: player.name,
        points: points,
        cards: player.hand.length,
        isWinner: playerId === winnerId,
        redQueenPenalty: redQueenWin && playerId !== winnerId
      });
      
      // Aktualizuj celkové body hráče
      const history = this.gameHistory.get(playerId);
      if (history) {
        history.totalPoints += points;
        history.gamesPlayed++;
        history.lastGamePoints = points; // Ulož body z aktuální hry
      }
      
      if (points > maxPoints) {
        maxPoints = points;
        losers = [playerId];
      } else if (points === maxPoints && points > 0) {
        losers.push(playerId);
      }
    }
    
    // Ulož poražené pro příští hru
    this.previousLosers = losers;
    console.log(`📝 Poražení pro příští hru: ${losers.map(id => this.players.get(id).name).join(', ')}`);
    
    return {
      winner: this.players.get(winnerId).name,
      winnerPoints: calculatePlayerScore(this.players.get(winnerId).hand), // Mělo by být 0
      redQueenWin: redQueenWin,
      players: playerResults,
      losers: losers.map(id => this.players.get(id).name),
      maxPoints: maxPoints
    };
  }

  calculateEliminationResults(eliminatedPlayerId) {
    const playerResults = [];
    
    // Najdi hráče s nejmenším počtem celkových bodů (vítěz)
    let minTotalPoints = Infinity;
    let winnerId = null;
    
    for (const [playerId, player] of this.players) {
      const history = this.gameHistory.get(playerId);
      const totalPoints = history ? history.totalPoints : 0;
      
      playerResults.push({
        id: playerId,
        name: player.name,
        points: 0, // Aktuální hra se nehrála
        totalPoints: totalPoints,
        cards: player.hand.length,
        isWinner: false, // Nastavíme později
        eliminated: playerId === eliminatedPlayerId,
        redQueenPenalty: false // Eliminace nemá penalty
      });
      
      if (playerId !== eliminatedPlayerId && totalPoints < minTotalPoints) {
        minTotalPoints = totalPoints;
        winnerId = playerId;
      }
    }
    
    // Nastav vítěze
    if (winnerId) {
      const winnerResult = playerResults.find(p => p.id === winnerId);
      if (winnerResult) winnerResult.isWinner = true;
    }
    
    // Po eliminaci už nejsou žádní poražení (hra končí)
    this.previousLosers = [];
    console.log(`🏁 Po eliminaci se vynulují poražení pro příští hru`);
    
    return {
      winner: winnerId ? this.players.get(winnerId).name : 'Neznámý',
      winnerPoints: 0,
      elimination: true,
      eliminatedPlayer: this.players.get(eliminatedPlayerId).name,
      redQueenWin: false,
      players: playerResults,
      losers: [this.players.get(eliminatedPlayerId).name],
      maxPoints: 0
    };
  }

  getPlayerHand(playerId) {
    const player = this.players.get(playerId);
    return player ? player.hand : [];
  }

  getPlayerPoints(playerId) {
    const player = this.players.get(playerId);
    if (!player) return 0;
    return calculatePlayerScore(player.hand);
  }
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join_room', ({ roomId, playerName }) => {
    if (!roomId || !playerName) {
      socket.emit('error', 'Room ID and player name are required');
      return;
    }

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new GameRoom(roomId));
    }

    const room = rooms.get(roomId);
    const success = room.addPlayer(socket.id, playerName);

    if (!success) {
      socket.emit('error', 'Room is full');
      return;
    }

    socket.join(roomId);
    socket.roomId = roomId;
    socket.playerName = playerName;

    // Send game state to all players in room
    io.to(roomId).emit('game_state', room.getGameState());
    socket.emit('player_hand', room.getPlayerHand(socket.id));
    socket.emit('player_points', room.getPlayerPoints(socket.id));

    console.log(`Player ${playerName} joined room ${roomId}`);
  });

  socket.on('start_game', () => {
    if (!socket.roomId) return;

    const room = rooms.get(socket.roomId);
    if (!room) return;

    const success = room.startGame(socket.id); // Předej ID iniciátora
    if (success) {
      // Vždy pošli aktualizovaný game state
      io.to(socket.roomId).emit('game_state', room.getGameState());
      
      // Pokud hra skončila kvůli eliminaci, pošli výsledky
      if (room.gameState.winner && room.gameState.gameResults) {
        const results = room.gameState.gameResults;
        console.log(`🏁 Hra ihned skončila kvůli eliminaci - ${results.eliminatedPlayer || 'UNDEFINED!'}`);
        console.log('📊 Eliminace detaily:', {
          eliminatedPlayer: results.eliminatedPlayer,
          winner: results.winner,
          elimination: results.elimination
        });
        io.to(socket.roomId).emit('game_over', room.gameState.gameResults);
      } else {
        // Send hands to each player (normální start hry)
        room.players.forEach((player, playerId) => {
          io.to(playerId).emit('player_hand', room.getPlayerHand(playerId));
          io.to(playerId).emit('player_points', room.getPlayerPoints(playerId));
        });
        console.log(`Game started in room ${socket.roomId}`);
      }
    }
  });

  socket.on('play_card', ({ cardId, newSuit, newValue }) => {
    if (!socket.roomId) return;

    const room = rooms.get(socket.roomId);
    if (!room) return;

    console.log(`\n🎴 HRÁČ HRAJE KARTU: ${room.players.get(socket.id)?.name} hraje kartu ${cardId}`);
    room.logGameState('PŘED ZAHRÁNÍM KARTY');

    const success = room.playCard(socket.id, cardId, newSuit, newValue);
    if (success) {
      room.logGameState('PO ZAHRÁNÍ KARTY');
      io.to(socket.roomId).emit('game_state', room.getGameState());
      socket.emit('player_hand', room.getPlayerHand(socket.id));
      socket.emit('player_points', room.getPlayerPoints(socket.id));
      
      if (room.gameState.winner) {
        io.to(socket.roomId).emit('game_over', room.gameState.gameResults);
      }
    } else {
      room.logGameState('KARTA NEBYLA ZAHRÁNA');
    }
  });

  socket.on('draw_card', () => {
    if (!socket.roomId) return;

    const room = rooms.get(socket.roomId);
    if (!room) return;

    console.log(`\n🃏 HRÁČ SI LÍZNE KARTU: ${room.players.get(socket.id)?.name}`);
    room.logGameState('PŘED LÍZNUTÍM KARTY');

    const success = room.drawCard(socket.id);
    if (success) {
      room.logGameState('PO LÍZNUTÍ KARTY');
      io.to(socket.roomId).emit('game_state', room.getGameState());
      socket.emit('player_hand', room.getPlayerHand(socket.id));
      socket.emit('player_points', room.getPlayerPoints(socket.id));
    } else {
      room.logGameState('KARTA NEBYLA LÍZNUTA');
    }
  });

  socket.on('reshuffle_discard_pile', () => {
    if (!socket.roomId) return;

    const room = rooms.get(socket.roomId);
    if (!room) return;

    console.log(`\n🔄 HRÁČ OTÁČÍ BALÍČEK: ${room.players.get(socket.id)?.name}`);
    room.logGameState('PŘED OTOČENÍM BALÍČKU');

    const success = room.reshuffleDiscardPile();
    if (success) {
      room.logGameState('PO OTOČENÍ BALÍČKU');
      io.to(socket.roomId).emit('game_state', room.getGameState());
      console.log(`Balíček otočen v místnosti ${socket.roomId}`);
    } else {
      room.logGameState('BALÍČEK NEBYL OTOČEN');
    }
  });

  socket.on('client_log', ({ message, action, data }) => {
    if (!socket.roomId) return;

    const room = rooms.get(socket.roomId);
    if (!room) return;

    const playerName = room.players.get(socket.id)?.name || 'UNKNOWN';
    console.log(`\n🖥️ CLIENT LOG [${playerName}] ${action ? `(${action})` : ''}: ${message}`);
    
    if (data) {
      console.log('   📄 Data:', JSON.stringify(data, null, 2));
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    if (socket.roomId) {
      const room = rooms.get(socket.roomId);
      if (room) {
        const shouldDelete = room.removePlayer(socket.id);
        if (shouldDelete) {
          rooms.delete(socket.roomId);
          console.log(`Room ${socket.roomId} deleted`);
        } else {
          io.to(socket.roomId).emit('game_state', room.getGameState());
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
