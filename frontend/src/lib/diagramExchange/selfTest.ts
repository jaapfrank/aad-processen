import type { Process } from '../../contract'
import { exportDrawIo, importDrawIo } from './drawio'
import { diagramLayoutUitGeometrie } from './layout'

export interface DrawIoSelfTestResult {
  ok: boolean
  checks: Record<string, boolean>
  messages: string[]
}

/** Gewone, ongecomprimeerde draw.io-flowchart zonder enige SPG-metadata. */
export const GENERIC_DRAWIO_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" compressed="false">
  <diagram id="generic-retour" name="Retour beoordelen">
    <mxGraphModel>
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <object label="Klant">
          <mxCell id="lane-customer" parent="1" vertex="1" style="swimlane;horizontal=0;fillColor=#dae8fc;">
            <mxGeometry x="0" y="0" width="240" height="760" as="geometry"/>
          </mxCell>
        </object>
        <mxCell id="lane-service" value="Service" parent="1" vertex="1" style="shape=swimlane;horizontal=0;fillColor=#ffe6cc;">
          <mxGeometry x="240" y="0" width="240" height="760" as="geometry"/>
        </mxCell>
        <object label="Start">
          <mxCell id="start" parent="lane-customer" vertex="1" style="shape=mxgraph.flowchart.start_1;">
            <mxGeometry x="20" y="60" width="160" height="60" as="geometry"/>
          </mxCell>
        </object>
        <mxCell id="register" value="Registreer retouraanvraag" parent="lane-service" vertex="1" style="rounded=1;">
          <mxGeometry x="20" y="160" width="190" height="60" as="geometry"/>
        </mxCell>
        <object label="Aanvraag compleet?">
          <mxCell id="decision" parent="lane-service" vertex="1" style="rhombus;whiteSpace=wrap;">
            <mxGeometry x="45" y="260" width="140" height="100" as="geometry"/>
          </mxCell>
        </object>
        <mxCell id="complete" value="Plan ontvangst" parent="lane-service" vertex="1" style="rounded=1;">
          <mxGeometry x="20" y="420" width="190" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="request-info" value="Vraag ontbrekende informatie" parent="lane-customer" vertex="1" style="rounded=1;">
          <mxGeometry x="20" y="420" width="190" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="end" value="Einde" parent="lane-service" vertex="1" style="shape=mxgraph.flowchart.terminator;">
          <mxGeometry x="35" y="590" width="170" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="e1" parent="1" edge="1" source="start" target="register">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="e2" parent="1" edge="1" source="register" target="decision">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <object label="Ja">
          <mxCell id="e-yes" parent="1" edge="1" source="decision" target="complete">
            <mxGeometry relative="1" as="geometry"/>
          </mxCell>
        </object>
        <mxCell id="e-no" value="Nee" parent="1" edge="1" source="decision" target="request-info">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="e3" parent="1" edge="1" source="complete" target="end">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="e4" parent="1" edge="1" source="request-info" target="end">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`

export function runGenericDrawIoSelfTest(): DrawIoSelfTestResult {
  const imported = importDrawIo(GENERIC_DRAWIO_FIXTURE)
  const decision = imported.process?.stappen.find((step) => step.type === 'beslissing')
  const missingRouteLabel = importDrawIo(GENERIC_DRAWIO_FIXTURE.replace('<object label="Ja">', '<object label="">'))
  const missingRole = importDrawIo(
    GENERIC_DRAWIO_FIXTURE.replace(
      'id="request-info" value="Vraag ontbrekende informatie" parent="lane-customer"',
      'id="request-info" value="Vraag ontbrekende informatie" parent="1"',
    ),
  )
  const checks = {
    genericImportSucceeded: imported.ok,
    genericNotMetadataBacked: imported.confidence.metadataBacked === false,
    genericSourceReported: imported.confidence.semanticSource === 'generic-structure',
    objectAndCellLabelsRead:
      imported.process?.lanes.some((lane) => lane.naam === 'Klant') === true &&
      imported.process?.lanes.some((lane) => lane.naam === 'Service') === true,
    explicitStartAndEnd:
      imported.process?.stappen.filter((step) => step.type === 'start').length === 1 &&
      imported.process?.stappen.filter((step) => step.type === 'eind').length === 1,
    decisionRoutesPreserved:
      decision?.routes?.length === 2 &&
      decision.routes.some((route) => route.label === 'Ja') &&
      decision.routes.some((route) => route.label === 'Nee'),
    laneParentsMapped:
      imported.process?.stappen.every((step) => Boolean(step.laneId)) === true,
    genericGeometryPresent: imported.geometry.length >= 13,
    missingRouteLabelRejected:
      !missingRouteLabel.ok &&
      missingRouteLabel.errors.some((error) => error.code === 'generic-decision-label-missing') &&
      missingRouteLabel.unmapped.some((item) => item.externalId === 'e-yes'),
    missingRoleRejected:
      !missingRole.ok &&
      missingRole.errors.some((error) => error.code === 'generic-step-role-missing') &&
      missingRole.unmapped.some((item) => item.externalId === 'request-info'),
  }
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    messages: [
      ...imported.errors.map((error) => `${error.code}: ${error.message}`),
      ...missingRouteLabel.errors.map((error) => `${error.code}: ${error.message}`),
      ...missingRole.errors.map((error) => `${error.code}: ${error.message}`),
    ],
  }
}

function normalized(process: Process): string {
  return JSON.stringify({
    ...process,
    diagramLayout: undefined,
    lanes: [...process.lanes].sort((a, b) => a.id.localeCompare(b.id)),
    secties: [...process.secties].sort((a, b) => a.id.localeCompare(b.id)),
    stappen: [...process.stappen]
      .map((step) => ({
        ...step,
        routes: step.routes ? [...step.routes].sort((a, b) => a.id.localeCompare(b.id)) : undefined,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  })
}

/**
 * Pure, handmatig/door een test-runner aanroepbare browser-selftest.
 * Controleert export, herimport en semantische gelijkheid zonder opslag of netwerk.
 */
export function runDrawIoSelfTest(process: Process): DrawIoSelfTestResult {
  const exported = exportDrawIo(process)
  const exportedContent = exported.content
  const imported = typeof exportedContent === 'string' ? importDrawIo(exportedContent) : null
  const firstStep = process.stappen[0]
  const manualPlacement = { x: 333, y: 444, width: 217, height: 91 }
  const manuallyPlaced: Process = {
    ...process,
    diagramLayout: {
      version: 1,
      coordinateSystem: 'px96-y-down',
      nodes: firstStep ? { [`step:${firstStep.id}`]: manualPlacement } : {},
    },
  }
  const manualExport = exportDrawIo(manuallyPlaced)
  const manualContent = manualExport.content
  const manualImport =
    typeof manualContent === 'string' ? importDrawIo(manualContent) : null
  const manualGeometry = manualImport?.geometry.find(
    (item) => item.semanticKind === 'step' && item.semanticId === firstStep?.id,
  )
  const invalidPlacement: Process = {
    ...process,
    diagramLayout: {
      version: 1,
      coordinateSystem: 'px96-y-down',
      nodes: firstStep
        ? {
            [`step:${firstStep.id}`]: {
              x: Number.NaN,
              y: Number.POSITIVE_INFINITY,
              width: -1,
              height: 0,
            },
          }
        : {},
    },
  }
  const fallbackExport = exportDrawIo(invalidPlacement)
  const fallbackContent = fallbackExport.content
  const fallbackImport =
    typeof fallbackContent === 'string' ? importDrawIo(fallbackContent) : null
  const fallbackGeometry = fallbackImport?.geometry.find(
    (item) => item.semanticKind === 'step' && item.semanticId === firstStep?.id,
  )
  const serverLayout = diagramLayoutUitGeometrie([
    {
      semanticKind: 'step',
      semanticId: 'inch-step',
      x: 1.25,
      y: 2,
      width: 2.5,
      height: 0.75,
      unit: 'in',
    },
    {
      semanticKind: 'lane',
      semanticId: 'niet-overnemen',
      x: 1,
      y: 1,
      unit: 'in',
    },
  ])
  const convertedInchStep = serverLayout?.nodes['step:inch-step']
  const checks = {
    exportSucceeded: exported.ok && Boolean(exported.content),
    importSucceeded: imported?.ok === true,
    noImportErrors: imported?.errors.length === 0,
    semanticRoundTrip:
      imported?.process !== null &&
      imported?.process !== undefined &&
      normalized(imported.process) === normalized(process),
    geometryPresent: (imported?.geometry.length ?? 0) >= process.lanes.length + process.stappen.length,
    metadataBacked: imported?.confidence.metadataBacked === true,
    manualStepGeometryRoundTrip:
      !firstStep ||
      (manualGeometry?.x === manualPlacement.x &&
        manualGeometry.y === manualPlacement.y &&
        manualGeometry.width === manualPlacement.width &&
        manualGeometry.height === manualPlacement.height),
    invalidManualGeometryFallsBack:
      !firstStep ||
      (fallbackImport?.ok === true &&
        fallbackGeometry !== undefined &&
        Number.isFinite(fallbackGeometry.x) &&
        Number.isFinite(fallbackGeometry.y) &&
        fallbackGeometry.width === 200 &&
        fallbackGeometry.height === 72),
    serverInchesConvertedToPx96:
      convertedInchStep?.x === 120 &&
      convertedInchStep.y === 192 &&
      convertedInchStep.width === 240 &&
      convertedInchStep.height === 72,
    nonStepGeometryIgnored:
      serverLayout !== undefined &&
      !Object.prototype.hasOwnProperty.call(serverLayout.nodes, 'lane:niet-overnemen'),
  }
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    messages: [
      ...exported.errors.map((error) => `${error.code}: ${error.message}`),
      ...manualExport.errors.map((error) => `${error.code}: ${error.message}`),
      ...fallbackExport.errors.map((error) => `${error.code}: ${error.message}`),
      ...(imported?.errors ?? []).map((error) => `${error.code}: ${error.message}`),
      ...(imported?.warnings ?? []).map((warning) => `${warning.code}: ${warning.message}`),
    ],
  }
}
