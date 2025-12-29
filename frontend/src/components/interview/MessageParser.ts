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
 * Enhanced version with robust Unicode detection and debugging
 */
export function parseMessage(content: string): ParsedMessage {
  if (!content) {
    return { question: '', hasOptions: false };
  }

  console.log('🔍 MessageParser: Parsing content:', content.substring(0, 100) + '...');

  // Detect checkbox/radio patterns - ENHANCED with more variants
  const checkboxPattern = /[\u2610\u2611\u2612\u2713\u2714\u2715\u2716☐☑□■▪▫]/g;
  const radioPattern = /[\u25CB\u25CF\u25C9\u25C8○●◯◉]/g;

  const hasCheckboxes = checkboxPattern.test(content);
  const hasRadios = radioPattern.test(content);

  console.log('🔍 MessageParser: hasCheckboxes=', hasCheckboxes, 'hasRadios=', hasRadios);

  if (!hasCheckboxes && !hasRadios) {
    console.log('🔍 MessageParser: No options detected, returning as plain text');
    return { question: content, hasOptions: false };
  }

  // Split into lines and clean
  const lines = content.split('\n').map(line => line.trimEnd()); // Keep leading spaces for now
  console.log('🔍 MessageParser: Total lines:', lines.length);

  const questionLines: string[] = [];
  const optionLines: string[] = [];
  let foundOptions = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      if (!foundOptions) {
        questionLines.push(line);
      }
      continue;
    }

    // Skip "OPTIONS:" header line
    if (trimmed.toUpperCase() === 'OPTIONS:' ||
        trimmed.toUpperCase() === 'OPTIONS' ||
        trimmed.toUpperCase() === 'SELECT:' ||
        trimmed.toUpperCase() === 'CHOOSE:') {
      console.log('🔍 MessageParser: Skipping header line:', trimmed);
      foundOptions = true; // Start looking for options after this
      continue;
    }

    // Check if line starts with checkbox/radio (with flexible matching)
    const startsWithCheckbox = /^[\s]*[\u2610\u2611\u2612\u2713\u2714\u2715\u2716☐☑□■▪▫]/.test(trimmed);
    const startsWithRadio = /^[\s]*[\u25CB\u25CF\u25C9\u25C8○●◯◉]/.test(trimmed);
    const startsWithDash = /^[\s]*[\-=][\s]+/.test(trimmed); // Handle "- Option" or "= Option"

    if (startsWithCheckbox || startsWithRadio || startsWithDash) {
      console.log('🔍 MessageParser: Found option line:', trimmed);
      foundOptions = true;
      optionLines.push(trimmed);
    } else if (!foundOptions) {
      // Lines before options are part of the question
      questionLines.push(line);
    }
    // Lines after options are ignored
  }

  console.log('🔍 MessageParser: Question lines:', questionLines.length);
  console.log('🔍 MessageParser: Option lines:', optionLines.length);

  // If no option lines found, return as plain text
  if (optionLines.length === 0) {
    console.log('🔍 MessageParser: No option lines found, returning as plain text');
    return { question: content, hasOptions: false };
  }

  // Parse options
  const choices = optionLines.map((line, index) => {
    // Remove checkbox/radio symbol and any leading/trailing whitespace
    // More aggressive regex to remove all variants
    let label = line
      .replace(/^[\s]*[\u2610\u2611\u2612\u2713\u2714\u2715\u2716☐☑□■▪▫\u25CB\u25CF\u25C9\u25C8○●◯◉\-=][\s]*/, '')
      .trim();

    console.log('🔍 MessageParser: Option', index, '- Label:', label);

    // Generate clean value from label
    const value = label
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .substring(0, 50);

    return {
      id: `opt-${index}`,
      label: label,
      value: value || `option_${index}`
    };
  });

  // Build question (remove "OPTIONS:" and trailing empty lines)
  let question = questionLines
    .join('\n')
    .replace(/\n*OPTIONS:\s*\n*/gi, '\n')  // Remove OPTIONS: header
    .replace(/\n*CHOOSE:\s*\n*/gi, '\n')   // Remove CHOOSE: header
    .replace(/\n*SELECT:\s*\n*/gi, '\n')   // Remove SELECT: header
    .trim();

  console.log('🔍 MessageParser: Final question:', question);
  console.log('🔍 MessageParser: Final choices:', choices.length, 'options');

  const result = {
    question: question,
    options: {
      type: (hasCheckboxes ? 'multiple' : 'single') as 'single' | 'multiple',
      choices: choices
    },
    hasOptions: true
  };

  console.log('🔍 MessageParser: Result:', JSON.stringify(result, null, 2));

  return result;
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
