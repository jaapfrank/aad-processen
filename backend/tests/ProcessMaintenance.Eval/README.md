# Process Maintenance offline eval

Deterministische beveiligings- en contractevaluatie voor de AI
Process Maintenance-backend. De harness gebruikt uitsluitend een fake
`IAiStructuredClient`; er wordt geen provider, credential of netwerk aangeroepen.

Uitvoeren:

```bash
dotnet run --project backend/tests/ProcessMaintenance.Eval/ProcessMaintenance.Eval.csproj
```

De evaluatie dekt een geldig conceptvoorstel, gebundelde blocking questions,
bron- en oude-waardevalidatie, formele complianceclaims, strict JSON/schema,
revision-races vóór en na de fake modelcall en een prompt-injectionpoging die
menselijke bevestiging probeert uit te schakelen.

Iedere case gebruikt een nieuwe SQLite in-memorydatabase. Een mislukte case geeft
een non-zero exitcode, zodat dezelfde executable als CI-releasegate kan dienen.
