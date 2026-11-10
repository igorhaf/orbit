"use client";
import {createElement} from "react";
import {aiCardRenderers} from '../ai/card-renderers';
import {developmentCardRenderers} from '../software-development/card-renderers';
import type {CardSlotProps} from './contract';
// Application composition includes compiled plugin renderers, never remote executable code.
const renderers=new Map([...aiCardRenderers,...developmentCardRenderers].map(renderer=>[renderer.slot,renderer.component]));
export function CardPluginSlot({slot,slots,...props}:CardSlotProps&{slot:string;slots:string[]}){const Renderer=renderers.get(slot);return slots.includes(slot)&&Renderer?createElement(Renderer,props):null}
