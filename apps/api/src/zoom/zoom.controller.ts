import { Controller, Delete, Get, HttpException, Inject, Param, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { FeaturesService } from "../features";
import { activeProductProfile, productWebOrigin } from "../product-profile";
import { ZoomMeetings } from "./zoom-meetings";

@Controller("zoom")
export class ZoomMeetingsController {
  constructor(
    @Inject(ZoomMeetings) private readonly zoom: ZoomMeetings,
    @Inject(FeaturesService) private readonly features: FeaturesService,
  ) {}

  @Get("status") async status(@Req() req: Request) {
    const owner = this.features.user(req);
    return { configured: this.zoom.configured(), connections: await this.zoom.connections(owner) };
  }

  @Get("oauth/start") start(@Req() req: Request) {
    return this.zoom.oauthUrl(this.features.user(req));
  }

  @Get("oauth/callback") async callback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Query("error") providerError: string | undefined,
    @Res() response: Response,
  ) {
    const base = productWebOrigin();
    const returnPath = activeProductProfile() === "suinda" ? "/suinda" : "/calendar";
    try {
      if (providerError) throw new HttpException("A autorização Zoom foi cancelada ou recusada.", 400);
      await this.zoom.oauthCallback(code, state);
      response.redirect(`${base}${returnPath}?connected=zoom`);
    } catch (error) {
      const message = error instanceof HttpException
        ? String((error.getResponse() as { message?: string }).message || error.message)
        : "Falha na conexão Zoom.";
      response.redirect(`${base}${returnPath}?error=${encodeURIComponent(message)}`);
    }
  }

  @Delete("connections/:id") disconnect(@Req() req: Request, @Param("id") id: string) {
    return this.zoom.disconnect(this.features.user(req), id);
  }
}
