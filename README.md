# Procesgids

**Ontwerp en verbeter processen met AI, en maak er werkinstructies van die medewerkers stap voor stap kunnen volgen.**

Procesgids is een webapplicatie voor organisaties die hun werkprocessen centraal willen vastleggen, publiceren en verbeteren. Medewerkers zien welke stap bij hun rol hoort. Procesbeheerders kunnen wijzigingen voorbereiden en laten beoordelen voordat ze zichtbaar worden op de werkvloer.

![Interactief procesdiagram met rollen en verbonden stappen](docs/images/procesgids-interactief.png)

[Ontwerpen en tekenen](#processen-ontwerpen-en-tekenen) · [Normen en borging](#normen-audits-en-borging) · [AI-functies](#ai-in-procesgids) · [Screenshots](#screenshots) · [Demo starten](#probeer-de-demo) · [Functieoverzicht](docs/FUNCTIEOVERZICHT.md)

## AI in Procesgids

| Functie | Wat je ermee kunt |
| --- | --- |
| **AI-assistent** | Stel vervolgvragen over je bestaande processen, bijvoorbeeld welke stappen een termijn hebben of hoe je een werkinstructie duidelijker maakt. Antwoorden kunnen verwijzen naar de betreffende processen. Met bewerkrechten kun je een voorstel uit het gesprek doorzetten naar AI-procesontwerp. |
| **AI-procesontwerp** | Begin met een beschrijving of een gesprek. AI stelt rollen, stappen, beslissingen en routes voor. Het ontwerpscherm laat open vragen, aannames en validatiemeldingen zien. Vul ontbrekende informatie aan, bekijk het diagram en open het goedgekeurde ontwerp in de editor om het als concept op te slaan. |
| **AI-procesonderhoud** | Analyseer een bestaand proces vanuit de editor. Bekijk onderhoudssignalen bij de betreffende stappen, beoordeel voorgestelde tekstwijzigingen en bekijk eerdere analyses en beoordelingen in de AI-runhistorie. Je controleert en bewaart aanpassingen zelf als concept. |

AI gebruikt de geconfigureerde provider via de backend. Publiceren verloopt via de normale rechten en beoordelingsworkflow. De lokale portfolio-demo toont de interface met voorbeeldgegevens. Voor echte AI-aanroepen configureert een beheerder de koppeling. [AI configureren](docs/deploy.md#8-ai-assistent-en-openai-koppeling-optioneel)

## Processen ontwerpen en tekenen

- **Teken zelf op het canvas.** Maak rollen en zwembanen aan en plaats startpunten, acties, beslissingen, berichten, subprocessen en eindpunten. Verbind stappen, geef beslisroutes een naam en leg vast wie welke stap uitvoert. Gebruik automatische indeling, zoom en ongedaan maken tijdens het tekenen.
- **Werk de instructie per stap uit.** Leg activiteiten, toelichtingen en beslisroutes vast. Gebruik **Formulieren & controles** om de details te bewerken en stappen binnen of tussen secties te verplaatsen. De gezondheidscontrole wijst op problemen in de processtructuur.
- **Bekijk hetzelfde model vanuit verschillende invalshoeken.** Wissel tussen brongetrouwe visualisatie, interactief diagram, flowchart, BPMN-weergave, SIPOC, value stream en tabel. Filter op rol of open de Procesatlas om te zien waar een proces overgaat in een ander proces.
- **Neem bestaande diagrammen over.** Importeer uit Visio (.vsdx), draw.io en Lucid Standard, of gebruik PDF- en CSV/TSV-import voor geschikte procesdocumenten en tabellen. Controleer bij Visio de gekozen pagina, rollen en verbindingen voordat je verder tekent. Exporteer naar onder meer bewerkbare Visio- of draw.io-bestanden. De uitwisseling hangt af van het formaat.

## Normen, audits en borging

| Onderdeel | Hoe het werkt |
| --- | --- |
| **Normscope** | Kies de kaders die voor je organisatie van toepassing zijn. De ingebouwde catalogus bevat onder meer ISO 9001, ISO/IEC 27001, ISO 14001, ISO 45001, ISO 22301, BPMN, NIS2 en AVG. Welke toetsen en controles beschikbaar zijn, verschilt per kader. |
| **Eigen normenkaders** | Werk een kader uit als concept, beoordeel het en publiceer het in de catalogus. Een beheerder activeert het daarna afzonderlijk in de normscope. Met een AI-koppeling kun je ondersteuning krijgen bij het uitwerken van een kaderconcept. |
| **Normcoach** | Start een normtoets en loop vragen door met aanwijzingen voor het verwachte bewijs. Leg je antwoord, motivering en bewijsreferentie vast. Koppel een afwijking aan een proces en open die in de editor als mogelijke verbetering. |
| **Normen & audits** | Bekijk normkoppelingen en het overzicht per proces in de auditmatrix. Gebruik de proceskadercontrole voor ondersteunde kaders om aandachtspunten in het procesmodel te vinden. Bij een geselecteerde stap zijn relevante kaderbevindingen in de editor zichtbaar. |
| **Organisatiebeheersing** | Bekijk normen en verplichtingen, risico’s en maatregelen, audits en bewijs, en openstaande opvolging in samenhang. Gebruik het overzicht van geplande controles en het actuele beheersingsbeeld om het werk te verdelen en op te volgen. |
| **Borging in de tijd** | Maak eigenaarschap en reviewritme zichtbaar. Gebruik signalen zoals ontbrekend eigenaarschap of een verlopen review om processen opnieuw te beoordelen. Leg de uitkomst en het bewijs van controles vast en volg verbeteringen op. |

Een kwaliteitsmanager kan bijvoorbeeld een normvraag beantwoorden, de bewijsreferentie vastleggen en een afwijking koppelen aan het proces waarin ze optreedt. De procesbeheerder kan de bevinding in de editor openen en een aanpassing als concept uitwerken, eventueel met een AI-tekstvoorstel. Beoordeling van de proceswijziging en sluiting van de bevinding zijn afzonderlijke menselijke besluiten. De normtoets ondersteunt auditvoorbereiding en opvolging.

## Publiceren en werken met processen

- **Procesmanager.** Bekijk ingediende wijzigingen, concepten, feedback en borgingssignalen vanuit één werkoverzicht. Vergelijk revisies, dien een werkversie in voor review en publiceer na goedkeuring.
- **Werkinstructies.** Zoek processen, bewaar favorieten, open de gepubliceerde versie als plaat of tabel en bekijk wie verantwoordelijk is per stap. Medewerkers kunnen verbetersuggesties indienen vanuit een processtap.
- **Stap voor stap.** Kies het startpunt dat bij de situatie past, volg de beslisroute en doorloop de verplichte controles. Zo kan een medewerker bijvoorbeeld dezelfde retouraanvraag via de website of via de interne service starten.
- **Toegang.** Gebruik lokale accounts of Microsoft Entra ID. Ken rechten toe voor kijken, suggesties, bewerken, goedkeuren en beheren.

## Overige functies en koppelingen

| Onderdeel | Wat er beschikbaar is |
| --- | --- |
| **Werkvloer** | Proceszoeken, favorieten, rolfilters, detail per stap, afdrukweergave, kioskmodus, oefenmodus, persoonlijke punten en badges en een ingebouwde gebruikersgids. |
| **Samenwerking** | Suggesties vanuit een processtap, afhandeling door beheerders, versieverschillen, archivering en een auditlog voor acties en menselijke beoordelingen. |
| **Koppelingen** | Microsoft Dynamics 365 Business Central voor order- en creditinformatie, e-mailmeldingen en Teams- of Slack-webhooks. |
| **Organisatiebeheer** | Gebruikers en rollen, lokale inlog of Entra ID, eigen naam, kleuren en logo, geplande back-ups en beheer van AI-providers en sleutels. |

Bekijk ook het [volledige functieoverzicht per scherm](docs/FUNCTIEOVERZICHT.md) voor de mogelijkheden, benodigde rechten en koppelingen.

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
