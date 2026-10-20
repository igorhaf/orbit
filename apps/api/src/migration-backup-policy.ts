export function allowLocalOnlyMigrationBackup(argv: string[], env: NodeJS.ProcessEnv) {
  const requested = argv.includes('--allow-dev-local-only-backup');
  if (requested && env.ORBIT_ENV !== 'development') {
    throw new Error('--allow-dev-local-only-backup is restricted to ORBIT_ENV=development.');
  }
  return requested;
}
