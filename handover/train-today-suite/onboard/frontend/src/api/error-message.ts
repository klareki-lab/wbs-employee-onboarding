export function fallbackApiMessage(status: number, code?: string): string {
  if (code === 'INVALID_CREDENTIALS') return 'Benutzername oder Passwort ist falsch.';
  if (status === 401) return 'Anmeldung erforderlich oder Sitzung abgelaufen.';
  if (status === 403) return 'Keine Berechtigung für diesen Vorgang.';
  if (status === 410) return 'Einladung ungültig oder nicht mehr nutzbar.';
  if (status === 409) return 'Dieser Vorgang steht im Konflikt mit vorhandenen Daten.';
  if (status === 429) return 'Zu viele Anfragen. Bitte später erneut versuchen.';
  return 'Der Server konnte die Anfrage nicht verarbeiten.';
}
