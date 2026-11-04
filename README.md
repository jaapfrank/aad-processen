# Procesgids

**Ontwerp en verbeter processen met AI, en maak er werkinstructies van die medewerkers stap voor stap kunnen volgen.**

Procesgids is een webapplicatie voor organisaties die hun werkprocessen centraal willen vastleggen, publiceren en verbeteren. Medewerkers zien welke stap bij hun rol hoort. Procesbeheerders kunnen wijzigingen voorbereiden en laten beoordelen voordat ze zichtbaar worden op de werkvloer.

![Interactief procesdiagram met rollen en verbonden stappen](docs/images/procesgids-interactief.png)

## AI in Procesgids

| Functie | Wat je ermee kunt |
| --- | --- |
| **AI-assistent** | Stel vervolgvragen over je bestaande processen, bijvoorbeeld welke stappen een termijn hebben of hoe je een werkinstructie duidelijker maakt. Antwoorden kunnen verwijzen naar de betreffende processen. Met bewerkrechten kun je een voorstel uit het gesprek doorzetten naar AI-procesontwerp. |
| **AI-procesontwerp** | Begin met een beschrijving of een gesprek. AI stelt rollen, stappen, beslissingen en routes voor. Het ontwerpscherm laat open vragen, aannames en validatiemeldingen zien. Vul ontbrekende informatie aan, bekijk het diagram en open het goedgekeurde ontwerp in de editor om het als concept op te slaan. |
| **AI-procesonderhoud** | Analyseer een bestaand proces vanuit de editor. Bekijk onderhoudssignalen bij de betreffende stappen, beoordeel voorgestelde tekstwijzigingen en bekijk eerdere analyses en beoordelingen in de AI-runhistorie. Je controleert en bewaart aanpassingen zelf als concept. |

AI gebruikt de geconfigureerde provider via de backend. Publiceren verloopt via de normale rechten en beoordelingsworkflow. De lokale portfolio-demo toont de interface met voorbeeldgegevens. Voor echte AI-aanroepen configureert een beheerder de koppeling. [AI configureren](docs/deploy.md#8-ai-assistent-en-openai-koppeling-optioneel)

## Van ontwerp tot uitvoering en audit

| Onderdeel | Wat je ermee kunt |
| --- | --- |
| **Visuele proceseditor** | Modelleer met zwembanen, rollen, acties, beslissingen en subprocessen. Voeg formulieren en controles toe. Bekijk dezelfde werkwijze als interactief diagram, tabel of in weergaven zoals flowchart, BPMN en SIPOC. |
| **Import en export** | Neem bestaande processen over uit onder meer Visio, draw.io, Lucidchart, PDF of een CSV/TSV-tabel. Controleer bij Visio de gekozen pagina, rollen en herkende verbindingen voordat je verdergaat in de editor. De mogelijkheden hangen af van het bestandsformaat. |
| **Procesmanager en publicatie** | Bekijk concepten, ingediende wijzigingen, feedback en borgingssignalen. Dien een werkversie in voor review, vergelijk revisies en publiceer na goedkeuring. |
| **Stap voor stap** | Doorloop een gepubliceerde werkinstructie vanaf het passende startpunt. Kies bij beslissingen het vervolg en voer verplichte controles uit. Medewerkers kunnen ook zoeken, favoriete processen bewaren en verbetersuggesties indienen. |
| **Procesatlas** | Zie hoe werkstromen aan elkaar gekoppeld zijn en klik door van een hoofdproces naar een subproces. |
| **Normcoach en auditvoorbereiding** | Doorloop vragen per gekozen normenkader, leg bevindingen vast en vertaal verbeterpunten naar procesconcepten. Koppel processen en stappen aan normen en volg reviewdata en ontbrekend bewijs in de auditomgeving. |
| **Organisatiebeheersing** | Breng normen, risico’s, maatregelen, bewijs en opvolging bij elkaar. Plan controles en bekijk het actuele beheersingsbeeld. |
| **Beheer en toegang** | Gebruik lokale accounts of Microsoft Entra ID en wijs rechten toe voor kijken, suggesties, bewerken, goedkeuren en beheren. |

## Screenshots

De beelden komen uit de lokale demo. Klik op een screenshot om het op ware grootte te bekijken.

| Procesmanager | Procesatlas |
| --- | --- |
| [![Dashboard met werkvoorraad en signalen](docs/images/procesmanager.png)](docs/images/procesmanager.png) | [![Procesketen met gekoppelde subprocessen](docs/images/procesatlas.png)](docs/images/procesatlas.png) |
| Volg reviews, concepten en signalen op. | Bekijk waar processen op elkaar aansluiten. |

| Proceseditor | Stap voor stap |
| --- | --- |
| [![Visuele editor met zwembanen en procesinstellingen](docs/images/proceseditor.png)](docs/images/proceseditor.png) | [![Keuze tussen twee startroutes voor een retouraanvraag](docs/images/stap-voor-stap.png)](docs/images/stap-voor-stap.png) |
| Bewerk processtappen, rollen en routes. | Kies als medewerker de route die past bij je situatie. |

## Probeer de demo

Installeer [Node.js 24](https://nodejs.org/) en voer vanuit de repository uit:

```bash
cd frontend
npm ci
npm run dev:demo
```

Open het lokale adres dat Vite toont. Kies op het overzicht **Service – Aanvraagproces**, wissel tussen **Visualisatie** en **Tabel** en volg daarna een proces via **Stap voor stap**. Open **Procesatlas** om de samenhang tussen processen te bekijken. De demo draait met meegeleverde voorbeeldgegevens, zonder backend of account. Open **AI-assistent** of **AI-procesontwerp** om de schermen voor vragen en procesontwerp te bekijken.

## Onder de motorkap

- **Frontend** met React, TypeScript, Vite, React Flow en Zustand.
- **Backend** met ASP.NET Core op .NET 10, EF Core en SQLite. De API controleert rollen voor bewerken, goedkeuren en publiceren.
- **Gedeeld contract** met OpenAPI, TypeScript-typen en voorbeeldgegevens.
- **Hosting** met Docker en afzonderlijke data en configuratie per organisatie.

Voor lokale ontwikkeling met de echte API en voor een eigen installatie staan de stappen in de [frontendhandleiding](frontend/README.md), [backendhandleiding](backend/README.md) en [hostinghandleiding](hosting/README.md).

Deze portfolio-uitgave gebruikt geanonimiseerde voorbeeldbestanden. De bron-pdf en bijbehorende visuele referenties zijn buiten deze uitgave gehouden. Tests die deze bestanden lezen, hebben de oorspronkelijke testbestanden nodig.

## Kennismaken

Wil je zien hoe Procesgids aansluit op de werkprocessen van jouw organisatie? Neem contact op via het [GitHub-profiel van Jaap Frank](https://github.com/jaapfrank) voor een demonstratie.
