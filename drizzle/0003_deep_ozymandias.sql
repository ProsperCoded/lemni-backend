DROP TABLE `idempotency_keys`;--> statement-breakpoint
ALTER TABLE `transactions` ADD `payload` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `response` text;