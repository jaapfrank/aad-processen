# Hosting- en secretbeveiliging

```powershell
dotnet run --project backend/tests/HostingSecurity.SelfTest/HostingSecurity.SelfTest.csproj -c Release
```

De tests gebruiken uitsluitend tijdelijke bestanden, testcredentials en een tijdelijk RSA-certificaat; er zijn geen netwerkcalls of wijzigingen aan bestaande App_Data.

Getest: de werkelijke ASP.NET forwarded-headersmiddleware accepteert protocol/client-IP alleen van het geconfigureerde proxy-IP; lege/ongeldige proxyconfiguratie faalt veilig; Online vereist certificaat én privésleutel; de versleutelde Data Protection-keyring werkt na herstart; BC/SMTP/webhook-instellingen staan versleuteld op disk; plaintext migreert; corrupte ciphertext wordt nooit stil overschreven.

Dit zijn bouw- en integratiechecks van de applicatie. Een volledige Docker/Caddy-deploy, TLS-uitgifte en herstel op een tweede host blijven aparte acceptatiechecks.
