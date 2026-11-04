export interface FormValues {
  first_name: string;
  last_name: string;
  personal_email: string;
  department: string;
  role: string;
  start_date: string;
}

export type FormErrors = Partial<Record<keyof FormValues, string>>;

export function validIsoDate(input: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return false;
  const [y, m, d] = input.split('-').map(Number);
  if (y < 1900 || y > 2200) return false;
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
}

export function validateEmployee(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  if (!values.first_name.trim()) errors.first_name = 'Bitte Vornamen eingeben.';
  if (!values.last_name.trim()) errors.last_name = 'Bitte Nachnamen eingeben.';
  const email = values.personal_email.trim();
  if (!email) errors.personal_email = 'Bitte persönliche E-Mail-Adresse eingeben.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.personal_email = 'Bitte gültige E-Mail-Adresse eingeben.';
  if (!values.department.trim()) errors.department = 'Bitte Abteilung auswählen.';
  if (!values.role.trim()) errors.role = 'Bitte Position eingeben.';
  if (!values.start_date) errors.start_date = 'Bitte Eintrittsdatum auswählen.';
  else if (!validIsoDate(values.start_date)) errors.start_date = 'Bitte ein gültiges Datum eingeben.';
  return errors;
}

export function validUsername(input: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,63}$/.test(input);
}

export function validateActivation(username: string, password: string, confirmation: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!validUsername(username)) errors.username = '3–64 Kleinbuchstaben, Zahlen, Punkt, _ oder -. Beginn mit Buchstabe oder Zahl.';
  if (password.length < 12 || password.length > 128) errors.password = '12 bis 128 Zeichen erforderlich.';
  if (!confirmation) errors.confirmation = 'Bitte Passwort bestätigen.';
  else if (password !== confirmation) errors.confirmation = 'Die Passwörter stimmen nicht überein.';
  return errors;
}
