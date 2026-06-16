export interface UserRow {
  id: number;
  chat_id: number;
  fiat: string;
  timezone: string;
  morning_summary: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  quiet_hours_enabled: boolean;
  quiet_hours_immediate: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface TokenRow {
  id: number;
  symbol: string;
  name: string;
  address: string;
  created_at: Date;
}

export interface WatchRow {
  id: number;
  user_id: number;
  token_id: number;
  type: "price_below" | "price_above" | "percent_move";
  threshold: number | null;
  percent_threshold: number | null;
  is_recurring: boolean;
  is_one_shot: boolean;
  last_triggered_at: Date | null;
  trigger_price: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface AlertHistoryRow {
  id: number;
  user_id: number;
  token_id: number;
  rule_type: string;
  trigger_description: string;
  current_price: number;
  baseline_price: number | null;
  percent_change: number | null;
  delivered: boolean;
  delivery_timestamp: Date | null;
  triggered_at: Date;
}

export interface AdminEventRow {
  id: number;
  event_type: string;
  details: Record<string, unknown>;
  created_at: Date;
}
