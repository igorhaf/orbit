import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import type { AccessRequest } from "../../access/access";
import { ExtensionRecords } from "./records.service";
import type { Payload } from "./rules";

@Controller("extensions")
export class ExtensionRecordsController {
  constructor(
    @Inject(ExtensionRecords) private readonly records: ExtensionRecords,
  ) {}
  @Get() catalog(@Req() req: AccessRequest) {
    return this.records.catalog(String(req.orbitUser));
  }
  @Get(":plugin/workspaces/:workspace/access") permissions(
    @Req() req: AccessRequest,
    @Param("plugin") plugin: string,
    @Param("workspace") workspace: string,
  ) {
    return this.records.permissions(plugin, workspace, String(req.orbitUser));
  }
  @Get(":plugin/workspaces/:workspace/records") list(
    @Req() req: AccessRequest,
    @Param("plugin") plugin: string,
    @Param("workspace") workspace: string,
  ) {
    return this.records.list(plugin, workspace, String(req.orbitUser));
  }
  @Post(":plugin/workspaces/:workspace/records") create(
    @Req() req: AccessRequest,
    @Param("plugin") plugin: string,
    @Param("workspace") workspace: string,
    @Body() body: Payload,
  ) {
    return this.records.create(plugin, workspace, String(req.orbitUser), body);
  }
  @Get(":plugin/records/:id") detail(
    @Req() req: AccessRequest,
    @Param("plugin") plugin: string,
    @Param("id") id: string,
  ) {
    return this.records.detail(plugin, id, String(req.orbitUser));
  }
  @Post(":plugin/records/:id/versions") version(
    @Req() req: AccessRequest,
    @Param("plugin") plugin: string,
    @Param("id") id: string,
    @Body() body: Payload,
  ) {
    return this.records.version(plugin, id, String(req.orbitUser), body);
  }
  @Post(":plugin/records/:id/transitions") transition(
    @Req() req: AccessRequest,
    @Param("plugin") plugin: string,
    @Param("id") id: string,
    @Body() body: Payload,
  ) {
    return this.records.transition(plugin, id, String(req.orbitUser), body);
  }
  @Post(":plugin/records/:id/links") link(
    @Req() req: AccessRequest,
    @Param("plugin") plugin: string,
    @Param("id") id: string,
    @Body() body: Payload,
  ) {
    return this.records.link(plugin, id, String(req.orbitUser), body);
  }
  @Post("terms/records/:id/acceptances") accept(
    @Req() req: AccessRequest,
    @Param("id") id: string,
    @Body() body: Payload,
  ) {
    return this.records.accept(id, String(req.orbitUser), body);
  }
  @Post("documents/workspaces/:workspace/files") upload(
    @Req() req: AccessRequest,
    @Param("workspace") workspace: string,
    @Body() body: Payload,
  ) {
    return this.records.upload(workspace, String(req.orbitUser), body);
  }
  @Get("documents/records/:id/files/:revision") async download(
    @Req() req: AccessRequest,
    @Res() res: Response,
    @Param("id") id: string,
    @Param("revision") revision: string,
  ) {
    const file = await this.records.download(
      id,
      Number(revision),
      String(req.orbitUser),
    );
    res.setHeader("Content-Type", file.mime_type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
    );
    res.send(file.data);
  }
}
