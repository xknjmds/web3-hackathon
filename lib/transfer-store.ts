import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/errors";
import {
  parseTransferRecord,
  type TransferRecord,
  type TransferSubmitted,
} from "@/lib/transfer-types";

// Transfer persistence. All access is server-side through this store; the
// browser never talks to the database. Storage failures fail closed (the
// financial step is refused) and never log record contents.
const STORAGE_ERROR =
  "Transfer storage is unavailable. The request could not be completed safely; re-check the original transferId.";

function storageError(cause: unknown): ApiError {
  return new ApiError(503, "PAIFLOW_UNAVAILABLE", STORAGE_ERROR);
}

export interface TransferStore {
  // Create-or-find the user by wallet address (identity is the wallet).
  upsertUser(walletAddress: string): Promise<void>;
  // Insert or fully replace a transfer record.
  saveTransfer(record: TransferRecord): Promise<void>;
  getTransfer(transferId: string): Promise<TransferRecord | null>;
  findByTxHash(txHash: string): Promise<TransferRecord | null>;
  // A wallet's transfers, newest first (P2 history).
  listByWallet(walletAddress: string, limit: number): Promise<TransferRecord[]>;
  // Race-safe submission marker: writes `submitted` only while the record is
  // unsubmitted, so a concurrent double-submit can never produce two upstream
  // submissions.
  markSubmitted(
    transferId: string,
    submitted: TransferSubmitted,
  ): Promise<"saved" | "already">;
}

export class MemoryStore implements TransferStore {
  private readonly transfers = new Map<string, TransferRecord>();
  private readonly wallets = new Map<string, string>();
  async upsertUser(walletAddress: string): Promise<void> {
    if (!this.wallets.has(walletAddress))
      this.wallets.set(walletAddress, new Date().toISOString());
  }
  async saveTransfer(record: TransferRecord): Promise<void> {
    // Round-trip validation on every write, like saveRecovery.
    this.transfers.set(record.transferId, parseTransferRecord(record));
  }
  async getTransfer(transferId: string): Promise<TransferRecord | null> {
    const raw = this.transfers.get(transferId);
    return raw ? parseTransferRecord(raw) : null;
  }
  async findByTxHash(txHash: string): Promise<TransferRecord | null> {
    for (const raw of this.transfers.values()) {
      const record = parseTransferRecord(raw);
      if (record.prep.txHash === txHash || record.submitted?.txHash === txHash)
        return record;
    }
    return null;
  }
  async listByWallet(
    walletAddress: string,
    limit: number,
  ): Promise<TransferRecord[]> {
    return [...this.transfers.values()]
      .filter((raw) => raw.walletAddress === walletAddress)
      .map((raw) => parseTransferRecord(raw))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  async markSubmitted(
    transferId: string,
    submitted: TransferSubmitted,
  ): Promise<"saved" | "already"> {
    const current = this.transfers.get(transferId);
    if (!current) throw storageError(new Error("missing record"));
    if (current.submitted) return "already";
    this.transfers.set(
      transferId,
      parseTransferRecord({ ...current, submitted }),
    );
    return "saved";
  }
}

type TransferRow = {
  transfer_id: string;
  template_id: string;
  asset: string;
  deployment_id: string;
  wallet_address: string;
  amount: string;
  mock: boolean;
  prep: unknown;
  submitted: unknown | null;
  created_at: string;
  updated_at: string;
};

function toRow(record: TransferRecord): TransferRow {
  return {
    transfer_id: record.transferId,
    template_id: record.templateId,
    asset: record.asset,
    deployment_id: record.deploymentId,
    wallet_address: record.walletAddress,
    amount: record.amount,
    mock: record.mock,
    prep: record.prep,
    submitted: record.submitted ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function fromRow(row: TransferRow): TransferRecord {
  return parseTransferRecord({
    version: 1,
    transferId: row.transfer_id,
    templateId: row.template_id,
    asset: row.asset,
    deploymentId: row.deployment_id,
    walletAddress: row.wallet_address,
    amount: row.amount,
    mock: row.mock,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    prep: row.prep,
    submitted: row.submitted ?? undefined,
  });
}

export class SupabaseStore implements TransferStore {
  constructor(private readonly client: SupabaseClient) {}
  async upsertUser(walletAddress: string): Promise<void> {
    const { error } = await this.client
      .from("users")
      .upsert({ wallet_address: walletAddress }, { onConflict: "wallet_address" });
    if (error) throw storageError(error);
  }
  async saveTransfer(record: TransferRecord): Promise<void> {
    const { error } = await this.client
      .from("transfers")
      .upsert(toRow(record));
    if (error) throw storageError(error);
  }
  async getTransfer(transferId: string): Promise<TransferRecord | null> {
    const { data, error } = await this.client
      .from("transfers")
      .select("*")
      .eq("transfer_id", transferId)
      .maybeSingle();
    if (error) throw storageError(error);
    return data ? fromRow(data as TransferRow) : null;
  }
  async findByTxHash(txHash: string): Promise<TransferRecord | null> {
    // A hash belongs to at most one transfer; prep.txHash is unique per
    // preparation and submitted.txHash equals it. JSONB paths need .filter().
    let { data, error } = await this.client
      .from("transfers")
      .select("*")
      .filter("submitted->>txHash", "eq", txHash)
      .limit(1);
    if (error) throw storageError(error);
    if (!data?.length) {
      ({ data, error } = await this.client
        .from("transfers")
        .select("*")
        .filter("prep->>txHash", "eq", txHash)
        .limit(1));
      if (error) throw storageError(error);
    }
    const row = data?.[0];
    return row ? fromRow(row as TransferRow) : null;
  }
  async listByWallet(
    walletAddress: string,
    limit: number,
  ): Promise<TransferRecord[]> {
    // Served by the transfers_wallet (wallet_address, created_at desc) index.
    const { data, error } = await this.client
      .from("transfers")
      .select("*")
      .eq("wallet_address", walletAddress)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw storageError(error);
    return (data ?? []).map((row) => fromRow(row as TransferRow));
  }
  async markSubmitted(
    transferId: string,
    submitted: TransferSubmitted,
  ): Promise<"saved" | "already"> {
    const { data, error } = await this.client
      .from("transfers")
      .update({ submitted, updated_at: new Date().toISOString() })
      .eq("transfer_id", transferId)
      .is("submitted", null)
      .select("transfer_id");
    if (error) throw storageError(error);
    return (data?.length ?? 0) > 0 ? "saved" : "already";
  }
}

let store: TransferStore | null = null;

export function getStore(): TransferStore {
  if (store) return store;
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (url && key) {
    store = new SupabaseStore(
      createClient(url, key, { auth: { persistSession: false } }),
    );
  } else {
    console.warn(
      "PadalaSplit: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not configured; using an in-memory transfer store (state resets on restart).",
    );
    store = new MemoryStore();
  }
  return store;
}
