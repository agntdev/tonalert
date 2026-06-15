export interface ParseResult {
  value: number;
}

export interface ParseError {
  error: string;
  clarification?: string;
}

const CURRENCY_SYMBOLS = /^[\$\€\£\¥\₹\₽\₩\₪\₫\₴\₦\₲\₱\₡\₵\₸\₺\₼\₾\﷼\﹩\$USDC\$]/;

export function parseNumber(raw: string, context: "price" | "percent" = "price"): ParseResult | ParseError {
  let input = raw.trim();

  input = input.replace(CURRENCY_SYMBOLS, "").trim();

  if (context === "percent") {
    input = input.replace(/\s*%$/, "").trim();
  }

  if (input === "" || input === "." || input === ",") {
    return { error: "Please enter a valid number." };
  }

  if (/^[a-zA-Z]+$/.test(input.replace(/\s/g, ""))) {
    return { error: "That doesn't look like a number. Please enter a numeric value." };
  }

  if (input.includes(",") && input.includes(".")) {
    const lastPeriod = input.lastIndexOf(".");
    const lastComma = input.lastIndexOf(",");

    if (lastComma > lastPeriod) {
      input = removeThousandsSeparator(input, ".", ",");
    } else {
      input = removeThousandsSeparator(input, ",", ".");
    }
  } else if (input.includes(",") && !input.includes(".")) {
    const commaCount = (input.match(/,/g) || []).length;

    if (commaCount > 1) {
      input = removeThousandsSeparator(input, ",", ".");
    } else {
      const afterComma = input.split(",")[1];
      if (afterComma.length === 1 || afterComma.length === 2) {
        input = input.replace(",", ".");
      } else if (afterComma.length === 3) {
        return {
          error: `Ambiguous input: "${raw.trim()}". Did you mean ${input.replace(",", ".")} or ${input.replace(",", "")}? Please retype using "." as the decimal separator.`,
          clarification: `Is "${raw.trim()}" ${input.replace(",", ".")} or ${input.replace(",", "")}?`,
        };
      } else {
        input = input.replace(",", "");
      }
    }
  }

  input = input.replace(/[^\d.\-]/g, "");

  if (input === "" || input === "." || input === "-" || input === "-.") {
    return { error: "Please enter a valid number." };
  }

  const value = parseFloat(input);

  if (isNaN(value)) {
    return { error: "Could not parse that as a number. Please try again with a valid numeric value." };
  }

  if (context === "price" && value < 0) {
    return { error: "Price cannot be negative. Please enter a positive value." };
  }

  if (context === "price" && value === 0) {
    return { error: "Price must be greater than zero. Please enter a positive value." };
  }

  if (context === "percent" && value <= 0) {
    return { error: "Percentage must be greater than zero. Please enter a positive value." };
  }

  return { value };
}

function removeThousandsSeparator(input: string, sep: string, decimalSep: string): string {
  let result = "";
  let foundDecimal = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === decimalSep) {
      result += ".";
      foundDecimal = true;
    } else if (ch === sep && !foundDecimal) {
    } else {
      result += ch;
    }
  }
  return result;
}