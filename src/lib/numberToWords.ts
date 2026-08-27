/**
 * Converts a numeric amount to Indian Currency Words format.
 * e.g. 38804.50 -> "Thirty Eight Thousand Eight Hundred and Four Rupees and Fifty Paise only"
 * e.g. 36100.00 -> "Thirty Six Thousand One Hundred Rupees only"
 */

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen'
];

const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'
];

function convertLessThanThousand(n: number): string {
  if (n === 0) return '';
  
  if (n < 20) {
    return ONES[n];
  }
  
  if (n < 100) {
    const ten = Math.floor(n / 10);
    const rest = n % 10;
    return `${TENS[ten]}${rest ? ' ' + ONES[rest] : ''}`;
  }
  
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  return `${ONES[hundred]} Hundred${rest ? ' and ' + convertLessThanThousand(rest) : ''}`;
}

export function numberToIndianWords(amount: number | string | null | undefined): string {
  const numeric = typeof amount === 'number' ? amount : parseFloat(String(amount || 0));
  if (isNaN(numeric) || numeric === 0) {
    return 'Zero Rupees only';
  }

  const isNegative = numeric < 0;
  const absAmount = Math.abs(numeric);
  
  const rupees = Math.floor(absAmount);
  const paise = Math.round((absAmount - rupees) * 100);

  if (rupees === 0 && paise === 0) {
    return 'Zero Rupees only';
  }

  let words = '';

  // Indian Numbering Place Values:
  // Crores (1,00,00,000)
  const crores = Math.floor(rupees / 10000000);
  let remainder = rupees % 10000000;

  // Lakhs (1,00,000)
  const lakhs = Math.floor(remainder / 100000);
  remainder = remainder % 100000;

  // Thousands (1,000)
  const thousands = Math.floor(remainder / 1000);
  remainder = remainder % 1000;

  // Hundreds & below (100)
  const hundreds = remainder;

  if (crores > 0) {
    words += `${convertLessThanThousand(crores)} Crore `;
  }
  if (lakhs > 0) {
    words += `${convertLessThanThousand(lakhs)} Lakh `;
  }
  if (thousands > 0) {
    words += `${convertLessThanThousand(thousands)} Thousand `;
  }
  if (hundreds > 0) {
    words += `${convertLessThanThousand(hundreds)} `;
  }

  words = words.trim();
  if (rupees > 0) {
    words += ' Rupees';
  }

  if (paise > 0) {
    const paiseWords = convertLessThanThousand(paise);
    if (rupees > 0) {
      words += ` and ${paiseWords} Paise`;
    } else {
      words += `${paiseWords} Paise`;
    }
  }

  words += ' only';

  if (isNegative) {
    words = `Minus ${words}`;
  }

  return words;
}
