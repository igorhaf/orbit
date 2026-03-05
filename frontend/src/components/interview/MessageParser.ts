/**
 * MessageParser Utility
 * Parses AI messages to detect and extract interactive options
 * PROMPT #143 - Updated to use hyphen format (no emojis)
 *
 * Primary format (PROMPT #143):
 * - Option text (hyphen prefix)
 *
 * Legacy format (backwards compatibility):
 * - Checkboxes: ☐ ☑ (multiple choice)
 * - Radio buttons: ○ ● (single choice)
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
 * PROMPT #142 - Handle Unicode variation selector (U+FE0F)
 * PROMPT #143 - Prioritize hyphen format (no emojis)
 */
export function parseMessage(content: string): ParsedMessage {
  if (!content) {
    return { question: '', hasOptions: false };
  }

  // PROMPT #142 - Remove Unicode variation selector (U+FE0F) that appears after emojis
  const normalizedContent = content.replace(/\uFE0F/g, '');

  // PROMPT #143 - Detect hyphen options (primary format - no emojis)
  const hasHyphens = /^[\s]*-\s+\S/m.test(normalizedContent);

  // Legacy: Detect checkbox/radio patterns (backwards compatibility)
  const checkboxPattern = /[\u2610\u2611\u2612\u2713\u2714\u2715\u2716☐☑□■▪▫]/g;
  const radioPattern = /[\u25CB\u25CF\u25C9\u25C8○●◯◉]/g;

  const hasCheckboxes = checkboxPattern.test(normalizedContent);
  const hasRadios = radioPattern.test(normalizedContent);

  // PROMPT #143 - Check for any option format
  if (!hasHyphens && !hasCheckboxes && !hasRadios) {
    return { question: normalizedContent, hasOptions: false };
  }

  // Split into lines and clean (using normalized content)
  const lines = normalizedContent.split('\n').map(line => line.trimEnd()); // Keep leading spaces for now

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
      foundOptions = true; // Start looking for options after this
      continue;
    }

    // Check if line starts with checkbox/radio (with flexible matching)
    const startsWithCheckbox = /^[\s]*[\u2610\u2611\u2612\u2713\u2714\u2715\u2716☐☑□■▪▫]/.test(trimmed);
    const startsWithRadio = /^[\s]*[\u25CB\u25CF\u25C9\u25C8○●◯◉]/.test(trimmed);
    const startsWithDash = /^[\s]*[\-=][\s]+/.test(trimmed); // Handle "- Option" or "= Option"

    // Skip indicator lines like "☑️ [Selecione todas que se aplicam]" or "◉ [Escolha uma opção]"
    // These start with symbols but contain brackets, so they're instructions, not options
    const isIndicatorLine = /[\[\]]/.test(trimmed);

    if ((startsWithCheckbox || startsWithRadio || startsWithDash) && !isIndicatorLine) {
      foundOptions = true;
      optionLines.push(trimmed);
    } else if (!foundOptions) {
      // Lines before options are part of the question
      questionLines.push(line);
    } else if (isIndicatorLine) {
      // Indicator lines are ignored (not added to question or options)
    }
    // Lines after options are ignored
  }

  // If no option lines found, return as plain text
  if (optionLines.length === 0) {
    return { question: normalizedContent, hasOptions: false };
  }

  // Parse options
  const choices = optionLines.map((line, index) => {
    // Remove checkbox/radio symbol and any leading/trailing whitespace
    // More aggressive regex to remove all variants
    let label = line
      .replace(/^[\s]*[\u2610\u2611\u2612\u2713\u2714\u2715\u2716☐☑□■▪▫\u25CB\u25CF\u25C9\u25C8○●◯◉\-=][\s]*/, '')
      .trim();

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

  // PROMPT #143 - All options are now multiple choice
  const result = {
    question: question,
    options: {
      type: 'multiple' as 'single' | 'multiple',
      choices: choices
    },
    hasOptions: true
  };

  return result;
}

/**
 * Check if a message contains option patterns
 * PROMPT #142 - Normalize variation selector before checking
 * PROMPT #143 - Prioritize hyphen format (no emojis)
 */
export function hasOptionPattern(content: string): boolean {
  if (!content) return false;
  const normalized = content.replace(/\uFE0F/g, '');
  // PROMPT #143 - Check for hyphen options (primary) or legacy symbols
  return /^[\s]*-\s+\S/m.test(normalized) || /[☐☑○●]/g.test(normalized);
}

/**
 * Extract just the option labels (for testing/debugging)
 */
export function extractOptionLabels(content: string): string[] {
  const parsed = parseMessage(content);
  return parsed.options?.choices.map(c => c.label) || [];
}
