import { z } from "zod";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const VAULT_ID_PATTERN = /^(0|[1-9][0-9]*):0x[0-9a-fA-F]{40}$/;

export const addressSchema = z.string().regex(ADDRESS_PATTERN).brand<"Address">();
export const hashSchema = z.string().regex(HASH_PATTERN).brand<"Hash">();
export const marketIdSchema = z.string().regex(HASH_PATTERN).brand<"MarketId">();
export const vaultIdSchema = z.string().regex(VAULT_ID_PATTERN).brand<"VaultId">();

export type Address = z.output<typeof addressSchema>;
export type Hash = z.output<typeof hashSchema>;
export type MarketId = z.output<typeof marketIdSchema>;
export type VaultId = z.output<typeof vaultIdSchema>;
