CREATE TABLE `otp_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`code` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
