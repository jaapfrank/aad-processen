import type { Process } from '../contract'
import type { HealthIssue, HealthReport } from '@contract/model'

// Client-side spiegel van de server-side /health-regels (concept H9).
// De backend blijft autoritatief; dit geeft de bouwer directe feedback.

export function controleerGezondheid(
  proces: Process,
  bekendeProcessen: Set<string>,
): HealthReport {
  const issues: HealthIssue[] = []
  const stapIds = new Set(proces.stappen.map((s) => s.id))

  for (const s of proces.stappen) {
    if (!s.laneId)
      issues.push({
        stapId: s.id,
        soort: 'geen-verantwoordelijke',
        ernst: 'fout',
        bericht: `Stap ${s.nummer} heeft geen verantwoordelijke (lane).`,
      })

    const heeftVervolg =
      Boolean(s.naarStap) || Boolean(s.naarProces) || (s.routes?.length ?? 0) > 0
    if (!heeftVervolg && s.type !== 'eind' && s.type !== 'marker')
      issues.push({
        stapId: s.id,
        soort: 'geen-vervolg',
        ernst: 'waarschuwing',
        bericht: `Stap ${s.nummer} ("${s.activiteit.slice(0, 40)}…") heeft geen vervolg.`,
      })

    if (s.naarStap && !stapIds.has(s.naarStap))
      issues.push({
        stapId: s.id,
        soort: 'geen-vervolg',
        ernst: 'fout',
        bericht: `Stap ${s.nummer} verwijst naar onbekende stap "${s.naarStap}".`,
      })

    if (s.type === 'beslissing' && (s.routes?.length ?? 0) < 2)
      issues.push({
        stapId: s.id,
        soort: 'voorwaarde-zonder-route',
        ernst: 'waarschuwing',
        bericht: `Beslissing ${s.nummer} heeft minder dan 2 routes.`,
      })

    if (s.termijn && !s.waarschuwing)
      issues.push({
        stapId: s.id,
        soort: 'termijn-zonder-waarschuwing',
        ernst: 'info',
        bericht: `Stap ${s.nummer} heeft een termijn (${s.termijn}) zonder waarschuwing.`,
      })

    if (s.naarProces && !bekendeProcessen.has(s.naarProces))
      issues.push({
        stapId: s.id,
        soort: 'vervolgproces-bestaat-niet',
        ernst: 'waarschuwing',
        bericht: `Stap ${s.nummer} verwijst naar proces "${s.naarProces}" dat nog niet bestaat.`,
      })
  }

  const straf = issues.reduce(
    (acc, i) => acc + (i.ernst === 'fout' ? 15 : i.ernst === 'waarschuwing' ? 7 : 2),
    0,
  )
  return { score: Math.max(0, 100 - straf), issues }
}
