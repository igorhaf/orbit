import type {RawBodyRequest} from '@nestjs/common';
import {json,Request} from 'express';
/** Preserve exact signed bytes before Orbit's general JSON parser consumes the stream. */
export const alexaOrbitBodyParser=json({limit:'64kb',verify:(request,_response,body)=>{(request as RawBodyRequest<Request>).rawBody=Buffer.from(body)}});
