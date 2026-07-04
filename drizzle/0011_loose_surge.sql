PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_otp_verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text,
	`merchant_id` text,
	`code` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_otp_verifications`("id", "subscription_id", "merchant_id", "code", "expires_at", "created_at") SELECT "id", "subscription_id", NULL, "code", "expires_at", "created_at" FROM `otp_verifications`;--> statement-breakpoint
DROP TABLE `otp_verifications`;--> statement-breakpoint
ALTER TABLE `__new_otp_verifications` RENAME TO `otp_verifications`;--> statement-breakpoint
PRAGMA foreign_keys=ON;