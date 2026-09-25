# WAVE voor iPhone

Zelfstandige iPhone-webspeler voor [SUB/WAVE](https://github.com/perminder-klair/subwave). De originele container blijft onafhankelijk te updaten. FLAC is standaard; MP3 is een expliciete keuze in de instellingen.

## Installeren op Unraid

Voer in de Unraid-terminal uit:

```sh
curl -fsSL https://raw.githubusercontent.com/NelisVanWijk/wave-iphone/main/templates/wave-iphone.xml -o /boot/config/plugins/dockerMan/templates-user/my-wave-iphone.xml
```

Ga naar **Docker > Add Container** en selecteer de template **wave-iphone**. Vul bij **SUB/WAVE URL** het adres van je bestaande SUB/WAVE-server in, bijvoorbeeld `http://server-ip:7700`. Laat de spelerpoort op `7780` staan of kies een vrije hostpoort. Klik op Apply.

Open `http://server-ip:7780` in Safari. Via Deel > Zet op beginscherm kun je de speler als webapp openen. Start audio met de afspeelknop. Er is geen Xcode nodig en geen appdata-map: instellingen voor audiokwaliteit worden op de telefoon bewaard.

Image: `ghcr.io/nelisvanwijk/wave-iphone:latest` (amd64 en arm64).

## Adres wijzigen en domein gebruiken

**Adres van SUB/WAVE:** wijzig `SUBWAVE_URL` in de Unraid-containerinstellingen en pas de container toe. HTTP en HTTPS worden ondersteund. Gebruik een basisadres zonder `/api`, gebruikersnaam of wachtwoord. De container moet dit adres kunnen bereiken.

**Adres van de speler:** een domein kan via je reverse proxy naar spelerpoort 7780 wijzen. Alle API-, hoes- en streamverzoeken gebruiken hetzelfde adres als de speler; er staat geen vast serveradres in de frontend. Zet buffering voor de audiostream uit en gebruik een ruime proxytimeout. Het upstreamadres kan intern HTTP blijven terwijl de speler extern HTTPS gebruikt.

HTTP werkt voor de speler op het LAN. HTTPS is nodig voor de service worker en de optionele interfacecache; audio en API-antwoorden worden niet gecachet. De speler heeft geen eigen login en ondersteunt geen besloten SUB/WAVE-zender met wachtwoord. Houd hiermee rekening bij externe bereikbaarheid.

## Updates

Werk de speler bij via **Check for Updates / Update** in Unraid. GitHub Actions test wijzigingen en publiceert de Docker-image bij een push naar `main`. SUB/WAVE zelf blijft via de oorspronkelijke container te updaten. Een incompatibele verandering in de upstream-API kan een spelerupdate vereisen.

Heropen de webapp na een update. Ontwikkelaars moeten bij wijzigingen aan de gecachete interface ook de cachenaam in `public/sw.js` verhogen.

## Afspelen en achtergrondgedrag

- Native HTML-audio met FLAC, albumhoezen, titel, artiest en recente nummers.
- Media Session voor bediening en metadata op het vergrendelscherm.
- Polling blijft aangevraagd tijdens afspelen, ook als de pagina verborgen is; de app haalt informatie opnieuw op bij terugkeer.
- Metadata houdt rekening met de ingestelde SUB/WAVE-streambuffer.
- AirPlay-knop als Safari de apparaatkiezer beschikbaar stelt.
- Pauzeren en hervatten verbindt opnieuw met de live-uitzending. Radio heeft geen skip- of terugspoelfunctie.

**iOS kan JavaScript op de achtergrond opschorten. Deze PWA garandeert daarom geen titel- en hoesupdates bij een vergrendelde iPhone.** De app vermijdt het bewust stoppen van polling bij een verborgen pagina, maar kan de beperkingen van iOS niet opheffen. Fysieke iPhone-tests blijven nodig, met name op bètaversies.

SUB/WAVE levert `/stream.flac` als FLAC in Ogg. Directe weergave is in de desktoptestbrowser gecontroleerd; iPhone-ondersteuning moet op het betreffende toestel worden getest. Bij een fout volgt een melding, geen automatische MP3-fallback. Een FLAC-stream maakt MP3-bronmateriaal niet lossless.

## Lokaal ontwikkelen

Node.js 22 of nieuwer, zonder npm-afhankelijkheden:

```sh
SUBWAVE_URL=http://server-ip:7700 node server.mjs
```

PowerShell:

```powershell
$env:SUBWAVE_URL = 'http://server-ip:7700'
node server.mjs
```

`PORT` is standaard 7780. `SUBWAVE_URL` is standaard `http://subwave:7700`, bruikbaar als die containernaam op een gedeeld Docker-netwerk bereikbaar is.

Compose: stel `SUBWAVE_URL` in je omgeving of een lokale `.env` in en voer `docker compose up -d` uit. Zelf bouwen: `docker build -t wave-iphone:local .`.

De server staat alleen de noodzakelijke leesroutes toe: `/api/now-playing`, `/api/state`, `/api/cover/:id`, `/stream.flac`, `/stream.mp3`. Geen admin- of schrijf-API, buffering of transcoding.

## Verificatie

```sh
npm test
npm run check
```

Tests controleren buffertiming, polling, aanvraagoverlap, herstel na fouten, proxybeperkingen en streamdisconnects. Controleer op een echte iPhone nog FLAC-weergave, minstens drie nummerwissels bij vergrendeling, energiebesparing, pauzeren/hervatten vanaf het vergrendelscherm, AirPlay en netwerkherstel.
