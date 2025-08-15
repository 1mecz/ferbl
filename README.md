# Online Ferbl 🃏

Multiplayer online karetní hra Prší vytvořená pomocí Node.js, Socket.io a Dockeru.

## Funkce

- **Multiplayer gameplay**: Až 4 hráči v jedné místnosti
- **Real-time komunikace**: Okamžité aktualizace přes WebSockety
- **Responsive design**: Funguje na desktop i mobilních zařízeních
- **Docker podpora**: Snadné nasazení pomocí kontejnerů
- **Plná pravidla Prší**: 
  - Eso přeskakuje dalšího hráče
  - Sedmička nutí brát 2 karty
  - Dáma mění barvu
  - Vítězí hráč, který se zbavý všech karet

## Rychlé spuštění

### S Dockerem (doporučeno)

```bash
# Klonuj repozitář
git clone <repo-url>
cd ferbl

# Spusť pomocí Docker Compose
docker compose up --build
```

### Bez Dockeru

```bash
# Nainstaluj závislosti
npm install

# Spusť server
npm start
```

Hra bude dostupná na: http://localhost:3000

## Jak hrát

1. **Připojení**: Zadej své jméno a ID místnosti (nebo nech prázdné pro novou místnost)
2. **Čekání na hráče**: Potřebuješ minimálně 2 hráče pro začátek
3. **Start hry**: Klikni na "Začít hru" když jsou připojeni všichni hráči
4. **Hraní**: 
   - Klikni na kartu v ruce pro zahrání (musí odpovídat barvě nebo hodnotě)
   - Dáma (Q) může být zahrána kdykoliv a změníš barvu
   - Eso (A) přeskočí dalšího hráče
   - Sedmička (7) nutí vzít 2 karty
   - Pokud nemůžeš hrát, klikni "Vzít kartu"

## Pravidla hry

### Základní pravidla
- Každý hráč začíná se 4 kartami
- Cílem je zbavit se všech karet jako první
- Kartu můžeš zahrát pouze pokud odpovídá barvě nebo hodnotě vrchní karty

### Speciální karty
- **Eso (A)**: Přeskočí dalšího hráče
- **Sedmička (7)**: Další hráč musí vzít 2 karty (nebo zahrát další sedmičku)
- **Dáma (Q)**: Může být zahrána kdykoliv, hráč si vybere novou barvu

## Technické detaily

### Technologie
- **Backend**: Node.js, Express, Socket.io
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Kontejnerizace**: Docker, Docker Compose
- **Real-time komunikace**: WebSockety

### Architektura
```
├── server.js          # Hlavní server s herní logikou
├── public/            # Frontend soubory
│   ├── index.html     # Hlavní HTML
│   ├── styles.css     # Styly
│   └── script.js      # JavaScript logika
├── Dockerfile         # Docker konfigurace
├── docker-compose.yml # Docker Compose setup
└── package.json       # Node.js závislosti
```

### API Události (Socket.io)

#### Klient → Server
- `join_room`: Připojení do místnosti
- `start_game`: Začátek hry
- `play_card`: Zahrání karty
- `draw_card`: Vzití karty z balíčku

#### Server → Klient
- `game_state`: Aktuální stav hry
- `player_hand`: Karty v ruce hráče
- `game_over`: Konec hry s vítězem
- `error`: Chybové hlášení

## Vývoj

### Spuštění ve vývojovém režimu
```bash
npm install
npm run dev  # Používá nodemon pro auto-restart
```

### Docker development
```bash
# Rebuild při změnách
docker-compose up --build

# Zobrazení logů
docker-compose logs -f
```

## Licence

MIT License - viz LICENSE soubor pro detaily.

## Přispívání

1. Fork projektu
2. Vytvoř feature branch (`git checkout -b feature/nova-funkce`)
3. Commit změny (`git commit -m 'Přidání nové funkce'`)
4. Push do branch (`git push origin feature/nova-funkce`)
5. Otevři Pull Request

---

Vytvořeno s ❤️ pro komunitu českých hráčů karet!
