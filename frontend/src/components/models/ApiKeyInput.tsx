/**
 * ApiKeyInput Component
 * Secure input field for API keys with masking
 */

'use client';

import React, { useState } from 'react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Eye, EyeOff, Copy, Check } from 'lucide-react';

interface ApiKeyInputProps {
  value: string;
  onChange: (value: string) => void;
  preview?: string;
  placeholder?: string;
  disabled?: boolean;
}

export const ApiKeyInput: React.FC<ApiKeyInputProps> = ({
  value,
  onChange,
  preview,
  placeholder = 'Enter API key...',
  disabled = false,
}) => {
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);

  const displayValue = showKey ? value : (preview || value.replace(/./g, '•'));

  const handleCopy = () => {
    if (value) {
      navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="relative">
      <Input
        type="text"
        value={displayValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="pr-20 font-mono"
      />
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
        {value && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              disabled={disabled}
              className="h-7 w-7 p-0"
              title="Copy API key"
            >
              {copied ? (
                <Check className="w-3 h-3 text-green-600" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowKey(!showKey)}
              disabled={disabled}
              className="h-7 w-7 p-0"
              title={showKey ? 'Hide API key' : 'Show API key'}
            >
              {showKey ? (
                <EyeOff className="w-3 h-3" />
              ) : (
                <Eye className="w-3 h-3" />
              )}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
