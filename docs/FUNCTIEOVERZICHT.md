# Functieoverzicht van Procesgids

De beschikbare handelingen hangen af van je rol, de gekozen normscope en de geconfigureerde koppelingen. De lokale demo gebruikt voorbeeldgegevens. Functies die opslag, organisatiebeheer of een externe koppeling vereisen, horen bij de omgeving met backend.

## Werkinstructies op de werkvloer

| Scherm | Functies |
| --- | --- |
| **Processen en Zoeken** | Blader door gepubliceerde werkwijzen, zoek door procesnamen en stapinformatie en bewaar favorieten. Gebruikers met werkruimterechten kunnen wisselen tussen werkversies en gepubliceerde processen. |
| **Procesdetail** | Bekijk de plaat of de instructietabel. Filter op rol, open details van een stap, navigeer naar een gekoppeld subproces en stuur een verbetersuggestie vanuit een stap. Gebruik de afdrukweergave of bestandsexport om het proces te delen. |
| **Stap voor stap** | Kies een startpunt, volg vertakkingen, doorloop verplichte controles en werk met sessievoortgang. Er is ook een oefenmodus. |
| **Procesatlas** | Bekijk de procesketen als een klikbaar netwerk en zie welke subprocessen al zijn vastgelegd. |
| **Kiosk** | Open een vereenvoudigde procesweergave voor een scherm op de werkvloer. |
| **Mijn voortgang en Gids** | Bekijk persoonlijke punten en badges en raadpleeg de ingebouwde gebruikersgids. |

## Ontwerpen, valideren en uitwisselen

| Scherm | Functies |
| --- | --- |
| **Proceseditor** | Begin met een leeg model, kopieer een bestaand proces of open een werkversie. Teken zwembanen, voeg startpunten, acties, beslissingen, berichten, subprocessen en eindpunten toe en verbind ze. Benoem keuzeroutes en bewerk rollen, secties en stapeigenschappen. Gebruik automatisch indelen, dupliceren, ongedaan maken, zoomen en volledig scherm. |
| **Formulieren & controles** | Bewerk detailvelden, verplaats stappen binnen of tussen secties met slepen of toetsenbordbediening en controleer het resultaat in de tabel en procesvisualisaties. Bekijk de gezondheidscontrole voor structuurproblemen. |
| **Visualisaties** | Wissel tussen brongetrouw, interactief, flowchart, BPMN, SIPOC, value stream en tabel. |
| **Diagramuitwisseling** | Importeer en exporteer Visio (.vsdx), draw.io en Lucid Standard met mogelijkheden per formaat. Kies bij Visio een pagina, controleer herkende verbindingen en wijs zo nodig verantwoordelijke rollen toe. |
| **Documenten en data** | Controleer en verwerk geëxtraheerde procesinformatie uit een PDF, koppel CSV/TSV-kolommen aan procesvelden of gebruik JSON-import en -export. |

## Samenwerken en publiceren

- **Procesmanager** verzamelt concepten, reviews, feedback en borgingssignalen. Vanuit dit overzicht kun je ook starten met tekenen, importeren of AI-procesontwerp.
- **Werkversies** kunnen worden opgeslagen, ingediend, goedgekeurd of afgewezen. Bekijk de versiehistorie en vergelijk revisies. Archiveer processen waarvoor je beheerrechten hebt.
- **Suggestiebeheer** toont feedback van medewerkers zodat bevoegde gebruikers voorstellen kunnen opvolgen en afhandelen.
- **Auditlog** toont geregistreerde beheer- en workflowacties en menselijke beoordelingen.

## AI van eerste schets tot onderhoud

