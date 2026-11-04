# Dependency-inventaris — 8 september 2026

Momentopname van de directe afhankelijkheden in de lokale broncode. Exacte npm-versies komen uit `frontend/package-lock.json` (lockfile v3); gewenste bereiken komen uit `frontend/package.json`. De vermelde licenties zijn alleen de door pakketten gedeclareerde metadata uit het lockfile of lokale NuGet `.nuspec`-bestand. Deze inventaris is geen volledige licentie- of IP-audit en geeft geen juridisch oordeel over overdraagbaarheid.

## Directe frontendafhankelijkheden

| Pakket | Bereik manifest | Exact in lockfile | Gedeclareerde licentie |
| --- | --- | --- | --- |
| @azure/msal-browser | ^5.13.0 | 5.13.0 | MIT |
| @xyflow/react | ^12.11.0 | 12.11.0 | MIT |
| react | ^19.2.6 | 19.2.7 | MIT |
| react-dom | ^19.2.6 | 19.2.7 | MIT |
| react-router-dom | ^7.17.0 | 7.18.1 | MIT |
| zustand | ^5.0.14 | 5.0.14 | MIT |

## Directe frontend bouw- en testafhankelijkheden

| Pakket | Bereik manifest | Exact in lockfile | Gedeclareerde licentie |
| --- | --- | --- | --- |
| @eslint/js | ^10.0.1 | 10.0.1 | MIT |
| @types/node | ^24.12.3 | 24.13.1 | MIT |
| @types/react | ^19.2.14 | 19.2.17 | MIT |
| @types/react-dom | ^19.2.3 | 19.2.3 | MIT |
| @vitejs/plugin-react | ^6.0.1 | 6.0.2 | MIT |
| eslint | ^10.3.0 | 10.4.1 | MIT |
| eslint-plugin-react-hooks | ^7.1.1 | 7.1.1 | MIT |
| eslint-plugin-react-refresh | ^0.5.2 | 0.5.2 | MIT |
| globals | ^17.6.0 | 17.6.0 | MIT |
| marked | ^18.0.5 | 18.0.5 | MIT |
| playwright | ^1.60.0 | 1.60.0 | Apache-2.0 |
| typescript | ~6.0.2 | 6.0.3 | Apache-2.0 |
| typescript-eslint | ^8.59.2 | 8.61.0 | MIT |
| vite | ^8.0.12 | 8.0.16 | MIT |

## Directe backendafhankelijkheden

Bron: `backend/src/ServiceProcesgids.Api/ServiceProcesgids.Api.csproj`. API en alle negen testprojecten richten zich op `net10.0`. De testprojecten hebben geen eigen directe PackageReferences; zij verwijzen naar de API. De ASP.NET Core shared framework komt via de .NET runtime.

| NuGet-pakket | Versie in project | Gedeclareerde licentie | Gebruik |
| --- | --- | --- | --- |
| Microsoft.AspNetCore.Authentication.JwtBearer | 10.0.11 | MIT | Applicatie |
| Microsoft.Extensions.Hosting.WindowsServices | 10.0.11 | MIT | Applicatie |
| Microsoft.EntityFrameworkCore.Design | 10.0.11 | MIT | Ontwikkel-/migratiegereedschap (PrivateAssets=all) |
| Microsoft.EntityFrameworkCore.Sqlite | 10.0.11 | MIT | Applicatie |
| Microsoft.EntityFrameworkCore.SqlServer | 10.0.11 | MIT | Applicatie |
| Microsoft.EntityFrameworkCore.Tools | 10.0.11 | MIT | Ontwikkel-/migratiegereedschap (PrivateAssets=all) |
| PdfPig | 0.1.14 | Apache-2.0 | Applicatie |
| PDFtoImage | 5.2.1 | MIT | Applicatie |

## Containerbases en hostgereedschap

Bron: `Dockerfile` en `hosting/provision.py`. De imageverwijzingen zijn op een digest vastgezet. Een gebouwde release-image blijft het overdrachtsartefact; registreer daarvan de uiteindelijke image-ID/digest bij de release.

| Fase | Vastgelegde image |
| --- | --- |
| frontend | `node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e` |
| build | `mcr.microsoft.com/dotnet/sdk:10.0@sha256:4beef5b8919dcaa2dc924233bd069257e883cc7a061e09088a97d152d6a48510` |
| runtime | `mcr.microsoft.com/dotnet/aspnet:10.0@sha256:011bb5f30180717b1c8b65822ff2c99bcb96bc65af0164589751b83c7b4949f7` |
| HTTPS-proxy | `caddy:2-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648` |

De runtime-image installeert ook `curl` (readinesscheck) en `libfontconfig1` (PDF-rendering) via apt. Hun concrete versies worden tijdens imagebouw opgelost en zijn niet afzonderlijk in de Dockerfile vastgezet. Inventariseer de gebouwde image bij definitieve overdracht voor alle OS- en transitieve native componenten. De hostingprocedure gebruikt daarnaast Docker Engine/Compose, Python 3 en OpenSSL op de host; deze hostinstallaties worden niet door het npm-lockfile of de csproj beheerd.

## Reikwijdte van de overdracht

- Behoud de manifests en lockfile bij de release, plus de originele notices/licentieteksten van meegeleverde componenten. Deze lijst omvat de directe pakketten; transitieve npm-, NuGet-, native PDF- en OS-componenten zijn niet volledig juridisch onderzocht.
- Klantdocumenten, demo-inhoud, merkrechten en eventuele bijdragen van derden vragen eigen vastlegging; pakketmetadata bewijst daarvan geen eigendom of toestemming.
- Persoonlijke AI-credentials, persoonlijke OAuth-sessies en ontwikkelaarsaccounts horen niet in een overdrachtspakket. Configureer provideraccounts per bedrijf; neem voor operationeel herstel alleen de afgesproken bedrijfsgegevens en bijbehorende beveiligde sleutels op.
- Deze inventaris verklaart geen kwetsbaarhedenscan, live provideracceptatie of volledige software bill of materials. Zij is uit lokale bestanden samengesteld zonder nieuwe dependencies te installeren.
