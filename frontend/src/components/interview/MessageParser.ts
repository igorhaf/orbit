/**
 * MessageParser Utility
 * Parses AI messages to detect and extract interactive options from Unicode symbols
 *
 * Supports:
 * - Checkboxes: ☐ ☑ (multiple choice)
 * - Radio buttons: ○ ● (single choice)
 * - Mixed content: text + options
 */

interface ParsedOption {
  id: string;
  label: string;
  value: string;
}

interface ParsedMessageOptions {
  type: 'single' | 'multiple';
  choices: ParsedOption[];
}

export interface ParsedMessage {
  question: string;
  options?: ParsedMessageOptions;
  hasOptions: boolean;
}

/**
 * Parse message content to extract question text and interactive options
 */
export function parseMessage(content: string): ParsedMessage {
  if (!content) {
    return { question: '', hasOptions: false };
  }

  // Detect checkbox/radio patterns
  const hasCheckboxes = /[☐☑]/g.test(content);
  const hasRadios = /[○●]/g.test(content);

  if (!hasCheckboxes && !hasRadios) {
    // No options detected - just plain text
    return { question: content, hasOptions: false };
  }

  // Split into lines
  const lines = content.split('\n');
  const questionLines: string[] = [];
  const optionLines: string[] = [];

  let foundOptions = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check if line starts with option symbol
    if (trimmed.startsWith('☐') || trimmed.startsWith('☑') ||
        trimmed.startsWith('○') || trimmed.startsWith('●')) {
      foundOptions = true;
      optionLines.push(trimmed);
    } else if (!foundOptions) {
      // Lines before options are the question
      questionLines.push(line);
    }
    // Lines after options are ignored
  }

  // If no option lines found, return as plain text
  if (optionLines.length === 0) {
    return { question: content, hasOptions: false };
  }

  // Parse options
  const choices = optionLines.map((line, index) => {
    // Remove checkbox/radio symbol (first character) and whitespace
    const label = line.substring(1).trim();

    // Generate clean value from label
    const value = label
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .substring(0, 50); // Limit length

    return {
      id: `opt-${index}`,
      label: label,
      value: value || `option_${index}`
    };
  });

  return {
    question: questionLines.join('\n').trim(),
    options: {
      type: hasCheckboxes ? 'multiple' : 'single',
      choices: choices
    },
    hasOptions: true
  };
}

/**
 * Check if a message contains option patterns
 */
export function hasOptionPattern(content: string): boolean {
  if (!content) return false;
  return /[☐☑○●]/g.test(content);
}

/**
 * Extract just the option labels (for testing/debugging)
 */
export function extractOptionLabels(content: string): string[] {
  const parsed = parseMessage(content);
  return parsed.options?.choices.map(c => c.label) || [];
}
