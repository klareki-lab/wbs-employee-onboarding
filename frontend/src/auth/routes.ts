import type { UserRole } from '../api/types.ts';
export const roleHome = (role: UserRole): string => role === 'hr' ? '/hr' : '/dashboard';
export function loginDestination(role: UserRole, requested?: string): string {
  const base = roleHome(role);
  // Return paths never cross roles or accept protocol-relative/ambiguous prefix paths.
  return requested && (requested === base || requested.startsWith(base + '/')) && !/[\\?#%]/.test(requested) && !requested.split('/').includes('..')
    ? requested : base;
}
export const mayAccess = (actual: UserRole, required: UserRole): boolean => actual === required;
