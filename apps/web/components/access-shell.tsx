"use client";
import Link from 'next/link';
import type {ReactNode} from 'react';
import {AppHeader} from '@/components/ui';
import type {User} from '@/lib/api';
export const accessInput='min-h-11 w-full min-w-0 rounded-lg border border-[#8590a2] bg-white px-3 py-2';
export const accessButton='min-h-11 rounded-lg bg-[#0c66e4] px-4 py-2 font-semibold text-white disabled:opacity-50';
export const accessPanel='min-w-0 rounded-xl border border-[#dfe1e6] bg-white p-4 sm:p-6';
export function AccessShell({user,title,children}:{user:User|null;title:string;children:ReactNode}){return <div className="min-h-screen bg-[#f7f8fa] text-[#172b4d]">{(user?.is_root||user?.permissions?.includes('access.manage'))?<AppHeader user={user}/>:<header className="flex min-h-14 flex-wrap items-center gap-4 border-b bg-white px-4"><Link href="/boards">Orbit · Quadros</Link><Link href="/workspaces">Workspaces</Link><Link href="/profile">Perfil</Link></header>}<main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-7"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">{title}</h1>{user?.is_root&&<span className="rounded-full bg-[#e9f2ff] px-4 py-2 text-sm font-semibold text-[#0c66e4]">ROOT · acesso total</span>}</div>{children}</main></div>}
