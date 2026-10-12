import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Db } from '../../../apps/api/src/db';
import { FeaturesService } from '../../../apps/api/src/features';
import { GitPlugin } from '../../../apps/api/src/git/git.plugin';
import { SecretVault } from '../../../apps/api/src/secrets';

async function main() {
const db = new Db();
try {
  const project = await db.one<{ id:string; owner_id:string; default_git_repository_id:string|null }>('SELECT id,owner_id,default_git_repository_id FROM ai_projects WHERE is_native=true LIMIT 1');
  assert.ok(project, 'Projeto nativo não encontrado.');
  const card = await db.one<{ id:string }>(`SELECT c.id FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id
    WHERE COALESCE(c.ai_project_id,b.ai_default_project_id)=$1 AND c.archived_at IS NULL AND l.archived_at IS NULL
    AND b.closed_at IS NULL AND c.kind IN ('normal','template') AND NOT EXISTS(SELECT 1 FROM vault_items v WHERE v.card_id=c.id)
    AND EXISTS(SELECT 1 FROM board_members bm WHERE bm.board_id=b.id AND bm.user_id=$2) LIMIT 1`, [project.id, project.owner_id]);
  assert.ok(card, 'Cartão do projeto não encontrado.');
  const git = new GitPlugin(db, new FeaturesService(db), new SecretVault());
  const history = await git.cardHistory(card.id, project.owner_id);
  assert.equal(history.default_repository_id, project.default_git_repository_id);
  assert.equal(history.repositories.length, 1);
  const repository = await git.repositoryHistory(card.id, project.owner_id, history.default_repository_id!);
  assert.equal(repository.branch, 'develop');
  assert.ok(repository.commits.length > 0);
  assert.equal(repository.commits[0].repository_id, history.default_repository_id);
  assert.ok(repository.commits[0].files.length > 0);
  const diff = await git.commitDiff(card.id, project.owner_id, history.default_repository_id!, repository.commits[0].sha);
  assert.equal(diff.branch, 'develop');
  assert.match(diff.patch, /diff --git/);
  console.log(`PASS: padrão do projeto, ${repository.commits.length} commits em develop e diff do commit ${diff.sha.slice(0,8)}.`);
} finally {
  await db.pool.end();
}
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
