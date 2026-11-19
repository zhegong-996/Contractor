// Identifiers already persisted in ledgers, Git history and installed runners.
const formerNamespace = 'suitme';

export function formerName(current: string) {
  return current.replace(/contractor/gi, match => match === 'CONTRACTOR' ? formerNamespace.toUpperCase()
    : match === 'Contractor' ? 'SuitMe' : formerNamespace);
}

export function protocolMatches(value: string | undefined, current: string) {
  return value === current || value === formerName(current);
}

export function configuredEnv(name: string, env: NodeJS.ProcessEnv = process.env) {
  const current = name.replace(new RegExp('^' + formerNamespace.toUpperCase() + '_'), 'CONTRACTOR_');
  return env[current] ?? env[formerName(current)];
}

export const isConfigSecretName = (name: string) => /^CONTRACTOR_[A-Z0-9_]{1,72}$/.test(name)
  || new RegExp('^' + formerNamespace.toUpperCase() + '_[A-Z0-9_]{1,72}$').test(name);
