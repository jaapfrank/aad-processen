# Authenticatie en publicatieworkflow

Uitvoeren vanuit de projectroot met de .NET 10 SDK:

```powershell
dotnet run --project backend/tests/AuthWorkflow.SelfTest/AuthWorkflow.SelfTest.csproj -c Release
```

Deze selftest maakt per scenario een eigen tijdelijke SQLite-database. Geen bestaande installatie, gebruikers, credentials of externe systemen worden benaderd. De test verwijdert uitsluitend de zelf aangemaakte tijdelijke map.

Getest: sessies intrekken na deactivatie, rolwijziging en wachtwoordreset; oude cookies weigeren; verwachte revisie verplicht stellen; stale review en replay weigeren; goedkeuring/snapshot/audit atomair bewaren; een echte concurrerende wijziging tussen lezen en transactiestart; blokkeren van een structureel ongeldig proces.

Workflowclients moeten bij submit, approve en reject de `expectedRevision` uit het bekeken document meesturen. Die waarde vlak voor de actie opnieuw ophalen is onveilig: daarmee zou ongeziene inhoud goedgekeurd kunnen worden. HTTP 409 betekent opnieuw laden en opnieuw beoordelen, geen automatische retry.
