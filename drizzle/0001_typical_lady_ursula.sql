CREATE TABLE `idempotency_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`request_type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`response` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
