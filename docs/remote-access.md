# WAVE buitenshuis met Nginx en HTTPS

Voor een eigen luisteraccount. Eenmaal inloggen per apparaat, maximaal 90 dagen;
na 30 dagen zonder gebruik log je opnieuw in. Bewaar je wachtwoord in de
iPhone-wachtwoordenapp. Safari en een beginscherm-app kunnen aparte sessies hebben.

## 1. Update en stel de login in voordat je toegang van buiten opent

Werk `wave-iphone` bij naar 1.1.0 of nieuwer. De bestaande installatie blijft
zonder ingestelde login werken op het LAN. **Alleen updaten activeert geen login.**

Maak op Unraid de sessiemap aan (dit verandert alleen deze map, niet andere appdata):

```sh
mkdir -p /mnt/user/appdata/wave-iphone
chown 1000:1000 /mnt/user/appdata/wave-iphone
chmod 700 /mnt/user/appdata/wave-iphone
```

Genereer op de Unraid-terminal een hash; het wachtwoord wordt niet weergegeven
of in de shellgeschiedenis gezet:

```sh
docker exec -it wave-iphone node password-hash.mjs
```

Kies een uniek wachtwoord van minstens 16 tekens (liefst gegenereerd). Sla het
wachtwoord zelf op in je wachtwoordenapp. Kopieer de uitvoer achter
`WAVE_PASSWORD_HASH=` naar de containerinstellingen.

Voeg in **Docker > wave-iphone > Edit** deze variabelen en padkoppeling toe.
Een bestaande Unraid-container neemt nieuwe templatevelden niet altijd vanzelf over:

| Type | Container key/path | Waarde |
| --- | --- | --- |
| Variable | `WAVE_AUTH` | `true` |
| Variable | `WAVE_ORIGIN` | `https://radio.example.com` (jouw domein, zonder afsluitende slash) |
| Variable | `WAVE_PASSWORD_HASH` | Volledige `scrypt-v1:...`-uitvoer |
| Path, read/write | `/data` | `/mnt/user/appdata/wave-iphone` |

Klik Apply. Als de instellingen ontbreken, ongeldig zijn of de sessiemap niet
schrijfbaar is, weigert de container met ingeschakelde login op te starten.
Je lokale HTTP-adres toont nu de login, maar inloggen werkt uitsluitend via HTTPS.
Gebruik voortaan het domein, ook thuis (eventueel met lokale DNS of NAT-loopback).

## 2. Nginx instellen

DNS voor je domein moet naar je externe IP wijzen. Laat alleen de HTTPS-proxy van
buiten bereikbaar zijn. Publiceer niet rechtstreeks poort 7780, SUB/WAVE-poort
7700 of het Unraid-beheer. Bij CGNAT is alleen DNS/portforwarding niet voldoende;
dan is een tunnel of andere bereikbare ingang nodig.

Bij **Nginx Proxy Manager**: maak een Proxy Host voor het domein, met forwarding
scheme `http`, je Unraid-IP en poort `7780`. Vraag een geldig Let's Encrypt-certificaat
aan en zet **Force SSL** aan. Voeg in Advanced toe:

```nginx
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 1h;
proxy_send_timeout 1h;
client_max_body_size 4k;
```

Bij gewone Nginx hoort dit binnen een serverblok met een geldig certificaat:

```nginx
location / {
    proxy_pass http://UNRAID_IP:7780;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
    client_max_body_size 4k;
}
```

Laat HTTP doorverwijzen naar HTTPS. Laat Cookie, Set-Cookie en Origin ongewijzigd
door en cache geen WAVE-responses. Alleen de speler krijgt publieke toegang;
het ingestelde `SUBWAVE_URL` blijft het interne adres.

## 3. Controleer en installeer op de iPhone

Open het HTTPS-domein in een privevenster. Zonder login moeten `/api/now-playing`,
`/api/cover/test` en `/stream.mp3` een 401 geven, geen muziek of informatie.
Log in, test MP3 en het vergrendelscherm en voeg het **HTTPS-adres** toe aan je
beginscherm. De oude snelkoppeling naar het LAN-IP blijft een ander adres.
Controleer dit ook via mobiel internet, met wifi en VPN uit.

De logincookie is Secure, HttpOnly, SameSite=Strict en bevat een willekeurig
256-bit sessietoken. Alleen een SHA-256-hash van dit token wordt opgeslagen.
Wachtwoordcontrole gebruikt scrypt. Wijzigende aanvragen vereisen de exacte
ingestelde Origin. De login accepteert maximaal 10 pogingen per 10 minuten,
globaal voor het ene account; bestaande ingelogde apparaten blijven werken.
Het limiterbudget overleeft herstarts, maar iemand kan door pogingen nieuwe
logins tijdelijk blokkeren. De proxy kan aanvullend per-IP-limieten instellen.

## Uitloggen, verlies van een telefoon en onderhoud

- **Uitloggen** trekt de huidige sessie in, ook als iemand het token gekopieerd heeft.
- **Alle apparaten uitloggen** trekt alle sessies in en verbreekt actieve streams.
- Nieuw wachtwoord: genereer een nieuwe hash, wijzig de variabele en pas de
  container toe. Alle oude sessies vervallen. Dit is ook de herstelroute als
  je geen ingelogd apparaat meer hebt.
- Bewaar `/data` bij updates. Zonder die opslag moet iedereen opnieuw inloggen.
- Een ander domein vereist een nieuwe `WAVE_ORIGIN` en opnieuw inloggen.
- Houd Nginx, Unraid en de speler bijgewerkt. Langdurige sessies zijn een
  bewuste afweging: een gestolen sessie blijft bruikbaar tot intrekking of afloop.

Dit beveiligt de WAVE-ingang, niet eventuele andere openbare ingangen naar
SUB/WAVE. Het vervangt geen beveiligingsaudit of beveiliging van de server zelf.
