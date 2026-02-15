/**
 * ProvisioningStatusCard Component
 * Shows provisioning status after stack save (PROMPT #61 - UI Integration)
 */

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui';

interface ProvisioningStatus {
  attempted: boolean;
  success: boolean;
  project_path?: string;
  project_name?: string;
  credentials?: {
    database: string;
    username: string;
    password: string;
    application_port: string;
    database_port: string;
    adminer_port: string;
  };
  next_steps?: string[];
  script_used?: string;
  error?: string;
}

interface Props {
  provisioning: ProvisioningStatus;
  projectName: string;
  onClose?: () => void;
}

export function ProvisioningStatusCard({ provisioning, projectName, onClose }: Props) {
  const [showCredentials, setShowCredentials] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!provisioning.attempted) return null;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyAllCredentials = () => {
    if (!provisioning.credentials) return;

    const text = `
Credenciais do Banco de Dados para ${projectName}:
================================
Banco de Dados: ${provisioning.credentials.database}
Usuario: ${provisioning.credentials.username}
Senha: ${provisioning.credentials.password}
Porta da Aplicacao: ${provisioning.credentials.application_port}
Porta do Banco: ${provisioning.credentials.database_port}
Porta do Adminer: ${provisioning.credentials.adminer_port}

Proximos Passos:
${provisioning.next_steps?.join('\n')}
`.trim();

    copyToClipboard(text);
  };

  if (!provisioning.success) {
    return (
      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-md my-4">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3 flex-1">
            <h3 className="text-sm font-medium text-yellow-800">
              Provisionamento Nao Disponivel
            </h3>
            <div className="mt-2 text-sm text-yellow-700">
              <p>{provisioning.error || 'O provisionamento do projeto nao esta disponivel para esta combinacao de stack.'}</p>
              <p className="mt-2">
                Stack salvo com sucesso, mas o provisionamento automatico nao pode ser concluido.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-green-50 border-l-4 border-green-400 p-4 rounded-md my-4 relative">
      {/* Close Button */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-2 right-2 text-green-600 hover:text-green-800 transition-colors"
          aria-label="Fechar status de provisionamento"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      <div className="flex items-start">
        <div className="flex-shrink-0">
          <svg className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="ml-3 flex-1 pr-6">
          <h3 className="text-sm font-medium text-green-800">
            Projeto Provisionado com Sucesso!
          </h3>
          <div className="mt-2 text-sm text-green-700">
            <p>Seu projeto <strong>{provisioning.project_name}</strong> foi provisionado automaticamente.</p>
            {provisioning.script_used && (
              <p className="mt-1 text-xs text-green-600">
                Usado: {provisioning.script_used}
              </p>
            )}
          </div>

          {/* Credentials Section */}
          {provisioning.credentials && (
            <div className="mt-4">
              <button
                onClick={() => setShowCredentials(!showCredentials)}
                className="text-sm font-medium text-green-800 hover:text-green-900 flex items-center"
              >
                {showCredentials ? (
                  <>
                    <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    Ocultar Credenciais
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    Mostrar Credenciais do Banco
                  </>
                )}
              </button>

              {showCredentials && (
                <div className="mt-3 bg-white border border-green-200 rounded-md p-3">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
                      Credenciais do Banco de Dados
                    </h4>
                    <button
                      onClick={copyAllCredentials}
                      className="text-xs text-green-600 hover:text-green-700 flex items-center"
                    >
                      {copied ? (
                        <>
                          <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Copiado!
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          Copiar Tudo
                        </>
                      )}
                    </button>
                  </div>

                  <div className="space-y-2 text-xs font-mono">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Banco de Dados:</span>
                      <span className="text-gray-900 font-semibold">{provisioning.credentials.database}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Usuario:</span>
                      <span className="text-gray-900 font-semibold">{provisioning.credentials.username}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Senha:</span>
                      <span className="text-gray-900 font-semibold">{provisioning.credentials.password}</span>
                    </div>
                    <div className="border-t border-gray-200 my-2"></div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Porta da Aplicacao:</span>
                      <span className="text-gray-900">{provisioning.credentials.application_port}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Porta do Banco:</span>
                      <span className="text-gray-900">{provisioning.credentials.database_port}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Porta do Adminer:</span>
                      <span className="text-gray-900">{provisioning.credentials.adminer_port}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Next Steps */}
          {provisioning.next_steps && provisioning.next_steps.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-medium text-green-800 mb-2">Proximos Passos:</h4>
              <div className="bg-white border border-green-200 rounded-md p-3">
                <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700 font-mono">
                  {provisioning.next_steps.map((step, index) => (
                    <li key={index} className="text-xs">{step}</li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {/* Location */}
          {provisioning.project_path && (
            <div className="mt-3 text-xs text-green-600">
              <strong>Localizacao:</strong> <code className="bg-green-100 px-1 py-0.5 rounded">{provisioning.project_path}</code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
