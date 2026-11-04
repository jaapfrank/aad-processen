# Meerdere bedrijven hosten

Dit is de uitvoerbare eerste hostingvorm: iedere organisatie krijgt een eigen app-container,
SQLite-database, App_Data-volume, Data Protection-certificaat en privaat Docker-netwerk.
Caddy is de gedeelde HTTPS-ingang. Alleen Caddy publiceert poorten. De applicatie zelf blijft
single-tenant; deze opzet doet geen gedeelde database-multitenancy voor.
Houd ieder bedrijf op precies één app-container; schaal deze SQLite-variant niet naar
meerdere gelijktijdige schrijvers op hetzelfde volume.

De beheerder van de host verzorgt provisioning, abonnementen/facturatie, updates, monitoring
en herstel. Klanten werken via hun eigen hostnaam in de browser. Een openbare signup met
automatische betaling/aanmaak is hiermee nog niet geleverd.

## Vereisten

Een Linux-host met Docker Engine + Compose v2, Python 3.10+, OpenSSL, DNS en vrije poorten
80/443. De gegenereerde netwerken gebruiken 172.28.1.0/24 t/m 172.28.254.0/24; reserveer dit
bereik vooraf zodat het niet overlapt met het host-/VPN-netwerk. Reken als startpunt op
1 GB geheugenlimiet per organisatie; meet belasting voordat u capaciteit verkoopt.

De image bouwt frontend en backend uit deze broncode met npm ci en .NET 10 LTS.
De drie build/runtime-basisimages zijn op digest vastgezet. Werk deze bewust bij in de
releaseprocedure en voer daarna build en smoketest opnieuw uit. OS-pakketten komen bij
het bouwen uit de beveiligingsupdates van de betreffende distributie.

## Twee organisaties klaarzetten

Voer dit uit vanuit de repositoryroot. Kies echte eigen DNS-hostnamen bij uitrol.
Deze eerste twee opdrachten genereren uitsluitend lokale configuratie en unieke sleutels.

```bash
python3 hosting/provision.py add --slug organisatie-a --domain a.example.com
python3 hosting/provision.py add --slug organisatie-b --domain b.example.com
docker compose -f hosting/.state/compose.generated.json config --quiet
docker build --load --tag service-procesgids:local .
python3 hosting/provision.py bootstrap --slug organisatie-a
python3 hosting/provision.py bootstrap --slug organisatie-b
docker compose -f hosting/.state/compose.generated.json up -d --no-build
```

De bootstrap vraagt het eerste Admin-wachtwoord veilig via de terminal. Het komt niet in de
gegenereerde configuratie of commandoregel. Een tijdelijke container krijgt het via zijn
procesomgeving en wordt daarna verwijderd; host-/Docker-beheerders hebben beheertoegang.
Een bestaande beheerder wordt nooit gereset. Start iedere nieuwe organisatie na bootstrap.

Laat DNS voor iedere hostnaam naar deze host wijzen. Caddy vraagt de HTTPS-certificaten aan
bij de eerste start. Bezoek vervolgens `https://a.example.com` en `https://b.example.com`.
Controleer in beide omgevingen dat gebruikers, processen en instellingen afzonderlijk zijn.

## Instellingen, SSO en AI

`hosting/.state/organizations.json` is het register; `compose.generated.json` en `Caddyfile`
zijn afgeleide bestanden. `provision.py render` maakt deze opnieuw. Bewaar handmatige
deploywijzigingen in een eigen Compose-overridebestand, niet in de gegenereerde bestanden.
Zie `compose.override.example.json` voor de vorm van een override zonder geheimen.
Kopieer dit uitsluitend voor een organisatie die Entra gebruikt, vul de eigen registratie in
en geef het bestand consequent als tweede `-f` aan elke Compose-opdracht mee. Zonder die
override blijft de standaard lokale login actief. Neem eigen overrides mee in de back-up.

