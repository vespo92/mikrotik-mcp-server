/**
 * RouterOS-specific type definitions.
 */

/** RouterOS API command result item */
export interface RosItem {
  ".id"?: string;
  [key: string]: string | undefined;
}

/** RouterOS connection options */
export interface RosConnectionOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  secure: boolean;
  timeout: number;
}

/** RouterOS command parameters */
export interface RosCommandParams {
  [key: string]: string;
}

/** Connection pool entry */
export interface PoolEntry {
  client: unknown; // RouterOSClient from node-routeros
  lastUsed: number;
  commandCount: number;
  connected: boolean;
}
