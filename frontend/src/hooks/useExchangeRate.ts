import { useState, useEffect } from 'react';

const STORAGE_KEY = 'orbit_usd_brl_rate';
const STORAGE_TS_KEY = 'orbit_usd_brl_ts';
const TTL_MS = 30 * 60 * 1000; // 30 minutes

interface StoredRate {
  rate: number;
  timestamp: number;
}

function getCachedRate(): number | null {
  try {
    const rate = sessionStorage.getItem(STORAGE_KEY);
    const ts = sessionStorage.getItem(STORAGE_TS_KEY);
    if (rate && ts) {
      const age = Date.now() - Number(ts);
      if (age < TTL_MS) return Number(rate);
    }
  } catch {
    // sessionStorage unavailable
  }
  return null;
}

function setCachedRate(rate: number) {
  try {
    sessionStorage.setItem(STORAGE_KEY, String(rate));
    sessionStorage.setItem(STORAGE_TS_KEY, String(Date.now()));
  } catch {
    // sessionStorage unavailable
  }
}

export function useExchangeRate() {
  const [rate, setRate] = useState<number | null>(() => getCachedRate());
  const [loading, setLoading] = useState(!getCachedRate());

  useEffect(() => {
    const cached = getCachedRate();
    if (cached) {
      setRate(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchRate() {
      try {
        const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
        const data = await res.json();
        const bid = parseFloat(data.USDBRL.bid);
        if (!cancelled && bid > 0) {
          setRate(bid);
          setCachedRate(bid);
        }
      } catch {
        // Fallback rate if API unavailable
        if (!cancelled) setRate(5.70);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchRate();
    return () => { cancelled = true; };
  }, []);

  const convertTooltip = rate ? `Cotacao: R$ ${rate.toFixed(2)}/USD (AwesomeAPI)` : '';

  return { rate, loading, convertTooltip };
}
