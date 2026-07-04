CREATE TABLE `dlq_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text,
	`payload` text NOT NULL,
	`error_reason` text NOT NULL,
	`retry_history` text,
	`failed_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE set null
);
