# Database backups and recovery

Orbit keeps board backgrounds, attachments, comment files, cards and application data in PostgreSQL. The encrypted archive therefore captures a consistent database snapshot, including the binary files; there is no second image directory that can drift out of sync.

## What the current backup protects

- `pg_dump` creates a PostgreSQL custom-format archive from one consistent snapshot.
- Orbit encrypts the archive with AES-256-GCM before publishing it to the backup directory.
- Orbit writes a manifest with the database name, timestamp, source revision, archive size and SHA-256 checksum, then uploads both encrypted archive and manifest to Google Drive using the connected Google account. It also creates separate encrypted vault, configuration, and per-attachment archives with manifests.
- A backup is considered complete only after Orbit decrypts it and `pg_restore --list` can read the archive.
- After a new archive is verified, Orbit keeps the newest 30 complete local archives by default. Change `ORBIT_BACKUP_KEEP` to retain more; set it to at least 2.
- On an initialized Orbit database, `npm run db:migrate` creates and verifies a `before-db-migrate` backup. Once the cloud backup tables exist, it uploads the database and vault packages before changing the schema. During the first migration that creates those tables, it uploads after applying the schema. A brand new empty database can be initialized without a backup.
- Restore requires a separate, empty database. Orbit refuses to overwrite the source database or a target that already contains tables.

The backup key is independent of the database and the provider-secret encryption key. Generate one once and store it in a password manager or another recovery vault that is available if this server is lost:

```bash
openssl rand -hex 32
```

Set the result as `ORBIT_BACKUP_KEY` in `apps/api/.env`. Do not commit the value. If the key is lost, the encrypted archives cannot be decrypted.

## Configure Google Drive

Create a Google OAuth web client, enable the Google Drive API, configure the shared `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and connect the Drive account in Orbit. The plugin requests the `https://www.googleapis.com/auth/drive.file` scope and creates separate **Orbit Backups**, **Orbit Vault Backups**, **Orbit Config Backups**, and **Orbit Card Attachments** folders. Choose the automatic account in the Backups page; if exactly one Drive account is connected, it is selected automatically. Keep `ORBIT_BACKUP_KEY` private and separate from the OAuth credentials.

Every backup uploads the encrypted database, vault, and configuration archives plus their JSON manifests using resumable transfers. Changes to local `.env` files also trigger a new configuration archive. Card and comment files are stored in PostgreSQL and receive separate encrypted copies in Drive when automatic upload is enabled. A partial upload is recorded as a failure. Keep a separate copy of `ORBIT_BACKUP_KEY` in a recovery vault; a Drive account alone cannot decrypt the data. Confirm access to all backup folders after the first scheduled run.

By default, archives go to `backups/` at the repository root. Set `ORBIT_BACKUP_DIR` to a directory on a separate mounted disk if available. Files are created with owner-only permissions. A directory on the same server protects against a failed migration, but it does not protect against loss of that server or its disk.

Keep `ORBIT_BACKUP_KEY` stable while archives depend on it. The manifest records a short fingerprint so a wrong key is reported clearly. Before rotating the key, restore or re-encrypt the retained archives with the new key; backups encrypted under a removed key cannot be recovered.

## Create and inspect backups

```bash
npm run db:backup -- create
npm run db:backup -- list
npm run db:backup -- verify /path/to/orbit-2026-09-29T02-00-00-000Z-ab12cd34.backup.enc
```

Schedule a daily backup after `ORBIT_BACKUP_KEY` and `ORBIT_BACKUP_DIR` are configured. Create the backup directory before adding the cron job so shell log redirection has a destination. For example, add this to the service account's crontab, replacing the project path with the installation path:

```cron
0 2 * * * cd /home/meada/projetos/orbit && npm run db:backup -- create scheduled-daily >> /home/meada/projetos/orbit/backups/backup.log 2>&1
```

The local copy is retained for operational convenience; Google Drive holds the offsite copy. The local retention setting does not delete Drive objects. Retain Drive history according to your recovery needs, and periodically confirm that older restore points remain available.

## Restore without overwriting the live database

Create a new, empty database first. Set `ORBIT_RESTORE_DATABASE_URL` to its connection string in `apps/api/.env`, then run:

```bash
npm run db:backup -- restore /path/to/orbit-backup.backup.enc
```

The command checks the encrypted file and manifest, rejects the source database as a target, confirms that the target is empty, restores transactionally, and checks that the critical Orbit tables exist. It prints counts for users, boards, cards and attachments. Start a separate Orbit instance against this restored database and inspect the application before changing the production connection string.

Keep the previous database and backups until the restored instance has been checked. A successful `pg_restore` proves the archive can be read; a restore rehearsal proves the application can use the recovered data. Rehearse recovery regularly and record how long it takes.

## Restore the vault independently

The separate vault archive is encrypted with a key derived from `ORBIT_BACKUP_KEY`. It contains the vault categories and text contents, and can be imported into an existing Orbit account without replacing cards or restoring PostgreSQL as a whole. Keep both the `.vault.enc` file and its `.manifest.json` file together.

```bash
npm run db:backup -- verify-vault /path/to/orbit-vault-....vault.enc
npm run db:backup -- restore-vault /path/to/orbit-vault-....vault.enc owner@example.com
```

The import preserves existing vault items, re-encrypts imported items with the destination's vault key, and rejects a second import of the same encrypted archive into the same account. The Backups page also offers download and import actions for vault archives stored in Drive.

## Recovery coverage

| Failure | Protection |
| --- | --- |
| Migration corrupts schema or data | Automatically verified backup immediately before `db:migrate` |
| Backup file is truncated or modified | SHA-256 manifest check and authenticated encryption |
| Server or disk is lost | Download the encrypted archive and manifest from Google Drive; restore still requires the separate encryption key |
| Corruption is discovered after several days | Requires retained scheduled archives in Drive; a same-host directory is insufficient |
| Need to recover to an exact time between snapshots | Requires PostgreSQL WAL archiving and point-in-time recovery, which still needs server-level configuration |

The remote destination, retention schedule and WAL/PITR setup are environment choices. Do not store the encryption key beside the only copy of the archives.
