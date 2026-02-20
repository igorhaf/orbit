/**
 * API Client for ORBIT Backend - Base module
 * Provides typed API calls with comprehensive error handling and logging
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// Log inicial
if (typeof window !== 'undefined') {
  console.log('🔧 ORBIT API Client initialized');
  console.log('📍 API URL:', API_URL);
}

// Base request function com logs detalhados
export async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_URL}${endpoint}`;

  console.log('📡 API Request:', {
    method: options.method || 'GET',
    url,
    hasBody: !!options.body,
  });

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    console.log('📥 API Response:', {
      status: response.status,
      ok: response.ok,
      statusText: response.statusText,
    });

    // Se não for OK, tentar pegar erro do backend
    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

      try {
        const errorData = await response.json();
        if (Array.isArray(errorData.detail)) {
          errorMessage = errorData.detail.map((d: any) => d.msg || String(d)).join('; ');
        } else {
          errorMessage = errorData.detail || errorData.message || errorMessage;
        }
      } catch {
        // Se não conseguir parsear JSON, usa mensagem padrão
      }

      console.error('❌ API Error:', errorMessage);
      throw new Error(errorMessage);
    }

    // Handle 204 No Content (e.g., successful delete)
    if (response.status === 204) {
      console.log('✅ API Success (No Content)');
      return null as T;
    }

    const data = await response.json();
    console.log('✅ API Success');
    return data;

  } catch (error: any) {
    console.error('❌ API Request Failed:', {
      url,
      error: error.message,
    });

    // Melhorar mensagens de erro comuns
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      throw new Error(
        `Não é possível conectar ao backend em ${API_URL}. ` +
        `Certifique-se de que o backend esta em execução com: uvicorn app.main:app --reload`
      );
    }

    if (error.message.includes('CORS')) {
      throw new Error(
        `Erro de CORS. Backend precisa permitir origem ${typeof window !== 'undefined' ? window.location.origin : 'localhost:3000'}. ` +
        `Verifique a configuração de CORS do backend.`
      );
    }

    throw error;
  }
}
