"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, User } from "@/lib/api";
import { AccessShell, accessPanel as panel } from "@/components/access-shell";

type Extension = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
};
export default function ExtensionsPage() {
  const [user, setUser] = useState<User | null>(null),
    [extensions, setExtensions] = useState<Extension[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<User>("/auth/me")
      .then((user) => {
        if (active) setUser(user);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    const refresh = () =>
      void api<Extension[]>("/extensions")
        .then((rows) => {
          if (active) setExtensions(rows);
        })
        .catch((error) => {
          if (active) setError(error.message);
        });
    refresh();
    window.addEventListener("plugins:changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("plugins:changed", refresh);
    };
  }, []);
  return (
    <AccessShell user={user} title="Extensões">
      <p>
        Recursos independentes para organizar informações, documentos e
        processos nos seus workspaces.
      </p>
      {error && (
        <p role="alert" className={panel}>
          {error}
        </p>
      )}
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {extensions.map((extension) => (
          <article
            key={extension.id}
            className={`${panel} flex min-w-0 flex-col gap-3`}
          >
            <h2 className="text-lg font-semibold">{extension.name}</h2>
            <p className="flex-1 break-words text-sm">
              {extension.description}
            </p>
            {extension.enabled ? (
              <Link
                href={`/extensions/${extension.id}`}
                className="inline-flex min-h-11 items-center font-semibold text-[#8fbcff]"
              >
                Abrir →
              </Link>
            ) : (
              <p role="status" className="text-sm">
                Suspensa pela configuração do plugin ou de uma dependência.
              </p>
            )}
          </article>
        ))}
      </div>
      {!extensions.length && !error && (
        <p>Nenhuma extensão disponível para seu perfil.</p>
      )}
    </AccessShell>
  );
}
