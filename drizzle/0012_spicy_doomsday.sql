CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`customer_id` text,
	`subscription_id` text,
	`action` text NOT NULL,
	`details` text,
	`metadata` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `notification_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`event_type` text NOT NULL,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`subscription_id` text,
	`delivered` integer DEFAULT false NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `customers` ADD `signup_ip` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `signup_user_agent` text;