import { createHash } from "node:crypto";
import { Controller, Get, Inject, NotFoundException, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { PluginRegistry } from "../execution/registries";
import { Db } from "../db";

type Listing = {
  listing_payload: Record<string, unknown>;
  grant_state: string;
  grant_payload: Record<string, unknown>;
};

type SealFile = { data: Buffer; sha256: string; expected_sha256: string; file_name: string; mime_type: string };

export function publicAccreditationProjection(listing: Record<string, unknown>, grantState: string, today = new Date().toISOString().slice(0, 10), grant: Record<string, unknown> = {}) {
  let status = "valid";
  if (grantState === "suspended") status = "suspended";
  else if (grantState === "cancelled") status = "cancelled";
  else if (String(listing.valid_from) > today) status = "not_yet_valid";
  else if (String(listing.valid_until) <= today || grantState === "expired") status = "expired";
  else if (grantState !== "active") status = "inactive";
  return {
    verification_code: listing.verification_code,
    provider_name: listing.provider_name,
    course_name: listing.course_name,
    modality: listing.modality,
    description: listing.description,
    valid_from: listing.valid_from,
    valid_until: listing.valid_until,
    status,
    seal_downloads: status === "valid" && typeof grant.seal_asset_record_id === "string" ? {
      print: `/public/safdoulas/accreditations/${listing.verification_code}/seal/print`,
      digital: `/public/safdoulas/accreditations/${listing.verification_code}/seal/digital`,
    } : null,
  };
}

@Controller("public/safdoulas/accreditations")
export class SafdoulasPublicAccreditationController {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(PluginRegistry) private readonly plugins: PluginRegistry,
  ) {}

  @Get(":code")
  async verify(@Param("code") code: string, @Res({ passthrough: true }) response: Response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (!this.plugins.isEnabled("safdoulas-accreditation") || !/^[A-Z0-9-]{12,64}$/.test(code)) throw new NotFoundException();
    const row = await this.db.one<Listing>(
      `SELECT listing.payload AS listing_payload, grant_record.state AS grant_state, grant_record.payload AS grant_payload
       FROM extension_records AS listing
       JOIN extension_records AS grant_record
         ON grant_record.id=(listing.payload->>'grant_record_id')::uuid
       WHERE listing.plugin_id='safdoulas-accreditation'
         AND listing.kind='public_accreditation_listing'
         AND listing.state='published'
         AND listing.payload->>'verification_code'=$1
         AND grant_record.plugin_id='safdoulas-accreditation'
         AND grant_record.kind='accreditation_grant'`,
      [code],
    );
    if (!row) throw new NotFoundException();
    return publicAccreditationProjection(row.listing_payload, row.grant_state, undefined, row.grant_payload);
  }

  @Get(":code/seal/:format")
  async seal(@Param("code") code: string, @Param("format") format: string, @Res() response: Response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (!this.plugins.isEnabled("safdoulas-accreditation") || !/^[A-Z0-9-]{12,64}$/.test(code) || !["print", "digital"].includes(format)) throw new NotFoundException();
    const file = await this.db.one<SealFile>(
      `SELECT stored.data,stored.sha256,seal_file->>'checksum_sha256' AS expected_sha256,
        document_version.payload->>'file_name' AS file_name,document_version.payload->>'mime_type' AS mime_type
       FROM extension_records AS listing
       JOIN extension_records AS grant_record ON grant_record.id=(listing.payload->>'grant_record_id')::uuid
       JOIN extension_record_versions AS grant_version ON grant_version.record_id=grant_record.id AND grant_version.revision=(listing.payload->>'grant_revision')::integer
       JOIN extension_records AS asset ON asset.id=(grant_version.payload->>'seal_asset_record_id')::uuid
       JOIN extension_record_versions AS asset_version ON asset_version.record_id=asset.id AND asset_version.revision=(grant_version.payload->>'seal_asset_revision')::integer
       CROSS JOIN LATERAL jsonb_array_elements(asset_version.payload->'files') AS seal_file
       JOIN extension_records AS document ON document.id=(seal_file->>'document_record_id')::uuid
       JOIN extension_record_versions AS document_version ON document_version.record_id=document.id AND document_version.revision=(seal_file->>'document_revision')::integer
       JOIN extension_files AS stored ON stored.record_id=document.id AND stored.revision=(document_version.payload->>'file_revision')::integer
       WHERE listing.plugin_id='safdoulas-accreditation' AND listing.kind='public_accreditation_listing' AND listing.state='published'
         AND listing.payload->>'verification_code'=$1 AND grant_record.plugin_id='safdoulas-accreditation'
         AND grant_record.kind='accreditation_grant' AND grant_record.state='active'
         AND (listing.payload->>'valid_from')::date<=CURRENT_DATE AND (listing.payload->>'valid_until')::date>=CURRENT_DATE
         AND asset.plugin_id='safdoulas-accreditation' AND asset.kind='seal_asset' AND asset.state IN ('active','retired')
         AND document.plugin_id='documents' AND document.kind='document' AND document.state='published'
         AND document_version.payload->>'variant'='original' AND seal_file->>'format'=$2
       LIMIT 1`,
      [code, format],
    );
    if (!file || file.sha256 !== file.expected_sha256 || createHash("sha256").update(file.data).digest("hex") !== file.sha256) throw new NotFoundException();
    response.setHeader("Content-Type", file.mime_type);
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
    response.send(file.data);
  }
}
