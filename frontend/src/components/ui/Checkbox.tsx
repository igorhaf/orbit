import React from 'react';

export interface CheckboxProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  checked = false,
  onChange,
  disabled = false,
  className = '',
  label,
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (onChange) {
      onChange(e.target.checked);
    }
  };

  return (
    <label className={`inline-flex items-center ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        disabled={disabled}
        className="w-5 h-5 text-blue-600 bg-white border-gray-300 rounded focus:ring-blue-500 focus:ring-2 disabled:cursor-not-allowed"
      />
      {label && (
        <span className="ml-2 text-sm font-medium text-gray-700">
          {label}
        </span>
      )}
    </label>
  );
};
