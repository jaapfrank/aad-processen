import { useEffect, useState } from 'react'
import { dataSource } from '../data'
import type { Role } from '../contract'
import { useHuisstijl, pasHuisstijlToe, STANDAARD, type Huisstijl } from '../lib/huisstijl'

const rollen: Role[] = ['kijken', 'suggesties', 'bewerken', 'goedkeuren', 'beheren']

/** 💾 Back-upbeheer: lijst, handmatig back-uppen, downloaden, schema. */
export function BackupBeheer() {
  const [items, setItems] = useState<Array<{ naam: string; bytes: number; gemaaktOp: string }> | null>(null)
  const [melding, setMelding] = useState('')
  const [schema, setSchema] = useState({ intervalUren: 24, retentie: 14, extraDoelmap: '' })
  const [schemaMelding, setSchemaMelding] = useState('')

  useEffect(() => {
    void dataSource
      .getBackupInstellingen()
      .then((s) =>
        setSchema({ intervalUren: s.intervalUren, retentie: s.retentie, extraDoelmap: s.extraDoelmap ?? '' }),
      )
      .catch(() => undefined)
  }, [])

  const bewaarSchema = async () => {
    setSchemaMelding('')
    try {
      await dataSource.saveBackupInstellingen({
        intervalUren: schema.intervalUren,
        retentie: schema.retentie,
        extraDoelmap: schema.extraDoelmap || null,
      })
      setSchemaMelding('✓ Opgeslagen — het schema gaat direct in (geen herstart nodig).')
    } catch (e) {
      setSchemaMelding(e instanceof Error ? e.message : 'Opslaan mislukt.')
    }
  }

  const laad = () =>
    dataSource
      .getBackups()
      .then(setItems)
      .catch((e: unknown) => {
        setItems([])
        setMelding(e instanceof Error ? e.message : 'Laden mislukt.')
      })

  useEffect(() => {
    void laad()

  }, [])

  const maakNu = async () => {
    setMelding('Bezig met back-uppen…')
    try {
      const r = await dataSource.createBackup()
      setMelding(`✓ Back-up gemaakt: ${r.naam}`)
      await laad()
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Back-up mislukt.')
    }
  }

  if (items === null) return <p className="muted">Laden…</p>

  return (
    <section>
      <p className="muted">
        Automatische back-ups draaien dagelijks (database + JSON-export, retentie 14). Neem de map{' '}
        <code>App_Data/</code> ook op in de server-back-up; zie <code>docs/deploy.md</code> §7 voor
        de restore-procedure.
      </p>
      <div className="bm-acties">
        <button className="btn-primair" onClick={() => void maakNu()}>
          💾 Nu back-uppen
        </button>
        {melding && <span className="muted">{melding}</span>}
      </div>
      <div className="be-blok nieuw-gebruiker">
        <h2>⏰ Back-upschema</h2>
        <div className="be-form">
          <label>
            Elke … uur
            <input
              type="number"
              min={1}
              max={168}
              value={schema.intervalUren}
              onChange={(e) => setSchema({ ...schema, intervalUren: Number(e.target.value) })}
            />
          </label>
          <label>
            Bewaar laatste … back-ups
            <input
              type="number"
              min={1}
              max={365}
              value={schema.retentie}
              onChange={(e) => setSchema({ ...schema, retentie: Number(e.target.value) })}
            />
          </label>
          <label className="breed">
            Extra doelmap (netwerkpad of OneDrive-map, optioneel)
            <input
              value={schema.extraDoelmap}
              placeholder={'bv. \\\\server\\backups\\procesgids of C:\\Users\\naam\\OneDrive\\Backups'}
              onChange={(e) => setSchema({ ...schema, extraDoelmap: e.target.value })}
            />
          </label>
        </div>
        <p className="muted">
          💡 <strong>OneDrive/SharePoint:</strong> kies een map binnen de lokale
          OneDrive-synchronisatiemap — de back-ups worden dan automatisch naar de cloud
          gesynchroniseerd. Elke back-up (database + JSON) wordt ook naar deze map gekopieerd.
        </p>
        <div className="bm-acties">
          <button className="btn-primair" onClick={() => void bewaarSchema()}>
            💾 Schema opslaan
          </button>
          {schemaMelding && <span className="muted">{schemaMelding}</span>}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="empty">Nog geen back-ups gevonden.</div>
      ) : (
        <table className="werkinstructie">
          <thead>
            <tr><th>Bestand</th><th>Grootte</th><th>Gemaakt</th><th></th></tr>
          </thead>
          <tbody>
            {items.map((b) => (
              <tr key={b.naam}>
                <td className="stap-nr">{b.naam}</td>
                <td>{(b.bytes / 1024).toFixed(0)} kB</td>
                <td>{new Date(b.gemaaktOp).toLocaleString('nl-NL')}</td>
                <td>
                  <a className="btn-tekst" href={dataSource.backupUrl(b.naam)} download>
                    ⬇️ download
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/** 🔐 AD/Entra-koppeling: instellingen die bij herstart actief worden. */
export function EntraBeheer() {
  const [vorm, setVorm] = useState({
    authMode: 'local',
    tenantId: '',
    clientId: '',
    groupRoleMappings: {} as Record<string, string[]>,
  })
  const [actief, setActief] = useState('')
  const [wachtOpHerstart, setWachtOpHerstart] = useState(false)
  const [melding, setMelding] = useState('')

  useEffect(() => {
    void dataSource
      .getEntraInstellingen()
      .then((s) => {
        setVorm({
          authMode: s.actieveAuthMode,
          tenantId: s.tenantId,
          clientId: s.clientId,
          groupRoleMappings: s.groupRoleMappings ?? {},
        })
        setActief(s.actieveAuthMode)
        setWachtOpHerstart(s.wachtOpHerstart)
      })
      .catch((e: unknown) => setMelding(e instanceof Error ? e.message : 'Laden mislukt.'))
  }, [])

  const opslaan = async () => {
    setMelding('')
    try {
      const r = await dataSource.saveEntraInstellingen(vorm)
      setMelding(`✓ ${r.melding}`)
      setWachtOpHerstart(true)
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Opslaan mislukt.')
    }
  }

  return (
    <section className="be-blok nieuw-gebruiker">
      <h2>🔐 Active Directory / Entra ID koppelen</h2>
      <p className="muted">
        Medewerkers loggen dan in met hun Microsoft-bedrijfsaccount; rollen komen uit AD-/Entra-groepen
        (on-prem AD doet mee via Azure AD Connect-sync). De gegevens komen uit de app-registratie in
        Entra (IT levert TenantId en ClientId).{' '}
        <strong>Wijzigingen worden actief na een herstart van de service.</strong>
      </p>
      <p>
        Actieve modus: <span className="pill pill-live">{actief}</span>
        {wachtOpHerstart && <span className="pill pill-in-review"> wijziging wacht op herstart</span>}
      </p>
      <div className="be-form">
        <label>
          Inlogmodus
          <select value={vorm.authMode} onChange={(e) => setVorm({ ...vorm, authMode: e.target.value })}>
            <option value="local">Lokaal (eigen accounts)</option>
            <option value="entra">Entra ID / Active Directory</option>
          </select>
        </label>
        <label>
          Tenant ID
          <input
            value={vorm.tenantId}
            placeholder="00000000-0000-…"
            onChange={(e) => setVorm({ ...vorm, tenantId: e.target.value })}
          />
        </label>
        <label className="breed">
          Client ID (app-registratie)
          <input
            value={vorm.clientId}
            placeholder="00000000-0000-…"
            onChange={(e) => setVorm({ ...vorm, clientId: e.target.value })}
          />
        </label>
      </div>
      <h3 className="entra-kop">AD-groepen per rol</h3>
      <p className="muted">
        Meerdere groepen per rol kan: scheid groepsnamen met komma's — leden van élk van die
        groepen krijgen de rol.
      </p>
      <div className="be-form entra-groepen">
        {rollen.map((rol) => (
          <label key={rol}>
            {rol}
            <input
              value={(vorm.groupRoleMappings[rol] ?? []).join(', ')}
              placeholder={`bv. SVC-Procesgids-${rol}, SVC-Teamleiders`}
              onChange={(e) =>
                setVorm({
                  ...vorm,
                  groupRoleMappings: {
                    ...vorm.groupRoleMappings,
                    [rol]: e.target.value.split(',').map((g) => g.trim()).filter(Boolean),
                  },
                })
              }
            />
          </label>
        ))}
      </div>
      <div className="bm-acties">
        <button className="btn-primair" onClick={() => void opslaan()}>
          💾 Opslaan
        </button>
        {melding && <span className="muted">{melding}</span>}
      </div>
    </section>
  )
}

/** 🔗 Business Central-koppeling (API v2.0, OAuth client-credentials). */
export function BcBeheer() {
  const [vorm, setVorm] = useState({
    tenantId: '',
    environment: 'production',
    companyId: '',
    clientId: '',
    clientSecret: '',
    extraEntiteit: '',
  })
  const [status, setStatus] = useState<{ heeftSecret: boolean; geconfigureerd: boolean } | null>(null)
  const [melding, setMelding] = useState('')
  const [testNummer, setTestNummer] = useState('')
  const [testResultaat, setTestResultaat] = useState('')

  useEffect(() => {
    void dataSource
      .getBcInstellingen()
      .then((s) => {
        setVorm({
          tenantId: s.tenantId,
          environment: s.environment,
          companyId: s.companyId,
          clientId: s.clientId,
          clientSecret: '',
          extraEntiteit: s.extraEntiteit,
        })
        setStatus({ heeftSecret: s.heeftSecret, geconfigureerd: s.geconfigureerd })
      })
      .catch((e: unknown) => setMelding(e instanceof Error ? e.message : 'Laden mislukt.'))
  }, [])

  const opslaan = async () => {
    setMelding('')
    try {
      await dataSource.saveBcInstellingen({
        tenantId: vorm.tenantId,
        environment: vorm.environment,
        companyId: vorm.companyId,
        clientId: vorm.clientId,
        clientSecret: vorm.clientSecret || undefined,
        extraEntiteit: vorm.extraEntiteit || undefined,
      })
      const s = await dataSource.getBcInstellingen()
      setStatus({ heeftSecret: s.heeftSecret, geconfigureerd: s.geconfigureerd })
      setVorm((v) => ({ ...v, clientSecret: '' }))
      setMelding('✓ Opgeslagen — direct actief.')
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Opslaan mislukt.')
    }
  }

  const test = async () => {
    setTestResultaat('Bezig…')
    try {
      const r = await dataSource.bcZoek(testNummer.trim())
      setTestResultaat(
        r.length === 0
          ? 'Verbinding OK, geen treffers voor dit nummer.'
          : r.map((t) => `${t.type} ${t.nummer} · ${t.klant ?? '?'} · ${t.status ?? ''}`).join(' | '),
      )
    } catch (e) {
      setTestResultaat(e instanceof Error ? e.message : 'Test mislukt.')
    }
  }

  return (
    <section className="be-blok nieuw-gebruiker">
      <h2>🔗 Business Central koppelen</h2>
      <p className="muted">
        Koppelt via de standaard <strong>API v2.0</strong> (OAuth client-credentials): registreer een
        app in Entra met API-machtiging voor Business Central en vul de gegevens hieronder in. De
        begeleide modus kan dan bij een RMA-/ordernummer direct de order- of creditinformatie tonen.
        Echte <em>sales return orders</em> vereisen een maatwerk-API-page in BC — vul die optioneel
        in als extra entiteit.
      </p>
      {status && (
        <p>
          Status:{' '}
          {status.geconfigureerd ? (
            <span className="pill pill-live">gekoppeld</span>
          ) : (
            <span className="pill pill-in-review">nog niet gekoppeld</span>
          )}
        </p>
      )}
      <div className="be-form">
        <label>
          Tenant ID
          <input value={vorm.tenantId} onChange={(e) => setVorm({ ...vorm, tenantId: e.target.value })} />
        </label>
        <label>
          Omgeving
          <input
            value={vorm.environment}
            placeholder="production"
            onChange={(e) => setVorm({ ...vorm, environment: e.target.value })}
          />
        </label>
        <label>
          Company ID
          <input
            value={vorm.companyId}
            placeholder="GUID van de administratie"
            onChange={(e) => setVorm({ ...vorm, companyId: e.target.value })}
          />
        </label>
        <label>
          Client ID
          <input value={vorm.clientId} onChange={(e) => setVorm({ ...vorm, clientId: e.target.value })} />
        </label>
        <label className="breed">
          Client secret {status?.heeftSecret ? '(leeg laten = huidige behouden)' : ''}
          <input
            type="password"
            value={vorm.clientSecret}
            placeholder={status?.heeftSecret ? '••••••••' : 'plak hier het secret'}
            onChange={(e) => setVorm({ ...vorm, clientSecret: e.target.value })}
          />
        </label>
        <label className="breed">
          Extra entiteit (optioneel, maatwerk RMA-page)
          <input
            value={vorm.extraEntiteit}
            placeholder="bv. salesReturnOrders (custom API-page)"
            onChange={(e) => setVorm({ ...vorm, extraEntiteit: e.target.value })}
          />
        </label>
      </div>
      <div className="bm-acties">
        <button className="btn-primair" onClick={() => void opslaan()}>
          💾 Opslaan
        </button>
        {melding && <span className="muted">{melding}</span>}
      </div>
      <div className="bm-acties">
        <input
          className="bc-test"
          value={testNummer}
          placeholder="Test: order-/RMA-nummer"
          onChange={(e) => setTestNummer(e.target.value)}
        />
        <button className="btn-secundair" disabled={!testNummer.trim()} onClick={() => void test()}>
          🔎 Test verbinding
        </button>
        {testResultaat && <span className="muted">{testResultaat}</span>}
      </div>
    </section>
  )
}

/** 📧 E-mail naar beheerders bij dezelfde gebeurtenissen als de webhook. */
function MailBlok() {
  const [vorm, setVorm] = useState({
    smtpHost: '',
    smtpPoort: 587,
    ssl: true,
    gebruiker: '',
    wachtwoord: '',
    afzender: '',
    ontvangers: '',
  })
  const [heeftWachtwoord, setHeeftWachtwoord] = useState(false)
  const [melding, setMelding] = useState('')

  useEffect(() => {
    void dataSource
      .getMailInstellingen()
      .then((m) => {
        setVorm({
          smtpHost: m.smtpHost,
          smtpPoort: m.smtpPoort,
          ssl: m.ssl,
          gebruiker: m.gebruiker,
          wachtwoord: '',
          afzender: m.afzender,
          ontvangers: m.ontvangers,
        })
        setHeeftWachtwoord(m.heeftWachtwoord)
      })
      .catch(() => undefined)
  }, [])

  const opslaan = async () => {
    setMelding('')
    try {
      await dataSource.saveMailInstellingen({
        smtpHost: vorm.smtpHost,
        smtpPoort: vorm.smtpPoort,
        ssl: vorm.ssl,
        gebruiker: vorm.gebruiker || undefined,
        wachtwoord: vorm.wachtwoord || undefined,
        afzender: vorm.afzender,
        ontvangers: vorm.ontvangers,
      })
      setVorm((v) => ({ ...v, wachtwoord: '' }))
      setMelding('✓ Opgeslagen.')
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Opslaan mislukt.')
    }
  }

  const test = async () => {
    setMelding('Testmail versturen…')
    try {
      const r = await dataSource.testMail()
      setMelding('✓ ' + r.melding)
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Test mislukt.')
    }
  }

  return (
    <div className="be-blok nieuw-gebruiker">
      <h2>📧 E-mail naar beheerders</h2>
      <p className="muted">
        Stuurt bij dezelfde gebeurtenissen ook een e-mail (bv. via Microsoft 365:
        host <code>smtp.office365.com</code>, poort 587, SSL aan).
      </p>
      <div className="be-form">
        <label>
          SMTP-host
          <input value={vorm.smtpHost} placeholder="smtp.office365.com" onChange={(e) => setVorm({ ...vorm, smtpHost: e.target.value })} />
        </label>
        <label>
          Poort
          <input type="number" value={vorm.smtpPoort} onChange={(e) => setVorm({ ...vorm, smtpPoort: Number(e.target.value) })} />
        </label>
        <label className="rol-optie">
          <input type="checkbox" checked={vorm.ssl} onChange={(e) => setVorm({ ...vorm, ssl: e.target.checked })} />
          SSL/TLS
        </label>
        <label>
          Gebruiker (optioneel)
          <input value={vorm.gebruiker} onChange={(e) => setVorm({ ...vorm, gebruiker: e.target.value })} />
        </label>
        <label>
          Wachtwoord {heeftWachtwoord ? '(leeg = behouden)' : ''}
          <input type="password" value={vorm.wachtwoord} placeholder={heeftWachtwoord ? '••••••••' : ''} onChange={(e) => setVorm({ ...vorm, wachtwoord: e.target.value })} />
        </label>
        <label>
          Afzender
          <input value={vorm.afzender} placeholder="procesgids@bedrijf.nl" onChange={(e) => setVorm({ ...vorm, afzender: e.target.value })} />
        </label>
        <label className="breed">
          Ontvangers (komma-gescheiden)
          <input value={vorm.ontvangers} placeholder="beheerder1@bedrijf.nl, beheerder2@bedrijf.nl" onChange={(e) => setVorm({ ...vorm, ontvangers: e.target.value })} />
        </label>
      </div>
      <div className="bm-acties">
        <button className="btn-primair" onClick={() => void opslaan()}>💾 Opslaan</button>
        <button className="btn-secundair" disabled={!vorm.smtpHost} onClick={() => void test()}>📧 Testmail</button>
        {melding && <span className="muted">{melding}</span>}
      </div>
    </div>
  )
}

/** 🔔 Meldingen via Teams/Slack-webhook bij suggesties, indienen en goedkeuren. */
export function MeldingenBeheer() {
  const [vorm, setVorm] = useState({
    webhookUrl: '',
    bijSuggestie: true,
    bijIndienen: true,
    bijGoedkeuren: true,
  })
  const [melding, setMelding] = useState('')

  useEffect(() => {
    void dataSource
      .getMeldingenInstellingen()
      .then((s) =>
        setVorm({
          webhookUrl: s.webhookUrl,
          bijSuggestie: s.bijSuggestie,
          bijIndienen: s.bijIndienen,
          bijGoedkeuren: s.bijGoedkeuren,
        }),
      )
      .catch((e: unknown) => setMelding(e instanceof Error ? e.message : 'Laden mislukt.'))
  }, [])

  const opslaan = async () => {
    setMelding('')
    try {
      await dataSource.saveMeldingenInstellingen(vorm)
      setMelding('✓ Opgeslagen — direct actief.')
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Opslaan mislukt.')
    }
  }

  const test = async () => {
    setMelding('Testmelding versturen…')
    try {
      const r = await dataSource.testMeldingen()
      setMelding(`✓ ${r.melding}`)
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Test mislukt.')
    }
  }

  return (
    <section className="be-blok nieuw-gebruiker">
      <h2>🔔 Meldingen (Teams / Slack)</h2>
      <p className="muted">
        Stuurt een bericht naar een <strong>incoming webhook</strong> (Teams-kanaal of Slack) bij
        gebeurtenissen in de procesgids. Maak in Teams een webhook aan via Kanaal → Connectoren →
        Incoming Webhook en plak de URL hieronder.
      </p>
      <div className="be-form">
        <label className="breed">
          Webhook-URL
          <input
            value={vorm.webhookUrl}
            placeholder="https://outlook.office.com/webhook/… of https://hooks.slack.com/…"
            onChange={(e) => setVorm({ ...vorm, webhookUrl: e.target.value })}
          />
        </label>
      </div>
      <div className="rollen-kiezer">
        <label className="rol-optie">
          <input
            type="checkbox"
            checked={vorm.bijSuggestie}
            onChange={(e) => setVorm({ ...vorm, bijSuggestie: e.target.checked })}
          />
          💬 bij nieuwe suggestie
        </label>
        <label className="rol-optie">
          <input
            type="checkbox"
            checked={vorm.bijIndienen}
            onChange={(e) => setVorm({ ...vorm, bijIndienen: e.target.checked })}
          />
          📤 bij indienen ter goedkeuring
        </label>
        <label className="rol-optie">
          <input
            type="checkbox"
            checked={vorm.bijGoedkeuren}
            onChange={(e) => setVorm({ ...vorm, bijGoedkeuren: e.target.checked })}
          />
          ✅ bij goedkeuren
        </label>
      </div>
      <div className="bm-acties">
        <button className="btn-primair" onClick={() => void opslaan()}>
          💾 Opslaan
        </button>
        <button className="btn-secundair" disabled={!vorm.webhookUrl} onClick={() => void test()}>
          🔔 Test
        </button>
        {melding && <span className="muted">{melding}</span>}
      </div>
      <MailBlok />
    </section>
  )
}

/** 🎨 Eigen huisstijl: naam, kleuren en logo — direct overal toegepast. */
export function HuisstijlBeheer() {
  const { stijl } = useHuisstijl()
  const [vorm, setVorm] = useState<Huisstijl>(stijl)
  const [melding, setMelding] = useState('')

  const opslaan = async () => {
    setMelding('')
    try {
      await dataSource.saveBranding(vorm)
      pasHuisstijlToe(vorm)
      setMelding('✓ Opgeslagen — de huisstijl is direct actief, ook op het inlogscherm.')
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Opslaan mislukt.')
    }
  }

  const reset = async () => {
    setMelding('')
    try {
      await dataSource.resetBranding()
      pasHuisstijlToe(STANDAARD)
      setVorm(STANDAARD)
      setMelding('✓ Teruggezet naar de standaardstijl.')
    } catch (e) {
      setMelding(e instanceof Error ? e.message : 'Terugzetten mislukt.')
    }
  }

  const leesLogo = (f: File) => {
    if (f.size > 280_000) {
      setMelding('Logo is te groot (max ±280 kB). Tip: gebruik SVG of een kleine PNG.')
      return
    }
    const lezer = new FileReader()
    lezer.onload = () => setVorm((v) => ({ ...v, logoDataUrl: String(lezer.result) }))
    lezer.readAsDataURL(f)
  }

  return (
    <section className="be-blok nieuw-gebruiker">
      <h2>🎨 Eigen huisstijl</h2>
      <p className="muted">
        Zet de gids in de huisstijl van het bedrijf: naam, kleuren en logo gelden voor alle
        schermen, inclusief inloggen en kiosk. Wijzigingen zijn direct actief voor iedereen.
      </p>
      <div className="be-form">
        <label>
          Bedrijfsnaam
          <input
            value={vorm.bedrijfsnaam}
            onChange={(e) => setVorm({ ...vorm, bedrijfsnaam: e.target.value })}
          />
        </label>
        <label>
          App-naam
          <input value={vorm.appNaam} onChange={(e) => setVorm({ ...vorm, appNaam: e.target.value })} />
        </label>
        <label>
          Primaire kleur
          <input
            type="color"
            value={vorm.primaireKleur}
            onChange={(e) => setVorm({ ...vorm, primaireKleur: e.target.value })}
          />
        </label>
        <label>
          Accentkleur
          <input
            type="color"
            value={vorm.accentKleur}
            onChange={(e) => setVorm({ ...vorm, accentKleur: e.target.value })}
          />
        </label>
        <label className="breed">
          Logo (PNG/SVG/JPG, max ±280 kB; leeg = tekstmerk)
          <input
            type="file"
            accept="image/png,image/svg+xml,image/jpeg"
            onChange={(e) => e.target.files?.[0] && leesLogo(e.target.files[0])}
          />
        </label>
      </div>
      <div className="huisstijl-preview" style={{ borderColor: vorm.primaireKleur }}>
        {vorm.logoDataUrl ? (
          <img className="brand-logo" src={vorm.logoDataUrl} alt={vorm.bedrijfsnaam} />
        ) : (
          <span className="brand-mark" style={{ color: vorm.primaireKleur, borderBottomColor: vorm.accentKleur }}>
            {vorm.bedrijfsnaam || 'Bedrijf'}
          </span>
        )}
        <span className="brand-title">{vorm.appNaam || 'Procesgids'}</span>
        <button className="btn-primair" style={{ background: vorm.primaireKleur }} type="button">
          Voorbeeldknop
        </button>
      </div>
      <div className="bm-acties">
        <button className="btn-primair" onClick={() => void opslaan()}>
          💾 Opslaan
        </button>
        <button className="btn-tekst" onClick={() => void reset()}>
          ↺ Standaard huisstijl
        </button>
        {vorm.logoDataUrl && (
          <button className="btn-tekst" onClick={() => setVorm({ ...vorm, logoDataUrl: null })}>
            🗑️ logo weghalen
          </button>
        )}
        {melding && <span className="muted">{melding}</span>}
      </div>
    </section>
  )
}
