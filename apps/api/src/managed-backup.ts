import { BackupDestinationRegistry } from './backup-destinations';
import { BackupService } from './backup-service';
import { Db } from './db';
import type { BackupManifest } from './database-backup';
import { GoogleCredentials } from './google/credentials';
import { GoogleDriveBackupPlugin } from './google/drive-backup.plugin';
import { SecretVault } from './secrets';

export async function processGeneratedBackup(manifest: BackupManifest) {
  const db = new Db();
  try {
    const google = new GoogleCredentials(db, new SecretVault());
    const destinations = new BackupDestinationRegistry();
    destinations.register(new GoogleDriveBackupPlugin(google));
    return await new BackupService(db, destinations, google).processGenerated(manifest);
  } finally {
    await db.pool.end();
  }
}
