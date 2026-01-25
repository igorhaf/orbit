/**
 * Contracts Page
 * Lists all YAML prompt templates from the system
 *
 * PROMPT #104 - Contracts Area
 */

'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Card, CardHeader, CardTitle, CardContent, Button } from '@/components/ui';
import { FileCode, X } from 'lucide-react';

// Dynamic import to avoid SSR issues
const SyntaxHighlighter = dynamic(
  () => import('react-syntax-highlighter').then((mod) => mod.Prism),
  { ssr: false }
);

import { vscDarkPlus } from 'react-syntax-highlighter/dist/cjs/styles/prism';

interface Contract {
  name: string;
  path: string;
  category: string;
  description: string;
}

interface ContractDetail extends Contract {
  content: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  backlog: 'bg-blue-100 text-blue-800',
  commits: 'bg-green-100 text-green-800',
  components: 'bg-purple-100 text-purple-800',
  context: 'bg-orange-100 text-orange-800',
  discovery: 'bg-pink-100 text-pink-800',
  interviews: 'bg-cyan-100 text-cyan-800',
};

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedContract, setSelectedContract] = useState<ContractDetail | null>(null);
  const [loadingYaml, setLoadingYaml] = useState(false);

  useEffect(() => {
    loadContracts();
  }, []);

  const loadContracts = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8000/api/v1/contracts/');
      const data = await response.json();
      setContracts(data);
    } catch (error) {
      console.error('Failed to load contracts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRowClick = async (contract: Contract) => {
    setLoadingYaml(true);
    setShowModal(true);

    try {
      const response = await fetch(`http://localhost:8000/api/v1/contracts/${contract.path}`);
      const data = await response.json();
      setSelectedContract(data);
    } catch (error) {
      console.error('Failed to load contract content:', error);
      setSelectedContract({
        ...contract,
        content: '# Error loading YAML content'
      });
    } finally {
      setLoadingYaml(false);
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setSelectedContract(null);
  };

  const getCategoryColor = (category: string) => {
    // Handle nested categories like "interviews/card_focused"
    const baseCategory = category.split('/')[0];
    return CATEGORY_COLORS[baseCategory] || 'bg-gray-100 text-gray-800';
  };

  return (
    <Layout>
      <Breadcrumbs />

      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Contracts</h1>
          <p className="mt-2 text-gray-600">
            YAML prompt templates that define AI behavior contracts for the system
          </p>
        </div>

        {/* Contracts Table */}
        <Card>
          <CardHeader>
            <CardTitle>
              Prompt Contracts ({contracts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
              </div>
            ) : contracts.length === 0 ? (
              <div className="text-center py-12">
                <FileCode className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">No contracts found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Category
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Description
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {contracts.map((contract) => (
                      <tr
                        key={contract.path}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => handleRowClick(contract)}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getCategoryColor(contract.category)}`}>
                            {contract.category}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm font-medium text-gray-900">
                            {contract.name}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-gray-600">
                            {contract.description}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* YAML Content Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col mx-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  {selectedContract?.name || 'Loading...'}
                </h2>
                {selectedContract && (
                  <p className="text-sm text-gray-500">{selectedContract.path}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCloseModal}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-auto p-4">
              {loadingYaml ? (
                <div className="flex items-center justify-center h-64">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : (
                <SyntaxHighlighter
                  language="yaml"
                  style={vscDarkPlus}
                  customStyle={{
                    margin: 0,
                    borderRadius: '0.5rem',
                    fontSize: '0.875rem',
                  }}
                >
                  {selectedContract?.content || ''}
                </SyntaxHighlighter>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
