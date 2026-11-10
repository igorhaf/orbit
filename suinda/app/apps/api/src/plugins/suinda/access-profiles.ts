import { BadRequestException, Body, Controller, Delete, Get, Inject, Injectable, NotFoundException, Param, Post, Put, Req } from "@nestjs/common";
import type { AccessRequest } from "../../access/access";
import { AccessService, id, text } from "../../access/access";
import { Db } from "../../db";

const PREFIX = "plugin.suinda-learning.";
type Profile = { id: string; workspace_id: string; name: string; permissions: string[]; created_at: string; updated_at: string };

@Injectable()
export class SuindaAccessProfilesService {
  constructor(@Inject(Db) private readonly db: Db, @Inject(AccessService) private readonly access: AccessService) {}

  onModuleInit() {
    this.access.registerScopedPermissionProvider(async (user, type, workspace) => {
      if (type !== "workspace") return [];
      const rows = await this.db.query<{ permission: string }>(
        `SELECT DISTINCT unnest(p.permissions) AS permission
         FROM suinda_workspace_access_profile_members m
         JOIN suinda_workspace_access_profiles p ON p.id=m.profile_id AND p.workspace_id=m.workspace_id
         JOIN workspace_members wm ON wm.workspace_id=m.workspace_id AND wm.user_id=m.user_id
         WHERE m.workspace_id=$1 AND m.user_id=$2`, [workspace, user]);
      return rows.map((row) => row.permission);
    });
  }

  private async manage(actor: string, workspace: string) {
    id(workspace);
    await this.access.requireScoped(actor, `${PREFIX}manage`, "workspace", workspace);
  }

  async manageableWorkspaces(actor: string) {
    const candidates = await this.db.query<{ id: string; name: string }>(`SELECT w.id,w.name FROM workspaces w
      JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=$1 WHERE w.archived_at IS NULL ORDER BY lower(w.name)`, [actor]);
    const allowed = await Promise.all(candidates.map((workspace) => this.access.hasScoped(actor, `${PREFIX}manage`, "workspace", workspace.id)));
    return candidates.filter((_workspace, index) => allowed[index]);
  }

  private async validatePermissions(actor: string, workspace: string, raw: unknown) {
    if (!Array.isArray(raw) || raw.length > 100 || raw.some((permission) => typeof permission !== "string"))
      throw new BadRequestException("Permissões inválidas.");
    const permissions = [...new Set(raw as string[])];
    const catalog = new Set(this.access.catalog().filter((permission) => permission.startsWith(PREFIX)));
    if (permissions.some((permission) => !catalog.has(permission))) throw new BadRequestException("Selecione somente permissões registradas do Suindá.");
    for (const permission of permissions) await this.access.requireScoped(actor, permission, "workspace", workspace);
    return permissions;
  }

  async list(actor: string, workspace: string) {
    await this.manage(actor, workspace);
    const profiles = await this.db.query<Profile>("SELECT * FROM suinda_workspace_access_profiles WHERE workspace_id=$1 ORDER BY lower(name)", [workspace]);
    const members = await this.db.query(`SELECT wm.user_id,u.name,u.email,u.is_root,
      COALESCE(array_agg(json_build_object('id',p.id,'name',p.name)) FILTER (WHERE p.id IS NOT NULL),'{}') AS profiles
      FROM workspace_members wm JOIN users u ON u.id=wm.user_id
      LEFT JOIN suinda_workspace_access_profile_members pm ON pm.workspace_id=wm.workspace_id AND pm.user_id=wm.user_id
      LEFT JOIN suinda_workspace_access_profiles p ON p.id=pm.profile_id AND p.workspace_id=pm.workspace_id
      WHERE wm.workspace_id=$1 GROUP BY wm.user_id,u.name,u.email,u.is_root ORDER BY u.name`, [workspace]);
    return { profiles, members, permissions: this.access.catalog().filter((permission) => permission.startsWith(PREFIX)) };
  }

  async save(actor: string, workspace: string, profileId: string | undefined, body: Record<string, unknown>) {
    await this.manage(actor, workspace);
    if (Object.keys(body).some((key) => !["name", "permissions"].includes(key))) throw new BadRequestException("Campo de perfil inválido.");
    const name = text(body.name, 100);
    const permissions = await this.validatePermissions(actor, workspace, body.permissions);
    if (profileId) {
      id(profileId);
      const changed = await this.db.query<{ user_id: string }>(`UPDATE suinda_workspace_access_profiles SET name=$3,permissions=$4,updated_at=now()
        WHERE workspace_id=$1 AND id=$2 RETURNING id`, [workspace, profileId, name, permissions]);
      if (!changed.length) throw new NotFoundException("Perfil não encontrado neste workspace.");
      const members = await this.db.query<{ user_id: string }>("SELECT user_id FROM suinda_workspace_access_profile_members WHERE workspace_id=$1 AND profile_id=$2", [workspace, profileId]);
      await this.revoke(members.map(({ user_id }) => user_id));
      await this.access.audit(actor, "suinda.access_profile.updated", profileId, { type: "workspace", id: workspace });
      return { ok: true, id: profileId };
    }
    const row = await this.db.one<{ id: string }>(`INSERT INTO suinda_workspace_access_profiles(workspace_id,name,permissions,created_by)
      VALUES($1,$2,$3,$4) RETURNING id`, [workspace, name, permissions, actor]);
    await this.access.audit(actor, "suinda.access_profile.created", row!.id, { type: "workspace", id: workspace });
    return { ok: true, id: row!.id };
  }

