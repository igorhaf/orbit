'use client';

import { useState } from 'react';
import { Layout, Breadcrumbs } from '@/components/layout';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function DebugPage() {
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<Record<string, any>>({});

  const runTests = async () => {
    setTesting(true);
    setResults({});

    const tests = [
      {
        name: '1. API Base URL',
        description: 'Test if backend is reachable',
        test: async () => {
          const response = await fetch(API_URL);
          return { ok: response.ok, status: response.status };
        },
      },
      {
        name: '2. Health Check',
        description: 'Test /health endpoint',
        test: async () => {
          const response = await fetch(`${API_URL}/health`);
          return { ok: response.ok, status: response.status };
        },
      },
      {
        name: '3. Projects Endpoint',
        description: 'Test /api/v1/projects',
        test: async () => {
          const response = await fetch(`${API_URL}/api/v1/projects`);
          const data = response.ok ? await response.json() : null;
          return { ok: response.ok, status: response.status, data };
        },
      },
      {
        name: '4. CORS Check',
        description: 'Test if CORS is properly configured',
        test: async () => {
          const response = await fetch(`${API_URL}/api/v1/projects`, {
            headers: {
              'Content-Type': 'application/json',
            },
          });
          return { ok: response.ok, status: response.status };
        },
      },
    ];

    const newResults: Record<string, any> = {};

    for (const test of tests) {
      try {
        const result = await test.test();
        newResults[test.name] = {
          status: result.ok ? 'pass' : 'fail',
          message: result.ok ? 'OK' : `HTTP ${result.status}`,
          details: result,
        };
      } catch (error: any) {
        newResults[test.name] = {
          status: 'error',
          message: error.message,
          details: error,
        };
      }
    }

    setResults(newResults);
    setTesting(false);
  };

  return (
    <Layout>
      <Breadcrumbs />
      <div className="container mx-auto py-8 max-w-4xl">
        <h1 className="text-3xl font-bold mb-2">ORBIT Debug Console</h1>
      <p className="text-gray-600 mb-8">
        Use this page to diagnose connection issues between frontend and backend
      </p>

      {/* Configuration */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Current Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-gray-600">API URL:</span>
            <code className="bg-gray-100 px-3 py-1 rounded font-mono text-sm">
              {API_URL}
            </code>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-600">Frontend URL:</span>
            <code className="bg-gray-100 px-3 py-1 rounded font-mono text-sm">
              {typeof window !== 'undefined' ? window.location.origin : 'N/A'}
            </code>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-600">Environment:</span>
            <code className="bg-gray-100 px-3 py-1 rounded font-mono text-sm">
              {process.env.NODE_ENV}
            </code>
          </div>
        </CardContent>
      </Card>

      {/* Instructions */}
      <Card className="mb-6 border-blue-200 bg-blue-50">
        <CardHeader>
          <CardTitle className="text-blue-900">Before Testing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-blue-800">
          <p className="font-semibold">Make sure backend is running:</p>
          <code className="block bg-blue-100 px-3 py-2 rounded font-mono">
            cd backend && uvicorn app.main:app --reload
          </code>
          <p className="text-xs mt-2">
            Backend should be running on http://localhost:8000
          </p>
        </CardContent>
      </Card>

      {/* Tests */}
      <Card>
        <CardHeader>
          <CardTitle>Connection Tests</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            onClick={runTests}
            disabled={testing}
            className="mb-6 w-full"
            size="lg"
          >
            {testing ? (
              <>
                <div className="w-5 h-5 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Running Tests...
              </>
            ) : (
              'Run All Tests'
            )}
          </Button>

          {Object.keys(results).length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <svg
                className="w-12 h-12 mx-auto mb-3 opacity-50"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <p>Click "Run All Tests" to start diagnostics</p>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(results).map(([name, result]: [string, any]) => (
                <div
                  key={name}
                  className={`p-4 border rounded-lg ${
                    result.status === 'pass'
                      ? 'bg-green-50 border-green-200'
                      : result.status === 'error'
                      ? 'bg-red-50 border-red-200'
                      : 'bg-yellow-50 border-yellow-200'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {result.status === 'pass' ? (
                          <svg
                            className="w-5 h-5 text-green-600"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                        ) : result.status === 'error' ? (
                          <svg
                            className="w-5 h-5 text-red-600"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                        ) : (
                          <svg
                            className="w-5 h-5 text-yellow-600"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                            />
                          </svg>
                        )}
                        <span className="font-semibold">{name}</span>
                      </div>
                      <p className="text-sm text-gray-600 mb-2">
                        {result.message}
                      </p>
                      {result.details && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                            View Details
                          </summary>
                          <pre className="mt-2 p-2 bg-black/5 rounded overflow-auto">
                            {JSON.stringify(result.details, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Summary */}
          {Object.keys(results).length > 0 && (
            <Card className="mt-6">
              <CardContent className="pt-6">
                <h4 className="font-semibold mb-3">Diagnosis:</h4>
                {Object.values(results).every((r: any) => r.status === 'pass') ? (
                  <div className="flex items-start gap-3 p-3 bg-green-50 border border-green-200 rounded">
                    <svg
                      className="w-6 h-6 text-green-600 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <div>
                      <p className="font-semibold text-green-900">All tests passed!</p>
                      <p className="text-sm text-green-700 mt-1">
                        Backend is running and accessible. If you're still seeing
                        loading issues, check browser console for errors.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded">
                    <svg
                      className="w-6 h-6 text-red-600 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <div>
                      <p className="font-semibold text-red-900">Connection issues detected</p>
                      <ul className="text-sm text-red-700 mt-2 space-y-1 list-disc list-inside">
                        {Object.values(results).some((r: any) =>
                          r.message.includes('fetch')
                        ) && (
                          <li>Backend is not running or not accessible</li>
                        )}
                        {Object.values(results).some((r: any) =>
                          r.message.includes('CORS') || r.status === 'fail'
                        ) && (
                          <li>CORS might be blocking requests</li>
                        )}
                      </ul>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
      </div>
    </Layout>
  );
}
