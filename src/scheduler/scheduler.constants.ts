import { Queue } from 'bullmq';

export const CHARGE_QUEUE = 'charge';
export const DUNNING_QUEUE = 'dunning';

export const CHARGE_QUEUE_TOKEN = 'CHARGE_QUEUE';
export const DUNNING_QUEUE_TOKEN = 'DUNNING_QUEUE';

export interface ChargeJobPayload {
  subscriptionId: string;
  customerId: string;
  planId: string;
  amount: number;
  merchantId: string;
  retryCount: number;
}

export type ChargeQueue = Queue<ChargeJobPayload>;
export type DunningQueue = Queue<ChargeJobPayload>;
