"use client";
import type {ReactNode} from 'react';
import {AppHeader} from '@/components/ui';
import type {User} from '@/lib/api';
export const accessInput='min-h-11 w-full min-w-0 rounded-lg border border-[#8590a2] bg-white px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0c66e4]';
export const accessButton='min-h-11 rounded-lg bg-[#0c66e4] px-4 py-2 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0c66e4] disabled:opacity-50';
export const accessPanel='min-w-0 rounded-xl border border-[#dfe1e6] bg-white p-4 sm:p-6';
export function AccessShell({user,title,children,embedded=false}:{user:User|null;title:string;children:ReactNode;embedded?:boolean}){if(embedded)return <section className="min-w-0 space-y-4"><h2 className="text-lg font-bold">{title}</h2>{children}</section>;return <div className="min-h-screen bg-[#f7f8fa] text-[#172b4d]"><AppHeader user={user}/><main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-7"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">{title}</h1>{user?.is_root&&<span className="rounded-full bg-[#e9f2ff] px-4 py-2 text-sm font-semibold text-[#0c66e4]">ROOT · acesso total</span>}</div>{children}</main></div>}