- **AI-assistent** beantwoordt vragen over processen, kan verwijzen naar relevante processen en werkt ideeën in gesprek uit. Zet een voorstel door naar procesontwerp als je bewerkrechten hebt.
- **AI-procesontwerp** maakt vanuit een beschrijving of gesprek een voorstel met rollen, stappen en routes. Beantwoord open vragen, controleer aannames en validatie, bekijk de preview en open het voorstel na acceptatie in de editor.
- **AI-procesonderhoud** markeert signalen bij de betreffende processtappen en kan controleerbare tekstwijzigingen voorstellen. Bekijk eerdere analyses en je beoordeling in de AI-runhistorie.
- **AI bij normenkaders en bevindingen** ondersteunt het opstellen van een kaderconcept en kan vanuit een gekoppelde normbevinding een tekstvoorstel voor procesverbetering uitwerken.
- **AI-providerbeheer** ondersteunt uitgeschakeld, centraal geregeld of een eigen API-sleutel. Afhankelijk van de omgeving kan een beheerder een verbinding testen en sleutels roteren, intrekken of wissen. [Configuratie](deploy.md#8-ai-assistent-en-openai-koppeling-optioneel)

## Normen, audits en organisatiebeheersing

| Scherm | Functies |
| --- | --- |
| **Normenkaders** | Kies de kaders die van toepassing zijn. De catalogus bevat onder andere ISO 9001, ISO/IEC 27001, ISO 14001, ISO 45001, ISO 22301, BPMN, NIS2 en AVG. Ontwerp en beoordeel eigen kaderconcepten. Na publicatie in de catalogus kan een beheerder ze activeren. |
| **Normcoach** | Start en vervolg normtoetsen. Leg antwoorden, motivering en bewijsreferenties vast. Volg de voortgang per toets en koppel een afwijking aan een proces voor opvolging. |
| **Normen & audits** | Bekijk de auditmatrix en borgingssignalen, koppel procesinformatie aan normen en exporteer het ISO-overzicht als CSV. Gebruik de proceskadercontrole voor ondersteunde kaders en open bevindingen bij de relevante processtap. |
| **Beheersing** | Bekijk normen en verplichtingen, risico’s en maatregelen, audits en bewijs, processen en opvolging samen. Raadpleeg geplande controles en het actuele beheersingsbeeld. |
| **Doorlopende borging** | Volg eigenaarschap, reviewritme, verlopen reviews en open verbeteringen. Gebruik proceswijzigingen en controle-uitkomsten als input voor volgende beoordelingen. |

## Beheer, koppelingen en hosting

| Onderdeel | Functies |
| --- | --- |
| **Accounts en autorisatie** | Beheer lokale accounts en wachtwoorden of koppel Microsoft Entra ID en wijs groepen toe aan rollen. De backend bewaakt rechten voor kijken, suggesties, bewerken, goedkeuren en beheren. |
| **Eigen huisstijl** | Stel organisatienaam, logo en kleuren in. |
| **Microsoft Dynamics 365 Business Central** | Zoek vanuit de begeleide modus naar order- of creditinformatie op nummer. Zoekopdrachten voor specifieke retourorders kunnen een eigen Business Central API-pagina vereisen. |
| **Meldingen** | Configureer e-mail naar beheerders of een Teams- of Slack-webhook voor gebeurtenissen zoals suggesties, indienen en goedkeuren. Test de verbinding vanuit Instellingen. |
| **Back-ups** | Maak en download back-ups vanuit beheer en stel een schema in. De hostinghandleiding beschrijft ook volledig herstel, inclusief bestanden en sleutels. |
| **Installatie** | Draai lokaal op Windows of host met Docker. De hostingopzet geeft iedere organisatie een eigen container, database, opslag en netwerk achter een gedeelde HTTPS-ingang. [Hostinghandleiding](../hosting/README.md) |
| **Technische integratie** | Raadpleeg het OpenAPI-contract voor integraties en de API-handleiding voor runtime- en opslagopties. [OpenAPI](../contract/openapi.yaml), [API-handleiding](../backend/README.md) |

[Terug naar de portfolio-README](../README.md)