Alle lokale accounts zijn per organisatie gescheiden. Voor Entra configureert de hostbeheerder
per organisatie `AuthMode=entra`, tenant/client/audience en groepsrollen in de eigen override.
De SPA-redirect en API-registratie horen bij de eigen hostnaam. Beheerders kunnen BYO AI
in hun eigen app configureren. De providercredential wordt met de eigen keyring versleuteld.
Lokale ChatGPT OAuth is uitgezet voor gehoste organisaties; deze gedeelde server mag geen
persoonlijk ChatGPT-abonnement als universele bedrijfskoppeling gebruiken.

De keyring staat in het organisatievolume en is versleuteld met het afzonderlijke
RSA-certificaat in `hosting/.state/secrets/<slug>/`. De hostmap is 0700; PEM-bestanden zijn
uitsluitend via deze map en de bedrijfsspecifieke Docker-secretmount bereikbaar. Neem bij
een verhuizing **zowel App_Data als deze certificaten en privésleutels** mee. Verwijder of
vervang het certificaat niet zonder een geplande keyrotatie/migratie.

## Gezondheid en updates

```bash
docker compose -f hosting/.state/compose.generated.json ps
docker compose -f hosting/.state/compose.generated.json logs --tail 100 app-organisatie-a
curl --fail https://a.example.com/api/health/ready
```

De app krijgt alleen zijn eigen volume en private brug. Uitgaand verkeer blijft beschikbaar
voor expliciet geconfigureerde AI, Entra en mail. De proxy-IP is expliciet vertrouwd; een
willekeurige externe Forwarded-header wordt niet als bron van HTTPS/authenticatie vertrouwd.

Maak vóór elke update de hieronder beschreven volledige back-up. Bouw en test de nieuwe
image in een aparte proefomgeving; update daarna met `up -d --no-deps app-<slug>` per bedrijf.
Een database-migratie kan downgrade onmogelijk maken. Rollback betekent daarom de vorige
image **en de bijbehorende gegevenssnapshot** terugzetten, eerst buiten de live omgeving.
Publiceer geen zelf opgegeven beschikbaarheid of hersteltijd voordat dit daadwerkelijk is gemeten.

## Volledige back-up en herstel op Linux

De automatische databaseback-up in de app is een extra herstelpunt. Deze bevat niet alle
instellingen of sleutels en is geen vervanging voor onderstaande volledige snapshot.

Onderstaand voorbeeld behandelt organisatie-a. Gebruik een beschermd back-upvolume buiten
de hostschijf voor de definitieve kopie. App_Data bevat ook de SQLite WAL/SHM-bestanden,
bijlagen, huisstijl, accountgegevens, AI-/OAuthinstellingen en keyring. De app moet gedurende
het kopiëren volledig gestopt blijven. Kopieer geen actieve SQLite-bestanden los.

```bash
set -eu
umask 077
BACKUP="/srv/spg-backups/organisatie-a-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP"
docker compose -f hosting/.state/compose.generated.json stop app-organisatie-a
CONTAINER="$(docker compose -f hosting/.state/compose.generated.json ps -aq app-organisatie-a)"
IMAGE="$(docker inspect --format '{{.Image}}' "$CONTAINER")"
printf '%s\n' "$IMAGE" > "$BACKUP/image-id.txt"
docker run --rm --network none --user 0 --entrypoint tar \
  --mount type=volume,src=spg-organisatie-a-data,dst=/data,readonly \
  --mount "type=bind,src=$BACKUP,dst=/backup" \
  "$IMAGE" -cpf /backup/App_Data.tar -C /data .
cp -r hosting/.state/secrets/organisatie-a "$BACKUP/secrets"
cp hosting/.state/organizations.json "$BACKUP/organizations.json"
cp hosting/.state/compose.generated.json "$BACKUP/compose.generated.json"
cp hosting/.state/Caddyfile "$BACKUP/Caddyfile"
docker image save "$IMAGE" -o "$BACKUP/image.tar"
(cd "$BACKUP" && sha256sum App_Data.tar image.tar image-id.txt organizations.json compose.generated.json Caddyfile secrets/*.pem > SHA256SUMS)
docker compose -f hosting/.state/compose.generated.json start app-organisatie-a
```

