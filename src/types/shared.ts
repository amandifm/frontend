export type ScanStatus = "idle" | "scanning" | "complete" | "error";

export type ExtractedRow = {
  id: string;
  date: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
  type: "Debit" | "Credit";
  confidence: string;
  section?: string;
};

export type DocumentMetadata = {
  account_holder?: string;
  account_number?: string;
  bank_name?: string;
  statement_period_start?: string;
  statement_period_end?: string;
  statement_date?: string;
};

export type HistoryItem = {
  id: string;
  fileName: string;
  transactionCount: number;
  averageConfidence?: string | number | null;
  transactions: ExtractedRow[];
  summary?: Record<string, unknown>;
  createdAt: string;
  isLocal?: boolean;
};

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role?: string;
  isGuest?: boolean;
};
