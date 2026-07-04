ALTER TABLE `transactions` ADD `merchant_id` text NOT NULL REFERENCES merchants(id);--> statement-breakpoint
ALTER TABLE `transactions` ADD `customer_id` text NOT NULL REFERENCES customers(id);