Controleer elke exitcode. Bij een fout vóór de laatste stap blijft het bedrijf gestopt: herstel
de oorzaak of start expliciet de bestaande app. Bewaar de snapshot versleuteld en buiten de
host; de PEM-privésleutel is noodzakelijk voor herstel en daarom gevoelig. Een volledige
hostrecovery vraagt daarnaast de overige bedrijfssleutels/volumes en de Caddy-volumes
`spg-hosting_caddy-data` en `spg-hosting_caddy-config`; die zijn niet inbegrepen in dit
bedrijfsspecifieke voorbeeld. SSO-registraties, DNS en externe secrets beheert de hostbeheerder apart.

Herstel eerst op een **aparte herstelhost**, zonder live DNS-verwijzing:

1. Controleer `(cd "$BACKUP" && sha256sum -c SHA256SUMS)` voordat iets wordt gestart.
2. Laad de bijbehorende image: `docker image load -i "$BACKUP/image.tar"`. Lees de vastgelegde
   image-id met `IMAGE="$(cat "$BACKUP/image-id.txt")"` en tag die op deze aparte herstelhost
   als `service-procesgids:local`: `docker tag "$IMAGE" service-procesgids:local`.
3. Maak de herstelde state-map op de herstelhost. Kopieer het organisatiesregister en de
   sleutelmap naar `hosting/.state/secrets/organisatie-a`. Zet de state-map en secrets-map op
   0700. Behoud in het register alleen de te herstellen organisatie; `provision.py render`
   valideert het register en genereert paden voor de herstelhost. Gebruik voor de proef een
   eigen testhostnaam. **Gebruik niet opnieuw `add`**, want dat maakt een andere sleutel.
4. Maak het nog niet bestaande herstelvolume `docker volume create spg-organisatie-a-data`.
   Controleer dat dit volume leeg is. Gebruik nooit een bestaand live volume als hersteldoel.
5. Herstel de volledige map inclusief keyring, WAL/SHM en eigenaar:

   ```bash
   docker run --rm --network none --user 0 --entrypoint tar \
     --mount type=volume,src=spg-organisatie-a-data,dst=/data \
     --mount "type=bind,src=$BACKUP,dst=/backup,readonly" \
     service-procesgids:local -xpf /backup/App_Data.tar -C /data
   ```

6. Start de herstelde configuratie met Compose. **Voer geen adminbootstrap uit.** Controleer
   health, login, een bestaande procesversie, bijlagen en de ontsleutelbaarheid van een
   geconfigureerde providercredential. Test met uitgeschakelde mail/AI-uitvoering zodat een
   herstelproef geen berichten of providerverbruik veroorzaakt.
7. Leg de gemeten hersteltijd en uitkomst vast. Pas na acceptatie kan DNS over naar de nieuwe
   host. De oude omgeving blijft gestopt totdat de overstap is geverifieerd.

## Lokale verificatie van de generator

```bash
python3 -m unittest discover -s hosting -p 'test_*.py' -v
python3 hosting/smoke-isolation.py --image service-procesgids:local
```

De unittests verifiëren scheiding van volumes/netwerken/sleutels, veilige invoer, stabiele
netwerktoewijzing en weigering van dubbel aanmaken. De smoketest start twee wegwerpbedrijven
achter localhost-HTTPS en controleert login, weigering van een cookie uit het andere bedrijf,
afzonderlijke processen/PDF-bestanden en versleutelde keyrings. De test gebruikt alleen zelf
aangemaakte gegevens en verwijdert uitsluitend de eigen containers/volumes met unieke testnaam.
Daarna stopt hij bedrijf A, maakt een volledige App_Data-snapshot en herstelt die met de
bijbehorende sleutels naar een nieuw leeg volume. Hij vergelijkt bestanden, bytes en eigenaar
en controleert na de herstart de bestaande login, het proces en de PDF. Bedrijf B blijft draaien.
Voor de tijdelijke interne Caddy-certificaten wordt curl --insecure uitsluitend in deze lokale
test gebruikt. Acceptatie op de uiteindelijke Linux-host omvat daarnaast herstel van de externe
configuratie, TLS/DNS en eventueel gebruikte providercredentials en meting van de hersteltijd.