  async remove(actor: string, workspace: string, rawProfile: string) {
    await this.manage(actor, workspace); const profile = id(rawProfile);
    const assigned = await this.db.one("SELECT 1 FROM suinda_workspace_access_profile_members WHERE workspace_id=$1 AND profile_id=$2 LIMIT 1", [workspace, profile]);
    if (assigned) throw new BadRequestException("Revogue as atribuições antes de remover este perfil.");
    const result = await this.db.query("DELETE FROM suinda_workspace_access_profiles WHERE workspace_id=$1 AND id=$2 RETURNING id", [workspace, profile]);
    if (!result.length) throw new NotFoundException("Perfil não encontrado neste workspace.");
    await this.access.audit(actor, "suinda.access_profile.deleted", profile, { type: "workspace", id: workspace }); return { ok: true };
  }

  async assign(actor: string, workspace: string, rawUser: string, rawProfile: string | null) {
    await this.manage(actor, workspace); const user = id(rawUser);
    const target = await this.db.one<{ is_root: boolean }>("SELECT u.is_root FROM users u JOIN workspace_members m ON m.user_id=u.id WHERE u.id=$1 AND m.workspace_id=$2", [user, workspace]);
    if (!target) throw new NotFoundException("A pessoa não é membro deste workspace.");
    if (target.is_root) throw new BadRequestException("A conta ROOT é protegida.");
    const profile = id(rawProfile);
    const exists = await this.db.one("SELECT id FROM suinda_workspace_access_profiles WHERE id=$1 AND workspace_id=$2", [profile, workspace]);
    if (!exists) throw new NotFoundException("Perfil não encontrado neste workspace.");
    const result = await this.db.query(`INSERT INTO suinda_workspace_access_profile_members(workspace_id,profile_id,user_id,assigned_by)
      VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING user_id`, [workspace, profile, user, actor]);
    if (!result.length) return { ok: true, changed: false };
    await this.db.query("UPDATE users SET session_version=session_version+1 WHERE id=$1 AND NOT is_root", [user]);
    this.access.revoke(user);
    await this.access.audit(actor, "suinda.access_profile.assigned", `${profile}:${user}`, { type: "workspace", id: workspace });
    return { ok: true, changed: true };
  }

  async revokeAssignment(actor: string, workspace: string, rawUser: string, rawProfile: string) {
    await this.manage(actor, workspace); const user = id(rawUser), profile = id(rawProfile);
    const target = await this.db.one<{ is_root: boolean }>("SELECT u.is_root FROM users u JOIN workspace_members m ON m.user_id=u.id WHERE u.id=$1 AND m.workspace_id=$2", [user, workspace]);
    if (!target) throw new NotFoundException("A pessoa não é membro deste workspace.");
    if (target.is_root) throw new BadRequestException("A conta ROOT é protegida.");
    const removed = await this.db.query("DELETE FROM suinda_workspace_access_profile_members WHERE workspace_id=$1 AND profile_id=$2 AND user_id=$3 RETURNING user_id", [workspace, profile, user]);
    if (!removed.length) return { ok: true, changed: false };
    await this.db.query("UPDATE users SET session_version=session_version+1 WHERE id=$1 AND NOT is_root", [user]); this.access.revoke(user);
    await this.access.audit(actor, "suinda.access_profile.revoked", `${profile}:${user}`, { type: "workspace", id: workspace });
    return { ok: true, changed: true };
  }

  private async revoke(users: string[]) { for (const user of [...new Set(users)]) { await this.db.query("UPDATE users SET session_version=session_version+1 WHERE id=$1 AND NOT is_root", [user]); this.access.revoke(user); } }
}

@Controller("extensions/suinda-learning/workspaces/:workspaceId/access-profiles")
export class SuindaAccessProfilesController {
  constructor(@Inject(SuindaAccessProfilesService) private readonly service: SuindaAccessProfilesService) {}
  @Get() list(@Req() req: AccessRequest, @Param("workspaceId") workspace: string) { return this.service.list(String(req.orbitActor), workspace); }
  @Post() create(@Req() req: AccessRequest, @Param("workspaceId") workspace: string, @Body() body: Record<string, unknown>) { return this.service.save(String(req.orbitActor), workspace, undefined, body); }
  @Put(":profileId") update(@Req() req: AccessRequest, @Param("workspaceId") workspace: string, @Param("profileId") profile: string, @Body() body: Record<string, unknown>) { return this.service.save(String(req.orbitActor), workspace, profile, body); }
  @Delete(":profileId") remove(@Req() req: AccessRequest, @Param("workspaceId") workspace: string, @Param("profileId") profile: string) { return this.service.remove(String(req.orbitActor), workspace, profile); }
  @Post("members/:userId/assignments/:profileId") assign(@Req() req: AccessRequest, @Param("workspaceId") workspace: string, @Param("userId") user: string, @Param("profileId") profile: string) { return this.service.assign(String(req.orbitActor), workspace, user, profile); }
  @Delete("members/:userId/assignments/:profileId") revoke(@Req() req: AccessRequest, @Param("workspaceId") workspace: string, @Param("userId") user: string, @Param("profileId") profile: string) { return this.service.revokeAssignment(String(req.orbitActor), workspace, user, profile); }
}

@Controller("extensions/suinda-learning/access-profiles")
export class SuindaAccessProfileWorkspaceController {
  constructor(@Inject(SuindaAccessProfilesService) private readonly service: SuindaAccessProfilesService) {}
  @Get("workspaces") workspaces(@Req() req: AccessRequest) { return this.service.manageableWorkspaces(String(req.orbitActor)); }
}
