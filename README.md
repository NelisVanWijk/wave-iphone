# WAVE voor iPhone

Zelfstandige iPhone-webspeler voor [SUB/WAVE](https://github.com/perminder-klair/subwave). De originele container blijft onafhankelijk te updaten. De speler gebruikt de MP3-radiostream.

## Installeren op Unraid

Voer in de Unraid-terminal uit:

```sh
curl -fsSL https://raw.githubusercontent.com/NelisVanWijk/wave-iphone/main/templates/wave-iphone.xml -o /boot/config/plugins/dockerMan/templates-user/my-wave-iphone.xml
```

Ga naar **Docker > Add Container** en selecteer de template **wave-iphone**. Vul bij **SUB/WAVE URL** het adres van je bestaande SUB/WAVE-server in, bijvoorbeeld `http://server-ip:7700`. Laat de spelerpoort op `7780` staan of kies een vrije hostpoort. Klik op Apply.

Open `http://server-ip:7780` in Safari voor LAN-gebruik zonder login. Via Deel > Zet op beginscherm kun je de speler als webapp openen. Start audio met de afspeelknop. Voor toegang buitenshuis stel je eerst de login en HTTPS in volgens [de installatiehandleiding](docs/remote-access.md).

Image: `ghcr.io/nelisvanwijk/wave-iphone:latest` (amd64 en arm64).

## Adres wijzigen en domein gebruiken

**Adres van SUB/WAVE:** wijzig `SUBWAVE_URL` in de Unraid-containerinstellingen en pas de container toe. HTTP en HTTPS worden ondersteund. Gebruik een basisadres zonder `/api`, gebruikersnaam of wachtwoord. De container moet dit adres kunnen bereiken.

**Adres van de speler:** een domein kan via je reverse proxy naar spelerpoort 7780 wijzen. Alle API-, hoes- en streamverzoeken gebruiken hetzelfde adres als de speler; er staat geen vast serveradres in de frontend. Zet buffering voor de audiostream uit en gebruik een ruime proxytimeout. Het upstreamadres kan intern HTTP blijven terwijl de speler extern HTTPS gebruikt.

De optionele login gebruikt een wachtwoord, een Secure/HttpOnly-cookie en sessieopslag op de server. Je blijft maximaal 90 dagen ingelogd; na 30 dagen zonder gebruik vervalt de sessie. Sessies overleven containerupdates via `/data`. Uitloggen en alle apparaten uitloggen staan in de instellingen. Een wachtwoordwijziging trekt bij herstart alle sessies in. HTTPS is verplicht voor login; stel die in voordat je de speler extern bereikbaar maakt. Het upstream SUB/WAVE-zenderwachtwoord wordt niet ondersteund.

## Updates

Werk de speler bij via **Check for Updates / Update** in Unraid. GitHub Actions test wijzigingen en publiceert de Docker-image bij een push naar `main`. SUB/WAVE zelf blijft via de oorspronkelijke container te updaten. Een incompatibele verandering in de upstream-API kan een spelerupdate vereisen.

Heropen de webapp na een update. Vanaf 1.1.0 worden oude offline-interfacecaches verwijderd; de speler gebruikt het netwerk zodat de login ook na uitloggen wordt gehandhaafd.

## Afspelen en achtergrondgedrag

- Native HTML-audio met MP3, albumhoezen, titel, artiest en recente nummers.
- Media Session voor bediening en metadata op het vergrendelscherm.
- Polling blijft aangevraagd tijdens afspelen, ook als de pagina verborgen is; de app haalt informatie opnieuw op bij terugkeer.
- Metadata houdt rekening met de ingestelde SUB/WAVE-streambuffer.
- AirPlay-knop als Safari de apparaatkiezer beschikbaar stelt.
- Springacties worden uitgeschakeld bij initialisatie en opnieuw zodra audio speelt. iOS bepaalt uiteindelijk welke systeemknoppen zichtbaar zijn.
- Pauzeren en hervatten verbindt opnieuw met de live-uitzending. Radio heeft geen skip- of terugspoelfunctie.

**iOS kan JavaScript op de achtergrond opschorten. Deze PWA garandeert daarom geen titel- en hoesupdates bij een vergrendelde iPhone.** De app vermijdt het bewust stoppen van polling bij een verborgen pagina, maar kan de beperkingen van iOS niet opheffen. Fysieke iPhone-tests blijven nodig, met name op bètaversies.

Op desktop kun je bij Instellingen > Geluidskwaliteit kiezen tussen MP3 en FLAC. De keuze wordt per browser onthouden; wisselen tijdens het luisteren verbindt met de andere live stream. De browser moet de Ogg/FLAC-stream van SUB/WAVE ondersteunen. Op iPhone en iPad blijft MP3 actief vanwege de systeemmediabediening.

De lijst **Hierna** toont de volledige `upcoming`-wachtrij van SUB/WAVE, in zender-volgorde. Bij een verzoeknummer verschijnt de meegestuurde `requestedBy`-naam. Een lege wachtrij betekent dat de dj het volgende nummer nog kiest.

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

De server geeft de noodzakelijke SUB/WAVE-leesroutes door: `/api/now-playing`, `/api/state`, `/api/cover/:id`, `/stream.mp3` en `/stream.flac`. Daarnaast ondersteunt hij luisterverzoeken via `POST /api/request` en status via `GET /api/request/:id`. Geen upstream admin-API, buffering of transcoding. Eigen `/auth/*`-routes regelen login en uitloggen.

## Verificatie

```sh
npm test
npm run check
```

Tests controleren buffertiming, polling, aanvraagoverlap, herstel na fouten, proxybeperkingen en streamdisconnects. Controleer op een echte iPhone nog MP3-weergave, minstens drie nummerwissels bij vergrendeling, energiebesparing, pauzeren/hervatten vanaf het vergrendelscherm, AirPlay en netwerkherstel.
