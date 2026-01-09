/**
 * Safe State Hooks
 * Custom hooks that ensure state is always properly initialized
 * to prevent "Cannot read properties of undefined" errors
 */

import { useState, Dispatch, SetStateAction } from 'react';

/**
 * Safe useState hook for arrays
 * Always initializes with an empty array if no initial value provided
 *
 * @example
 * const [items, setItems] = useSafeArrayState<Item>();
 * // items is guaranteed to be Item[], never undefined
 */
export function useSafeArrayState<T>(
  initialValue: T[] = []
): [T[], Dispatch<SetStateAction<T[]>>] {
  return useState<T[]>(initialValue);
}

/**
 * Safe useState hook for objects
 * Always initializes with null if no initial value provided
 *
 * @example
 * const [user, setUser] = useSafeObjectState<User>();
 * // user is guaranteed to be User | null, never undefined
 */
export function useSafeObjectState<T>(
  initialValue: T | null = null
): [T | null, Dispatch<SetStateAction<T | null>>] {
  return useState<T | null>(initialValue);
}

/**
 * Safe useState hook for strings
 * Always initializes with empty string if no initial value provided
 *
 * @example
 * const [name, setName] = useSafeStringState();
 * // name is guaranteed to be string, never undefined
 */
export function useSafeStringState(
  initialValue: string = ''
): [string, Dispatch<SetStateAction<string>>] {
  return useState<string>(initialValue);
}

/**
 * Safe useState hook for numbers
 * Always initializes with 0 if no initial value provided
 *
 * @example
 * const [count, setCount] = useSafeNumberState();
 * // count is guaranteed to be number, never undefined
 */
export function useSafeNumberState(
  initialValue: number = 0
): [number, Dispatch<SetStateAction<number>>] {
  return useState<number>(initialValue);
}

/**
 * Safe useState hook for booleans
 * Always initializes with false if no initial value provided
 *
 * @example
 * const [loading, setLoading] = useSafeBooleanState();
 * // loading is guaranteed to be boolean, never undefined
 */
export function useSafeBooleanState(
  initialValue: boolean = false
): [boolean, Dispatch<SetStateAction<boolean>>] {
  return useState<boolean>(initialValue);
}

/**
 * Helper function to safely extract array data from API responses
 * Ensures the result is always an array, never undefined
 *
 * @example
 * const response = await api.list();
 * const items = ensureArray(response.data);
 * setItems(items); // Guaranteed to be an array
 */
export function ensureArray<T>(data: any): T[] {
  if (Array.isArray(data)) return data;
  if (data?.data && Array.isArray(data.data)) return data.data;
  return [];
}

/**
 * Helper function to safely extract object data from API responses
 * Ensures the result is always an object or null, never undefined
 *
 * @example
 * const response = await api.get(id);
 * const item = ensureObject(response.data);
 * setItem(item); // Guaranteed to be object or null
 */
export function ensureObject<T>(data: any): T | null {
  if (!data) return null;
  if (data.data && typeof data.data === 'object') return data.data;
  if (typeof data === 'object') return data;
  return null;
}
