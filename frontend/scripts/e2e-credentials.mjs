export function vereisE2eAdminWachtwoord() {
  const wachtwoord = process.env.SPG_E2E_ADMIN_PASSWORD?.trim()
  if (!wachtwoord) {
    throw new Error(
      'SPG_E2E_ADMIN_PASSWORD ontbreekt. Gebruik voor tests een tijdelijk, expliciet bootstrapwachtwoord.',
    )
  }

  return wachtwoord
}
