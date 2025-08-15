class PrsiGame {
    constructor() {
        this.socket = io();
        this.playerName = '';
        this.roomId = '';
        this.gameState = null;
        this.playerHand = [];
        this.currentPlayerId = null;
        this.selectedCard = null;
        this.myPoints = 0; // Moje body
        this.justStartedNewGame = false; // Flag pro detekci nového startu hry
        
        this.initializeElements();
        this.bindEvents();
        this.setupSocketListeners();
    }

    // Pomocná funkce pro logování na server
    serverLog(message, action = null, data = null) {
        console.log(`[CLIENT] ${action || ''}: ${message}`, data || '');
        if (this.socket && this.socket.connected) {
            this.socket.emit('client_log', { message, action, data });
        }
    }

    initializeElements() {
        // Screens
        this.loginScreen = document.getElementById('login-screen');
        this.gameScreen = document.getElementById('game-screen');
        
        // Login elements
        this.playerNameInput = document.getElementById('player-name');
        this.roomIdInput = document.getElementById('room-id');
        this.joinBtn = document.getElementById('join-btn');
        
        // Game elements
        this.currentRoomSpan = document.getElementById('current-room');
        this.startGameBtn = document.getElementById('start-game-btn');
        this.playersContainer = document.getElementById('players-container');
        this.topCard = document.getElementById('top-card');
        this.currentSuit = document.getElementById('current-suit');
        this.gameDirection = document.getElementById('game-direction');
        this.deckCount = document.getElementById('deck-count');
        this.drawCardBtn = document.getElementById('draw-card-btn');
        this.reshuffleBtn = document.getElementById('reshuffle-btn');
        this.drawStack = document.getElementById('draw-stack');
        this.drawCount = document.getElementById('draw-count');
        this.handContainer = document.getElementById('hand-container');
        
        // Modals
        this.suitModal = document.getElementById('suit-modal');
        this.valueModal = document.getElementById('value-modal');
        this.gameOverModal = document.getElementById('game-over-modal');
        this.winnerText = document.getElementById('winner-text');
        this.newGameBtn = document.getElementById('new-game-btn');
        
        this.messagesContainer = document.getElementById('messages');
    }

    bindEvents() {
        this.joinBtn.addEventListener('click', () => this.joinRoom());
        this.playerNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
        this.roomIdInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinRoom();
        });
        
        this.startGameBtn.addEventListener('click', () => this.startGame());
        this.drawCardBtn.addEventListener('click', () => this.drawCard());
        this.reshuffleBtn.addEventListener('click', () => this.reshuffleDiscardPile());
        this.newGameBtn.addEventListener('click', () => this.newGame());
        
        // Suit selector events
        document.querySelectorAll('.suit-btn').forEach(btn => {
            btn.addEventListener('click', () => this.selectSuit(btn.dataset.suit));
        });
        
        // Value selector events
        document.querySelectorAll('.value-btn').forEach(btn => {
            btn.addEventListener('click', () => this.selectValue(btn.dataset.value));
        });
    }

    setupSocketListeners() {
        this.socket.on('game_state', (gameState) => {
            this.serverLog('Nový game state přijat', 'GAME_STATE', {
                topCard: gameState.topCard ? `${gameState.topCard.value}${gameState.topCard.suit}` : 'žádná',
                currentSuit: gameState.currentSuit,
                currentPlayer: gameState.currentPlayer,
                direction: gameState.direction,
                drawStack: gameState.drawStack,
                lastPlayedWasSpecial: gameState.lastPlayedWasSpecial,
                started: gameState.started,
                deckSize: gameState.deckSize,
                playedCardsCount: gameState.playedCardsCount
            });
            
            // Pokud se hra skutečně spustila po novém startu, schováme modal
            if (this.justStartedNewGame && gameState.started) {
                this.serverLog('Hra se úspěšně spustila - schovávám modal', 'NEW_GAME_SUCCESS');
                this.gameOverModal.classList.add('hidden');
                this.justStartedNewGame = false;
            }
            
            this.gameState = gameState;
            this.updateGameDisplay();
            // Překreslí karty v ruce, protože se mohla změnit hratelnost (např. draw stack se vynuloval)
            this.updateHandDisplay();
        });

        this.socket.on('player_hand', (hand) => {
            this.serverLog(`Moje karty aktualizovány: ${hand.map(c => `${c.value}${c.suit}`).join(', ')}`, 'HAND_UPDATE', {
                handSize: hand.length,
                cards: hand.map(c => `${c.value}${c.suit}`)
            });
            this.playerHand = hand;
            this.updateHandDisplay();
        });

        this.socket.on('player_points', (points) => {
            this.myPoints = points;
            this.updateMyPointsDisplay();
        });

        this.socket.on('error', (message) => {
            this.showMessage(message, 'error');
        });

        this.socket.on('game_over', (gameResults) => {
            // Pokud jsme právě začali novou hru a okamžitě přišla eliminace
            if (this.justStartedNewGame && gameResults.elimination) {
                this.serverLog('Okamžitá eliminace po startu nové hry', 'INSTANT_ELIMINATION');
                this.justStartedNewGame = false; // Reset flagu
                
                // Ukáž výsledky eliminace (modal už je zobrazen)
                this.showGameOver(gameResults);
                return;
            }
            
            this.justStartedNewGame = false; // Reset flagu pro normální konec hry
            this.showGameOver(gameResults);
        });

        this.socket.on('disconnect', () => {
            this.showMessage('Spojení ztraceno. Zkus se znovu připojit.', 'error');
        });
    }

    joinRoom() {
        const playerName = this.playerNameInput.value.trim();
        if (!playerName) {
            this.showMessage('Zadej své jméno!', 'error');
            return;
        }

        this.playerName = playerName;
        this.roomId = this.roomIdInput.value.trim() || this.generateRoomId();

        this.socket.emit('join_room', {
            roomId: this.roomId,
            playerName: this.playerName
        });

        this.showGameScreen();
    }

    generateRoomId() {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    showGameScreen() {
        this.loginScreen.classList.add('hidden');
        this.gameScreen.classList.remove('hidden');
        this.currentRoomSpan.textContent = this.roomId;
    }

    startGame() {
        this.socket.emit('start_game');
    }

    drawCard() {
        this.serverLog('Klient si lízne kartu', 'DRAW_CARD');
        this.socket.emit('draw_card');
    }

    reshuffleDiscardPile() {
        this.serverLog('Klient otáčí balíček', 'RESHUFFLE');
        this.socket.emit('reshuffle_discard_pile');
    }

    newGame() {
        // Neschovávej modal okamžitě - počkej jestli se hra spustí nebo skončí eliminací
        this.justStartedNewGame = true; // Označíme, že jsme právě začali novou hru
        this.showMessage('Spouštím novou hru...', 'info');
        this.startGame();
    }

    playCard(cardId) {
        const card = this.playerHand.find(c => c.id === cardId);
        if (!card) return;

        this.serverLog(`Klient hraje kartu: ${card.value}${card.suit}`, 'PLAY_CARD', {
            card: `${card.value}${card.suit}`,
            cardId: cardId,
            handSize: this.playerHand.length
        });

        if (card.value === 'Q') {
            // Svršek - pokud je to poslední karta, nemusí se vybírat barva (výhra)
            if (this.playerHand.length === 1) {
                // Poslední karta = výhra, nemusí se vybírat barva
                this.serverLog('Poslední karta svršek - vyhrávám!', 'WINNING_CARD');
                this.socket.emit('play_card', { 
                    cardId, 
                    newSuit: 'hearts' // Libovolná barva, hra stejně končí
                });
            } else {
                // Není poslední karta, musí vybrat barvu
                this.serverLog('Svršek - vybírám barvu', 'QUEEN_SELECT_SUIT');
                this.selectedCard = cardId;
                this.suitModal.classList.remove('hidden');
            }
        } else if (card.value === 'J') {
            // Spodek - musí vybrat novou hodnotu
            this.serverLog('Spodek - vybírám hodnotu', 'JACK_SELECT_VALUE');
            this.selectedCard = cardId;
            this.valueModal.classList.remove('hidden');
        } else {
            this.serverLog('Normální karta', 'NORMAL_CARD');
            this.socket.emit('play_card', { cardId });
        }
    }

    selectSuit(suit) {
        this.serverLog(`Klient vybral barvu: ${suit}`, 'SELECT_SUIT', { suit });
        this.suitModal.classList.add('hidden');
        if (this.selectedCard) {
            this.socket.emit('play_card', { 
                cardId: this.selectedCard, 
                newSuit: suit 
            });
            this.selectedCard = null;
        }
    }

    selectValue(value) {
        this.serverLog(`Klient vybral hodnotu: ${value}`, 'SELECT_VALUE', { value });
        this.valueModal.classList.add('hidden');
        if (this.selectedCard) {
            this.socket.emit('play_card', { 
                cardId: this.selectedCard, 
                newValue: value 
            });
            this.selectedCard = null;
        }
    }

    updateGameDisplay() {
        if (!this.gameState) return;

        // Update players list
        this.updatePlayersList();

        // Update game controls
        this.updateGameControls();

        // Update top card and current suit
        this.updateTopCard();

        // Update deck count
        this.deckCount.textContent = this.gameState.deckSize;

        // Update draw stack
        if (this.gameState.drawStack > 0) {
            this.drawStack.classList.remove('hidden');
            this.drawCount.textContent = this.gameState.drawStack;
        } else {
            this.drawStack.classList.add('hidden');
        }
    }

    updatePlayersList() {
        this.playersContainer.innerHTML = '';
        
        this.gameState.players.forEach((player, index) => {
            const playerDiv = document.createElement('div');
            playerDiv.className = 'player';
            
            if (index === this.gameState.currentPlayer && this.gameState.started) {
                playerDiv.classList.add('current');
            }
            
            if (!player.connected) {
                playerDiv.classList.add('offline');
            }

            const isYou = player.id === this.socket.id;
            const nameSpan = document.createElement('span');
            nameSpan.textContent = isYou ? `${player.name} (ty)` : player.name;

            const cardsSpan = document.createElement('span');
            cardsSpan.textContent = `${player.handSize} karet`;

            playerDiv.appendChild(nameSpan);
            playerDiv.appendChild(cardsSpan);
            this.playersContainer.appendChild(playerDiv);
        });
    }

    updateMyPointsDisplay() {
        // Najdi nebo vytvoř element pro zobrazení mých bodů
        let pointsDisplay = document.getElementById('my-points-display');
        if (!pointsDisplay) {
            pointsDisplay = document.createElement('div');
            pointsDisplay.id = 'my-points-display';
            pointsDisplay.style.cssText = `
                text-align: center;
                margin: 10px 0;
                font-weight: bold;
                color: #ffd700;
                font-size: 16px;
            `;
            
            // Přidej před player-hand
            const playerHandDiv = document.querySelector('.player-hand');
            playerHandDiv.parentNode.insertBefore(pointsDisplay, playerHandDiv);
        }
        
        pointsDisplay.textContent = `Moje body: ${this.myPoints}`;
    }

    updateGameControls() {
        // Show start button only if game not started and you're in the room
        if (!this.gameState.started && this.gameState.players.length >= 2) {
            this.startGameBtn.classList.remove('hidden');
        } else {
            this.startGameBtn.classList.add('hidden');
        }

        // Update draw card button - disable když není můj tah nebo není dost karet
        const isYourTurn = this.gameState.started && 
                          this.gameState.players[this.gameState.currentPlayer]?.id === this.socket.id;
        
        // Zjisti kolik karet potřebujeme (draw stack nebo 1)
        const cardsNeeded = this.gameState.drawStack > 0 ? this.gameState.drawStack : 1;
        const notEnoughCards = this.gameState.deckSize < cardsNeeded;
        
        this.drawCardBtn.disabled = !isYourTurn || notEnoughCards;
        
        // Update reshuffle button - show vždy když je hra spuštěná a je co otočit
        const canReshuffle = this.gameState.started && this.gameState.playedCardsCount > 1;
        
        if (canReshuffle) {
            this.reshuffleBtn.classList.remove('hidden');
            // Zvýrazni tlačítko pokud je to můj tah a není dost karet
            if (isYourTurn && notEnoughCards) {
                this.reshuffleBtn.style.backgroundColor = '#ff6b6b';
                this.reshuffleBtn.style.color = 'white';
                this.reshuffleBtn.textContent = `⚠️ Musíš otočit balíček!`;
            } else {
                this.reshuffleBtn.style.backgroundColor = '';
                this.reshuffleBtn.style.color = '';
                this.reshuffleBtn.textContent = 'Otočit balíček';
            }
        } else {
            this.reshuffleBtn.classList.add('hidden');
        }
    }

    updateTopCard() {
        if (!this.gameState.topCard) return;

        const card = this.gameState.topCard;
        const valueName = this.getCardValueName(card.value);
        const suitName = this.getSuitName(card.suit);
        const suitSymbol = this.getSuitSymbol(card.suit);
        
        this.topCard.className = `card ${card.suit}`;
        this.topCard.innerHTML = `
            <div class="card-value">${valueName}</div>
            <div class="card-suit">${suitSymbol}</div>
            <div class="card-name">${suitName}</div>
        `;

        const currentSuitName = this.getSuitName(this.gameState.currentSuit);
        const currentSuitSymbol = this.getSuitSymbol(this.gameState.currentSuit);
        
        let currentInfo = `${currentSuitSymbol} ${currentSuitName}`;
        if (this.gameState.currentValue) {
            const currentValueName = this.getCardValueName(this.gameState.currentValue);
            currentInfo += ` | ${currentValueName}`;
        }
        
        this.currentSuit.textContent = currentInfo;
        
        // Update direction display
        if (this.gameState.direction !== undefined) {
            const directionSymbol = this.gameState.direction === 1 ? '→' : '←';
            const directionText = this.gameState.direction === 1 ? 'doprava' : 'doleva';
            this.gameDirection.textContent = `${directionSymbol} ${directionText}`;
        }
    }

    updateHandDisplay() {
        this.handContainer.innerHTML = '';
        
        this.serverLog('=== AKTUALIZACE RUKY ===', 'HAND_ANALYSIS', {
            topCard: `${this.gameState.topCard.value}${this.gameState.topCard.suit}`,
            currentSuit: this.gameState.currentSuit,
            currentValue: this.gameState.currentValue || 'žádná',
            drawStack: this.gameState.drawStack,
            lastPlayedWasSpecial: this.gameState.lastPlayedWasSpecial,
            myCards: this.playerHand.map(c => `${c.value}${c.suit}`).join(', ')
        });
        
        const playableCards = [];
        const unplayableCards = [];

        this.playerHand.forEach(card => {
            const cardElement = this.createCardElement(card);
            
            // Check if card is playable
            if (this.canPlayCard(card)) {
                playableCards.push(`${card.value}${card.suit}`);
                cardElement.classList.add('playable');
                cardElement.addEventListener('click', () => this.playCard(card.id));
                
                // Add visual feedback
                const playableIndicator = document.createElement('div');
                playableIndicator.className = 'playable-indicator';
                playableIndicator.textContent = '✓ Hratelné';
                playableIndicator.style.cssText = `
                    position: absolute;
                    top: -15px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #4CAF50;
                    color: white;
                    padding: 2px 6px;
                    border-radius: 3px;
                    font-size: 8px;
                    font-weight: bold;
                    white-space: nowrap;
                `;
                cardElement.appendChild(playableIndicator);
            } else {
                unplayableCards.push(`${card.value}${card.suit}`);
                cardElement.style.opacity = '0.6';
                cardElement.style.cursor = 'not-allowed';
            }

            this.handContainer.appendChild(cardElement);
        });
        
        this.serverLog('Analýza hratelnosti dokončena', 'PLAYABILITY_ANALYSIS', {
            playableCards: playableCards.length > 0 ? playableCards.join(', ') : 'žádné',
            unplayableCards: unplayableCards.length > 0 ? unplayableCards.join(', ') : 'žádné',
            playableCount: playableCards.length,
            totalCards: this.playerHand.length
        });
    }

    createCardElement(card) {
        const cardDiv = document.createElement('div');
        cardDiv.className = `card ${card.suit}`;
        
        const valueName = this.getCardValueName(card.value);
        const suitName = this.getSuitName(card.suit);
        const suitSymbol = this.getSuitSymbol(card.suit);
        const points = this.getCardPoints(card);
        
        cardDiv.innerHTML = `
            <div class="card-value">${valueName}</div>
            <div class="card-suit">${suitSymbol}</div>
            <div class="card-name">${suitName}</div>
            <div class="card-points">${points}b</div>
        `;
        
        // Add tooltip with full name
        cardDiv.title = `${valueName} - ${suitName} (${points} bodů)`;
        
        return cardDiv;
    }

    canPlayCard(card) {
        if (!this.gameState || !this.gameState.started) return false;
        
        const isYourTurn = this.gameState.players[this.gameState.currentPlayer]?.id === this.socket.id;
        if (!isYourTurn) {
            this.serverLog('Není tvůj tah', 'NOT_YOUR_TURN');
            return false;
        }

        const topCard = this.gameState.topCard;
        if (!topCard) {
            this.serverLog('Žádná vrchní karta', 'NO_TOP_CARD');
            return false;
        }

        this.serverLog('=== KONTROLA HRATELNOSTI ===', 'CARD_PLAYABILITY_CHECK', {
            testCard: `${card.value}${card.suit} (${this.getCardValueName(card.value)} ${this.getSuitName(card.suit)})`,
            topCard: `${topCard.value}${topCard.suit} (${this.getCardValueName(topCard.value)} ${this.getSuitName(topCard.suit)})`,
            currentSuit: `${this.gameState.currentSuit} (${this.getSuitName(this.gameState.currentSuit)})`,
            currentValue: this.gameState.currentValue ? `${this.gameState.currentValue} (${this.getCardValueName(this.gameState.currentValue)})` : 'žádná',
            drawStack: this.gameState.drawStack,
            lastPlayedWasSpecial: this.gameState.lastPlayedWasSpecial
        });

        // Pokud je draw stack > 0, musí se hrát speciální přebíjející karta nebo brát
        if (this.gameState.drawStack > 0) {
            // Zkontrolujeme, zda vrchní karta je zelený král
            if (topCard.value === 'K' && topCard.suit === 'spades') {
                // Zelený král lze přebít pouze zelenou sedmičkou
                const canPlay = card.value === '7' && card.suit === 'spades';
                this.serverLog('Zelený král na vrcholu, lze přebít jen zelenou sedmičkou', 'GREEN_KING_CHECK', { canPlay });
                return canPlay;
            } else if (topCard.value === '7' && topCard.suit === 'spades') {
                // Zelenou sedmičku lze přebít pouze zeleným králem
                const canPlay = card.value === 'K' && card.suit === 'spades';
                this.serverLog('Zelená sedmička na vrcholu, lze přebít jen zeleným králem', 'GREEN_SEVEN_CHECK', { canPlay });
                return canPlay;
            } else {
                // Jiné sedmičky se nepřebíjí - musí si vzít karty
                this.serverLog('Draw stack > 0, nelze přebít - musí si vzít karty', 'MUST_DRAW_CARDS');
                return false;
            }
        }

        // Svršek nelze dát na Eso, Sedmu nebo Zeleného krále (hned po jejich vyhození)
        if (card.value === 'Q') {
            // Pokud spodek nastavil hodnotu na něco JINÉHO než Svršek, nelze hrát
            if (this.gameState.currentValue && this.gameState.currentValue !== 'Q') {
                this.serverLog('Svršek nelze hrát když spodek nastavil jinou hodnotu - musí se respektovat nastavená hodnota', 'QUEEN_BLOCKED_BY_JACK');
                return false;
            }
            
            // Pokud spodek nastavil hodnotu na Svršek (Q), svršek lze hrát
            if (this.gameState.currentValue === 'Q') {
                this.serverLog('Svršek lze hrát - spodek nastavil hodnotu na Svršek', 'QUEEN_ALLOWED_BY_JACK');
                return true;
            }
            
            if (this.gameState.lastPlayedWasSpecial && 
                (topCard.value === 'A' || topCard.value === '7' || 
                 (topCard.value === 'K' && topCard.suit === 'spades'))) {
                this.serverLog('Svršek nelze dát na čerstvé Eso/Sedmu/Zeleného krále', 'QUEEN_BLOCKED_BY_SPECIAL');
                return false;
            }
            this.serverLog('Svršek lze hrát', 'QUEEN_ALLOWED');
            return true;
        }

        // Spodek lze dát na cokoliv (jako svršek, ale mění hodnotu místo barvy)
        if (card.value === 'J') {
            // Pokud spodek nastavil hodnotu na něco JINÉHO než Spodek, nelze hrát jiný spodek
            if (this.gameState.currentValue && this.gameState.currentValue !== 'J') {
                this.serverLog('Spodek nelze hrát když jiný spodek nastavil jinou hodnotu - musí se respektovat nastavená hodnota', 'JACK_BLOCKED_BY_OTHER_JACK');
                return false;
            }
            
            // Pokud spodek nastavil hodnotu na Spodek (J), další spodek lze hrát
            if (this.gameState.currentValue === 'J') {
                this.serverLog('Spodek lze hrát - předchozí spodek nastavil hodnotu na Spodek', 'JACK_ALLOWED_BY_JACK');
                return true;
            }
            
            this.serverLog('Spodek lze hrát na cokoliv', 'JACK_ALLOWED');
            return true;
        }

        // Eso lze přebít dalším esem
        if (card.value === 'A' && topCard.value === 'A') {
            this.serverLog('Eso přebíjí eso', 'ACE_ON_ACE');
            return true;
        }

        // Normální pravidla - barva nebo hodnota musí sedět
        const suitMatch = card.suit === this.gameState.currentSuit;
        const valueMatch = card.value === topCard.value;
        
        // Pokud byl zahrán spodek a nastavil hodnotu, POUZE hodnota se musí respektovat (ne barva!)
        if (this.gameState.currentValue) {
            const spodekValueMatch = card.value === this.gameState.currentValue;
            this.serverLog('Spodek nastavil hodnotu - musí se respektovat!', 'JACK_VALUE_RULE', {
                spodekValueMatch,
                cardValue: card.value,
                requiredValue: this.gameState.currentValue,
                result: spodekValueMatch ? 'HRATELNÉ' : 'NEHRATELNÉ'
            });
            return spodekValueMatch;
        }
        
        // Normální pravidla (pouze když spodek nenastavil hodnotu)
        const canPlay = suitMatch || valueMatch;
        
        this.serverLog('Normální pravidla', 'NORMAL_RULES', {
            suitMatch,
            valueMatch,
            cardSuit: card.suit,
            requiredSuit: this.gameState.currentSuit,
            cardValue: card.value,
            topCardValue: topCard.value,
            result: canPlay ? 'HRATELNÉ' : 'NEHRATELNÉ'
        });
        
        return canPlay;
    }

    getSuitSymbol(suit) {
        const symbols = {
            hearts: '♥',
            diamonds: '♦',
            clubs: '♣',
            spades: '♠'
        };
        return symbols[suit] || suit;
    }

    getSuitName(suit) {
        const names = {
            hearts: 'srdce',
            diamonds: 'kule',
            clubs: 'žaludy',
            spades: 'listy'
        };
        return names[suit] || suit;
    }

    getCardValueName(value) {
        const names = {
            'A': 'Eso',
            'K': 'Král',
            'Q': 'Svršek',
            'J': 'Spodek',
            '10': '10',
            '9': '9',
            '8': '8',
            '7': '7'
        };
        return names[value] || value;
    }

    getCardPoints(card) {
        // Zelený král (spades K) má 50 bodů
        if (card.value === 'K' && card.suit === 'spades') {
            return 50;
        }
        // Červený svršek (hearts Q) má 40 bodů
        if (card.value === 'Q' && card.suit === 'hearts') {
            return 40;
        }
        // Ostatní karty podle tabulky
        const points = {
            '7': 7,
            '8': 8,
            '9': 9,
            '10': 10,
            'J': 1,     // Spodek
            'K': 2,     // Král
            'Q': 20,    // Svršek
            'A': 11     // Eso
        };
        return points[card.value] || 0;
    }

    showGameOver(gameResults) {
        let resultText = '';
        
        if (gameResults.elimination) {
            // Eliminace - hráč nemohl dostat karty
            resultText = `🚫 ${gameResults.eliminatedPlayer} byl vyřazen (nemohl dostat karty)!\n`;
            resultText += `🎉 Vyhrál ${gameResults.winner}!\n\n`;
            resultText += `📊 Celkové body všech hráčů:\n`;
            gameResults.players
                .sort((a, b) => a.totalPoints - b.totalPoints)
                .forEach((player, index) => {
                    const place = index + 1;
                    const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : '  ';
                    const eliminated = player.eliminated ? ' (VYŘAZEN)' : '';
                    resultText += `${medal} ${place}. ${player.name}: ${player.totalPoints} bodů celkem${eliminated}\n`;
                });
        } else {
            // Normální konec hry
            if (gameResults.redQueenWin) {
                resultText = `💥 ${gameResults.winner} vyhrál ČERVENÝM SVRŠKEM! (všem ostatním 2x body)\n\n`;
            } else {
                resultText = `🎉 Vyhrál ${gameResults.winner}! (${gameResults.winnerPoints} bodů)\n\n`;
            }
            
            resultText += `📊 Výsledky této hry:\n`;
            gameResults.players
                .sort((a, b) => a.points - b.points) // Seřaď podle bodů (méně = lepší)
                .forEach((player, index) => {
                    const place = index + 1;
                    const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : '  ';
                    const penalty = player.redQueenPenalty ? ' (2x penalty!)' : '';
                    resultText += `${medal} ${place}. ${player.name}: ${player.points} bodů${penalty}\n`;
                });
            
            if (gameResults.losers.length > 0) {
                resultText += `\n💸 Nejvíce bodů (${gameResults.maxPoints}): ${gameResults.losers.join(', ')}`;
            }
        }
        
        this.winnerText.innerHTML = resultText.replace(/\n/g, '<br>');
        this.gameOverModal.classList.remove('hidden');
    }

    showMessage(message, type = 'info') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.textContent = message;
        
        this.messagesContainer.appendChild(messageDiv);
        
        setTimeout(() => {
            messageDiv.remove();
        }, 5000);
    }
}

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', () => {
    new PrsiGame();
});
